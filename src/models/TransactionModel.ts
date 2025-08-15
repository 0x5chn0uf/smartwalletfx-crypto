// Transaction Model
// Database operations for transaction management and tracking

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import {
  TransactionCreateSchema,
  TransactionUpdateSchema,
} from './validators';
import {
  TransactionWithTransfers,
  TransactionQueryOptions,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';

export class TransactionModel {
  /**
   * Create a new transaction
   */
  static async create(
    data: typeof TransactionCreateSchema._input
  ): Promise<TransactionWithTransfers> {
    try {
      const validatedData = TransactionCreateSchema.parse(data);

      // Check for existing transaction
      const existing = await prisma.transaction.findUnique({
        where: {
          hash_chainId: {
            hash: validatedData.hash,
            chainId: validatedData.chainId,
          },
        },
      });

      if (existing && !existing.isDeleted) {
        throw new ConflictError(
          'Transaction',
          'hash_chainId',
          `${validatedData.hash}_${validatedData.chainId}`
        );
      }

      const transaction = await prisma.transaction.upsert({
        where: {
          hash_chainId: {
            hash: validatedData.hash,
            chainId: validatedData.chainId,
          },
        },
        create: {
          ...validatedData,
          from: validatedData.from.toLowerCase(),
          to: validatedData.to?.toLowerCase(),
          isDeleted: false,
        },
        update: {
          ...validatedData,
          from: validatedData.from.toLowerCase(),
          to: validatedData.to?.toLowerCase(),
          isDeleted: false,
          updatedAt: new Date(),
        },
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
      });

      logger.info('Transaction created', {
        transactionId: transaction.id,
        hash: transaction.hash,
        chainId: transaction.chainId,
        status: transaction.status,
      });

      return transaction;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create transaction', { data, error });
      throw new DatabaseError('Failed to create transaction', 'create', 'transactions', error);
    }
  }

  /**
   * Find transaction by ID
   */
  static async findById(id: string): Promise<TransactionWithTransfers | null> {
    try {
      return await prisma.transaction.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find transaction by ID', { id, error });
      throw new DatabaseError('Failed to find transaction', 'findById', 'transactions', error);
    }
  }

  /**
   * Find transaction by hash and chain
   */
  static async findByHash(hash: string, chainId: string): Promise<TransactionWithTransfers | null> {
    try {
      return await prisma.transaction.findFirst({
        where: {
          hash,
          chainId,
          isDeleted: false,
        },
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find transaction by hash', { hash, chainId, error });
      throw new DatabaseError('Failed to find transaction', 'findByHash', 'transactions', error);
    }
  }

  /**
   * Find transactions by wallet
   */
  static async findByWallet(
    walletId: string,
    options: {
      limit?: number;
      offset?: number;
      status?: string;
      type?: string;
      category?: string;
    } = {}
  ): Promise<TransactionWithTransfers[]> {
    try {
      const { limit = 50, offset = 0, status, type, category } = options;

      const where: Prisma.TransactionWhereInput = {
        walletId,
        isDeleted: false,
      };

      if (status) where.status = status as any;
      if (type) where.type = type;
      if (category) where.category = category;

      return await prisma.transaction.findMany({
        where,
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit,
        skip: offset,
      });
    } catch (error) {
      logger.error('Failed to find transactions by wallet', { walletId, options, error });
      throw new DatabaseError('Failed to find transactions', 'findByWallet', 'transactions', error);
    }
  }

  /**
   * Find transactions by address (from or to)
   */
  static async findByAddress(
    address: string,
    chainId?: string,
    limit: number = 50
  ): Promise<TransactionWithTransfers[]> {
    try {
      const formattedAddress = address.toLowerCase();

      const where: Prisma.TransactionWhereInput = {
        OR: [{ from: formattedAddress }, { to: formattedAddress }],
        isDeleted: false,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.transaction.findMany({
        where,
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to find transactions by address', { address, chainId, limit, error });
      throw new DatabaseError(
        'Failed to find transactions',
        'findByAddress',
        'transactions',
        error
      );
    }
  }

  /**
   * List transactions with pagination and filters
   */
  static async list(options: TransactionQueryOptions = {}): Promise<{
    transactions: TransactionWithTransfers[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'timestamp',
        sortOrder = 'desc',
        includeDeleted = false,
        walletId,
        chainId,
        status,
        type,
        category,
        from,
        to,
        minValue,
        maxValue,
        fromDate,
        toDate,
        includeTokenTransfers = true,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.TransactionWhereInput = includeDeleted ? {} : { isDeleted: false };

      if (walletId) where.walletId = walletId;
      if (chainId) where.chainId = chainId;
      if (status) where.status = status as any;
      if (type) where.type = type;
      if (category) where.category = category;
      if (from) where.from = from;
      if (to) where.to = to;

      if (minValue !== undefined || maxValue !== undefined) {
        where.valueUSD = {};
        if (minValue !== undefined) where.valueUSD.gte = minValue;
        if (maxValue !== undefined) where.valueUSD.lte = maxValue;
      }

      if (fromDate || toDate) {
        where.timestamp = {};
        if (fromDate) where.timestamp.gte = fromDate;
        if (toDate) where.timestamp.lte = toDate;
      }

      const include: Prisma.TransactionInclude = {
        wallet: true,
      };

      if (includeTokenTransfers) {
        include.tokenTransfers = {
          include: {
            token: true,
          },
        };
      }

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include,
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.transaction.count({ where }),
      ]);

      return {
        transactions: transactions as any,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list transactions', { options, error });
      throw new DatabaseError('Failed to list transactions', 'list', 'transactions', error);
    }
  }

  /**
   * Update transaction
   */
  static async update(
    id: string,
    data: typeof TransactionUpdateSchema._input
  ): Promise<TransactionWithTransfers> {
    try {
      const validatedData = TransactionUpdateSchema.parse(data);

      if (validatedData.from) {
        validatedData.from = validatedData.from.toLowerCase();
      }
      if (validatedData.to) {
        validatedData.to = validatedData.to.toLowerCase();
      }

      const transaction = await prisma.transaction.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
      });

      logger.info('Transaction updated', {
        transactionId: id,
        updatedFields: Object.keys(validatedData),
      });

      return transaction;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Transaction', id);
      }

      logger.error('Failed to update transaction', { id, data, error });
      throw new DatabaseError('Failed to update transaction', 'update', 'transactions', error);
    }
  }

  /**
   * Update transaction status
   */
  static async updateStatus(
    id: string,
    status: 'pending' | 'confirmed' | 'failed',
    blockNumber?: bigint
  ): Promise<TransactionWithTransfers> {
    try {
      const transaction = await prisma.transaction.update({
        where: { id },
        data: {
          status,
          blockNumber,
          updatedAt: new Date(),
        },
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
      });

      logger.info('Transaction status updated', {
        transactionId: id,
        newStatus: status,
        blockNumber,
      });

      return transaction;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Transaction', id);
      }

      logger.error('Failed to update transaction status', { id, status, blockNumber, error });
      throw new DatabaseError(
        'Failed to update transaction status',
        'updateStatus',
        'transactions',
        error
      );
    }
  }

  /**
   * Soft delete transaction
   */
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.transaction.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });

      logger.info('Transaction soft deleted', { transactionId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Transaction', id);
      }

      logger.error('Failed to soft delete transaction', { id, error });
      throw new DatabaseError(
        'Failed to soft delete transaction',
        'softDelete',
        'transactions',
        error
      );
    }
  }

  /**
   * Bulk create transactions
   */
  static async bulkCreate(
    transactionsData: Array<typeof TransactionCreateSchema._input>
  ): Promise<BatchResult<TransactionWithTransfers>> {
    const startTime = Date.now();
    const results: TransactionWithTransfers[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      await dbUtils.withRetry(async tx => {
        for (let i = 0; i < transactionsData.length; i++) {
          try {
            const validatedData = TransactionCreateSchema.parse(transactionsData[i]);

            const transaction = await tx.transaction.upsert({
              where: {
                hash_chainId: {
                  hash: validatedData.hash,
                  chainId: validatedData.chainId,
                },
              },
              create: {
                ...validatedData,
                from: validatedData.from.toLowerCase(),
                to: validatedData.to?.toLowerCase(),
                isDeleted: false,
              },
              update: {
                ...validatedData,
                from: validatedData.from.toLowerCase(),
                to: validatedData.to?.toLowerCase(),
                isDeleted: false,
                updatedAt: new Date(),
              },
              include: {
                tokenTransfers: {
                  include: {
                    token: true,
                  },
                },
                wallet: true,
              },
            });

            results.push(transaction);
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk transaction creation completed', {
        total: transactionsData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: transactionsData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk transaction creation failed', { error });
      throw new DatabaseError(
        'Bulk transaction creation failed',
        'bulkCreate',
        'transactions',
        error
      );
    }
  }

  /**
   * Get pending transactions
   */
  static async getPendingTransactions(chainId?: string): Promise<TransactionWithTransfers[]> {
    try {
      const where: Prisma.TransactionWhereInput = {
        status: 'pending',
        isDeleted: false,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.transaction.findMany({
        where,
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to get pending transactions', { chainId, error });
      throw new DatabaseError(
        'Failed to get pending transactions',
        'getPendingTransactions',
        'transactions',
        error
      );
    }
  }

  /**
   * Get failed transactions
   */
  static async getFailedTransactions(
    walletId?: string,
    limit: number = 100
  ): Promise<TransactionWithTransfers[]> {
    try {
      const where: Prisma.TransactionWhereInput = {
        status: 'failed',
        isDeleted: false,
      };

      if (walletId) {
        where.walletId = walletId;
      }

      return await prisma.transaction.findMany({
        where,
        include: {
          tokenTransfers: {
            include: {
              token: true,
            },
          },
          wallet: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to get failed transactions', { walletId, limit, error });
      throw new DatabaseError(
        'Failed to get failed transactions',
        'getFailedTransactions',
        'transactions',
        error
      );
    }
  }

  /**
   * Get transaction statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    confirmed: number;
    pending: number;
    failed: number;
    totalValueUSD: number;
    totalGasFeeUSD: number;
    chainDistribution: Array<{ chainId: string; count: number; totalValue: number }>;
    typeDistribution: Array<{ type: string; count: number }>;
    categoryDistribution: Array<{ category: string; count: number }>;
    recentActivity: {
      last24h: number;
      last7d: number;
      last30d: number;
    };
  }> {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        total,
        confirmed,
        pending,
        failed,
        chainStats,
        typeStats,
        categoryStats,
        valueStats,
        recent24h,
        recent7d,
        recent30d,
      ] = await Promise.all([
        prisma.transaction.count({ where: { isDeleted: false } }),
        prisma.transaction.count({ where: { status: 'confirmed', isDeleted: false } }),
        prisma.transaction.count({ where: { status: 'pending', isDeleted: false } }),
        prisma.transaction.count({ where: { status: 'failed', isDeleted: false } }),
        prisma.transaction.groupBy({
          by: ['chainId'],
          _count: { chainId: true },
          _sum: { valueUSD: true },
          where: { isDeleted: false },
        }),
        prisma.transaction.groupBy({
          by: ['type'],
          _count: { type: true },
          where: { isDeleted: false, type: { not: null } },
        }),
        prisma.transaction.groupBy({
          by: ['category'],
          _count: { category: true },
          where: { isDeleted: false, category: { not: null } },
        }),
        prisma.transaction.aggregate({
          _sum: { valueUSD: true, gasFeeUSD: true },
          where: { isDeleted: false },
        }),
        prisma.transaction.count({
          where: {
            timestamp: { gte: oneDayAgo },
            isDeleted: false,
          },
        }),
        prisma.transaction.count({
          where: {
            timestamp: { gte: oneWeekAgo },
            isDeleted: false,
          },
        }),
        prisma.transaction.count({
          where: {
            timestamp: { gte: oneMonthAgo },
            isDeleted: false,
          },
        }),
      ]);

      return {
        total,
        confirmed,
        pending,
        failed,
        totalValueUSD: valueStats._sum.valueUSD?.toNumber() || 0,
        totalGasFeeUSD: valueStats._sum.gasFeeUSD?.toNumber() || 0,
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
          totalValue: stat._sum.valueUSD?.toNumber() || 0,
        })),
        typeDistribution: typeStats.map(stat => ({
          type: stat.type || 'unknown',
          count: stat._count.type,
        })),
        categoryDistribution: categoryStats.map(stat => ({
          category: stat.category || 'unknown',
          count: stat._count.category,
        })),
        recentActivity: {
          last24h: recent24h,
          last7d: recent7d,
          last30d: recent30d,
        },
      };
    } catch (error) {
      logger.error('Failed to get transaction statistics', { error });
      throw new DatabaseError(
        'Failed to get transaction statistics',
        'getStatistics',
        'transactions',
        error
      );
    }
  }

  /**
   * Get wallet transaction summary
   */
  static async getWalletSummary(
    walletId: string,
    days: number = 30
  ): Promise<{
    totalTransactions: number;
    totalValueUSD: number;
    totalGasFeeUSD: number;
    incomingCount: number;
    outgoingCount: number;
    incomingValueUSD: number;
    outgoingValueUSD: number;
    averageGasFee: number;
    recentTransactions: TransactionWithTransfers[];
  }> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const transactions = await this.findByWallet(walletId, { limit: 1000 });
      const recentTransactions = transactions.filter(tx => tx.timestamp >= fromDate);

      const wallet = await prisma.userWallet.findUnique({
        where: { id: walletId },
        select: { address: true },
      });

      if (!wallet) {
        throw new NotFoundError('UserWallet', walletId);
      }

      const walletAddress = wallet.address.toLowerCase();

      const incoming = recentTransactions.filter(tx => tx.to === walletAddress);
      const outgoing = recentTransactions.filter(tx => tx.from === walletAddress);

      const totalValueUSD = recentTransactions.reduce((sum, tx) => sum + (tx.valueUSD?.toNumber() || 0), 0);

      const totalGasFeeUSD = recentTransactions.reduce((sum, tx) => sum + (tx.gasFeeUSD?.toNumber() || 0), 0);

      const incomingValueUSD = incoming.reduce((sum, tx) => sum + (tx.valueUSD?.toNumber() || 0), 0);

      const outgoingValueUSD = outgoing.reduce((sum, tx) => sum + (tx.valueUSD?.toNumber() || 0), 0);

      return {
        totalTransactions: recentTransactions.length,
        totalValueUSD,
        totalGasFeeUSD,
        incomingCount: incoming.length,
        outgoingCount: outgoing.length,
        incomingValueUSD,
        outgoingValueUSD,
        averageGasFee:
          recentTransactions.length > 0 ? totalGasFeeUSD / recentTransactions.length : 0,
        recentTransactions: transactions.slice(0, 10), // Last 10 transactions
      };
    } catch (error) {
      logger.error('Failed to get wallet transaction summary', { walletId, days, error });
      throw new DatabaseError(
        'Failed to get wallet transaction summary',
        'getWalletSummary',
        'transactions',
        error
      );
    }
  }
}
