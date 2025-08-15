// Token Balance Model
// Database operations for token balance management

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import {
  TokenBalanceCreateSchema,
  TokenBalanceUpdateSchema,
} from './validators';
import {
  QueryOptions,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';

export class TokenBalanceModel {
  /**
   * Create a new token balance
   */
  static async create(data: typeof TokenBalanceCreateSchema._input): Promise<any> {
    try {
      const validatedData = TokenBalanceCreateSchema.parse(data);

      // Check for existing balance
      const existing = await prisma.tokenBalance.findUnique({
        where: {
          walletId_tokenId: {
            walletId: validatedData.walletId,
            tokenId: validatedData.tokenId,
          },
        },
      });

      if (existing && !existing.isDeleted) {
        throw new ConflictError(
          'TokenBalance',
          'walletId_tokenId',
          `${validatedData.walletId}_${validatedData.tokenId}`
        );
      }

      const balance = await prisma.tokenBalance.upsert({
        where: {
          walletId_tokenId: {
            walletId: validatedData.walletId,
            tokenId: validatedData.tokenId,
          },
        },
        create: {
          ...validatedData,
          isDeleted: false,
        },
        update: {
          ...validatedData,
          isDeleted: false,
          updatedAt: new Date(),
        },
        include: {
          wallet: true,
          token: true,
        },
      });

      logger.info('Token balance created', {
        balanceId: balance.id,
        walletId: balance.walletId,
        tokenId: balance.tokenId,
      });

      return balance;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create token balance', { data, error });
      throw new DatabaseError('Failed to create token balance', 'create', 'token_balances', error);
    }
  }

  /**
   * Find balance by ID
   */
  static async findById(id: string): Promise<any> {
    try {
      return await prisma.tokenBalance.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        include: {
          wallet: true,
          token: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find token balance by ID', { id, error });
      throw new DatabaseError('Failed to find token balance', 'findById', 'token_balances', error);
    }
  }

  /**
   * Find balances by wallet
   */
  static async findByWallet(walletId: string): Promise<any[]> {
    try {
      return await prisma.tokenBalance.findMany({
        where: {
          walletId,
          isDeleted: false,
        },
        include: {
          wallet: true,
          token: true,
        },
        orderBy: {
          balanceUSD: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find token balances by wallet', { walletId, error });
      throw new DatabaseError(
        'Failed to find token balances',
        'findByWallet',
        'token_balances',
        error
      );
    }
  }

  /**
   * Find balance by wallet and token
   */
  static async findByWalletAndToken(walletId: string, tokenId: string): Promise<any> {
    try {
      return await prisma.tokenBalance.findFirst({
        where: {
          walletId,
          tokenId,
          isDeleted: false,
        },
        include: {
          wallet: true,
          token: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find token balance', { walletId, tokenId, error });
      throw new DatabaseError(
        'Failed to find token balance',
        'findByWalletAndToken',
        'token_balances',
        error
      );
    }
  }

  /**
   * List token balances with pagination
   */
  static async list(
    options: QueryOptions & {
      walletId?: string;
      tokenId?: string;
      minValue?: number;
      maxValue?: number;
    } = {}
  ): Promise<{
    balances: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'balanceUSD',
        sortOrder = 'desc',
        includeDeleted = false,
        walletId,
        tokenId,
        minValue,
        maxValue,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.TokenBalanceWhereInput = includeDeleted ? {} : { isDeleted: false };

      if (walletId) where.walletId = walletId;
      if (tokenId) where.tokenId = tokenId;
      if (minValue !== undefined)
        where.balanceUSD = { ...(where.balanceUSD as any), gte: minValue };
      if (maxValue !== undefined)
        where.balanceUSD = { ...(where.balanceUSD as any), lte: maxValue };

      const [balances, total] = await Promise.all([
        prisma.tokenBalance.findMany({
          where,
          include: {
            wallet: true,
            token: true,
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.tokenBalance.count({ where }),
      ]);

      return {
        balances,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list token balances', { options, error });
      throw new DatabaseError('Failed to list token balances', 'list', 'token_balances', error);
    }
  }

  /**
   * Update token balance
   */
  static async update(id: string, data: typeof TokenBalanceUpdateSchema._input): Promise<any> {
    try {
      const validatedData = TokenBalanceUpdateSchema.parse(data);

      const balance = await prisma.tokenBalance.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          wallet: true,
          token: true,
        },
      });

      logger.info('Token balance updated', {
        balanceId: id,
        updatedFields: Object.keys(validatedData),
      });

      return balance;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('TokenBalance', id);
      }

      logger.error('Failed to update token balance', { id, data, error });
      throw new DatabaseError('Failed to update token balance', 'update', 'token_balances', error);
    }
  }

  /**
   * Update balance by wallet and token
   */
  static async updateByWalletAndToken(
    walletId: string,
    tokenId: string,
    data: typeof TokenBalanceUpdateSchema._input
  ): Promise<any> {
    try {
      const validatedData = TokenBalanceUpdateSchema.parse(data);

      const balance = await prisma.tokenBalance.upsert({
        where: {
          walletId_tokenId: {
            walletId,
            tokenId,
          },
        },
        create: {
          walletId,
          tokenId,
          ...validatedData,
          balance: validatedData.balance || '0',
          balanceFormatted: validatedData.balanceFormatted || '0',
          isDeleted: false,
        },
        update: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          wallet: true,
          token: true,
        },
      });

      logger.info('Token balance updated by wallet and token', {
        walletId,
        tokenId,
        balanceId: balance.id,
      });

      return balance;
    } catch (error) {
      logger.error('Failed to update token balance by wallet and token', {
        walletId,
        tokenId,
        data,
        error,
      });
      throw new DatabaseError(
        'Failed to update token balance',
        'updateByWalletAndToken',
        'token_balances',
        error
      );
    }
  }

  /**
   * Soft delete token balance
   */
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.tokenBalance.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });

      logger.info('Token balance soft deleted', { balanceId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('TokenBalance', id);
      }

      logger.error('Failed to soft delete token balance', { id, error });
      throw new DatabaseError(
        'Failed to soft delete token balance',
        'softDelete',
        'token_balances',
        error
      );
    }
  }

  /**
   * Bulk update balances
   */
  static async bulkUpdate(
    balancesData: Array<{
      walletId: string;
      tokenId: string;
      data: typeof TokenBalanceUpdateSchema._input;
    }>
  ): Promise<BatchResult<any>> {
    const startTime = Date.now();
    const results: any[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      await dbUtils.withRetry(async tx => {
        for (let i = 0; i < balancesData.length; i++) {
          try {
            const { walletId, tokenId, data } = balancesData[i];
            const validatedData = TokenBalanceUpdateSchema.parse(data);

            const balance = await tx.tokenBalance.upsert({
              where: {
                walletId_tokenId: {
                  walletId,
                  tokenId,
                },
              },
              create: {
                walletId,
                tokenId,
                ...validatedData,
                balance: validatedData.balance || '0',
                balanceFormatted: validatedData.balanceFormatted || '0',
                isDeleted: false,
              },
              update: {
                ...validatedData,
                updatedAt: new Date(),
              },
              include: {
                wallet: true,
                token: true,
              },
            });

            results.push(balance);
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk token balance update completed', {
        total: balancesData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: balancesData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk token balance update failed', { error });
      throw new DatabaseError(
        'Bulk token balance update failed',
        'bulkUpdate',
        'token_balances',
        error
      );
    }
  }

  /**
   * Get wallet portfolio value
   */
  static async getWalletPortfolioValue(walletId: string): Promise<{
    totalValueUSD: number;
    tokenCount: number;
    balances: any[];
  }> {
    try {
      const balances = await prisma.tokenBalance.findMany({
        where: {
          walletId,
          isDeleted: false,
        },
        include: {
          token: true,
        },
      });

      const totalValueUSD = balances.reduce(
        (sum, balance) => sum + Number(balance.balanceUSD || 0),
        0
      );

      return {
        totalValueUSD,
        tokenCount: balances.length,
        balances,
      };
    } catch (error) {
      logger.error('Failed to get wallet portfolio value', { walletId, error });
      throw new DatabaseError(
        'Failed to get wallet portfolio value',
        'getWalletPortfolioValue',
        'token_balances',
        error
      );
    }
  }
}
