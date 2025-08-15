// User Wallet Model
// Database operations for user wallet management

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import {
  UserWalletCreateSchema,
  UserWalletUpdateSchema,
} from './validators';
import {
  UserWalletWithRelations,
  QueryOptions,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';
import { validateAddress, formatAddress } from '@/types/blockchain';

export class UserWalletModel {
  /**
   * Create a new user wallet
   */
  static async create(
    data: typeof UserWalletCreateSchema._input
  ): Promise<UserWalletWithRelations> {
    try {
      // Validate input
      const validatedData = UserWalletCreateSchema.parse(data);

      // Validate and format address
      const chainId =
        validatedData.chainId === 'solana' ? 'solana' : parseInt(validatedData.chainId);
      if (!validateAddress(validatedData.address, chainId as any)) {
        throw new DatabaseError('Invalid wallet address format', 'create', 'user_wallets');
      }

      const formattedAddress = formatAddress(validatedData.address, chainId as any);

      // Check for existing wallet
      const existing = await prisma.userWallet.findUnique({
        where: {
          address_chainId: {
            address: formattedAddress,
            chainId: validatedData.chainId,
          },
        },
      });

      if (existing && !existing.isDeleted) {
        throw new ConflictError(
          'UserWallet',
          'address_chainId',
          `${formattedAddress}_${validatedData.chainId}`
        );
      }

      // Create or restore wallet
      const wallet = await prisma.userWallet.upsert({
        where: {
          address_chainId: {
            address: formattedAddress,
            chainId: validatedData.chainId,
          },
        },
        create: {
          ...validatedData,
          address: formattedAddress,
          isDeleted: false,
        },
        update: {
          name: validatedData.name,
          isActive: validatedData.isActive ?? true,
          isDeleted: false,
          updatedAt: new Date(),
        },
        include: {
          portfolios: true,
          defiPositions: true,
          nftTokens: true,
          transactions: true,
          tokenBalances: {
            include: {
              token: true,
            },
          },
        },
      });

      logger.info('User wallet created', {
        walletId: wallet.id,
        address: wallet.address,
        chainId: wallet.chainId,
      });

      return wallet;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create user wallet', { data, error });
      throw new DatabaseError('Failed to create user wallet', 'create', 'user_wallets', error);
    }
  }

  /**
   * Find wallet by ID
   */
  static async findById(id: string): Promise<UserWalletWithRelations | null> {
    try {
      return await prisma.userWallet.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        include: {
          portfolios: true,
          defiPositions: true,
          nftTokens: true,
          transactions: true,
          tokenBalances: {
            include: {
              token: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find user wallet by ID', { id, error });
      throw new DatabaseError('Failed to find user wallet', 'findById', 'user_wallets', error);
    }
  }

  /**
   * Find wallet by address and chain
   */
  static async findByAddress(
    address: string,
    chainId: string
  ): Promise<UserWalletWithRelations | null> {
    try {
      const formattedAddress = formatAddress(
        address,
        chainId === 'solana' ? 'solana' : (parseInt(chainId) as any)
      );

      return await prisma.userWallet.findFirst({
        where: {
          address: formattedAddress,
          chainId,
          isDeleted: false,
        },
        include: {
          portfolios: true,
          defiPositions: true,
          nftTokens: true,
          transactions: true,
          tokenBalances: {
            include: {
              token: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find user wallet by address', { address, chainId, error });
      throw new DatabaseError('Failed to find user wallet', 'findByAddress', 'user_wallets', error);
    }
  }

  /**
   * Find all wallets for an address across chains
   */
  static async findAllByAddress(address: string): Promise<UserWalletWithRelations[]> {
    try {
      // Format address for different chains
      const evmAddress = formatAddress(address, 1); // Ethereum format
      const solanaAddress = address; // Keep original for Solana

      return await prisma.userWallet.findMany({
        where: {
          OR: [{ address: evmAddress }, { address: solanaAddress }],
          isDeleted: false,
        },
        include: {
          portfolios: true,
          defiPositions: true,
          nftTokens: true,
          transactions: true,
          tokenBalances: {
            include: {
              token: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find wallets by address', { address, error });
      throw new DatabaseError('Failed to find wallets', 'findAllByAddress', 'user_wallets', error);
    }
  }

  /**
   * List wallets with pagination
   */
  static async list(options: QueryOptions = {}): Promise<{
    wallets: UserWalletWithRelations[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'updatedAt',
        sortOrder = 'desc',
        includeDeleted = false,
      } = options;
      const skip = (page - 1) * limit;

      const where: Prisma.UserWalletWhereInput = includeDeleted ? {} : { isDeleted: false };

      const [wallets, total] = await Promise.all([
        prisma.userWallet.findMany({
          where,
          include: {
            portfolios: true,
            defiPositions: true,
            nftTokens: true,
            transactions: true,
            tokenBalances: {
              include: {
                token: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.userWallet.count({ where }),
      ]);

      return {
        wallets,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list user wallets', { options, error });
      throw new DatabaseError('Failed to list user wallets', 'list', 'user_wallets', error);
    }
  }

  /**
   * Update wallet
   */
  static async update(
    id: string,
    data: typeof UserWalletUpdateSchema._input
  ): Promise<UserWalletWithRelations> {
    try {
      const validatedData = UserWalletUpdateSchema.parse(data);

      const wallet = await prisma.userWallet.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          portfolios: true,
          defiPositions: true,
          nftTokens: true,
          transactions: true,
          tokenBalances: {
            include: {
              token: true,
            },
          },
        },
      });

      logger.info('User wallet updated', {
        walletId: id,
        updatedFields: Object.keys(validatedData),
      });

      return wallet;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('UserWallet', id);
      }

      logger.error('Failed to update user wallet', { id, data, error });
      throw new DatabaseError('Failed to update user wallet', 'update', 'user_wallets', error);
    }
  }

  /**
   * Update last sync time
   */
  static async updateLastSync(id: string): Promise<void> {
    try {
      await prisma.userWallet.update({
        where: { id },
        data: {
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to update last sync time', { id, error });
      throw new DatabaseError(
        'Failed to update last sync time',
        'updateLastSync',
        'user_wallets',
        error
      );
    }
  }

  /**
   * Soft delete wallet
   */
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.userWallet.update({
        where: { id },
        data: {
          isDeleted: true,
          isActive: false,
          updatedAt: new Date(),
        },
      });

      logger.info('User wallet soft deleted', { walletId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('UserWallet', id);
      }

      logger.error('Failed to soft delete user wallet', { id, error });
      throw new DatabaseError(
        'Failed to soft delete user wallet',
        'softDelete',
        'user_wallets',
        error
      );
    }
  }

  /**
   * Hard delete wallet (permanent)
   */
  static async hardDelete(id: string): Promise<void> {
    try {
      await dbUtils.withRetry(async tx => {
        // Delete related records first (cascade should handle this, but being explicit)
        await tx.tokenBalance.deleteMany({ where: { walletId: id } });
        await tx.portfolio.deleteMany({ where: { walletId: id } });
        await tx.deFiPosition.deleteMany({ where: { walletId: id } });
        await tx.nFTToken.deleteMany({ where: { walletId: id } });
        await tx.transaction.deleteMany({ where: { walletId: id } });

        // Delete the wallet
        await tx.userWallet.delete({ where: { id } });
      });

      logger.warn('User wallet hard deleted', { walletId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('UserWallet', id);
      }

      logger.error('Failed to hard delete user wallet', { id, error });
      throw new DatabaseError(
        'Failed to hard delete user wallet',
        'hardDelete',
        'user_wallets',
        error
      );
    }
  }

  /**
   * Bulk create wallets
   */
  static async bulkCreate(
    walletsData: Array<typeof UserWalletCreateSchema._input>
  ): Promise<BatchResult<UserWalletWithRelations>> {
    const startTime = Date.now();
    const results: UserWalletWithRelations[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      for (let i = 0; i < walletsData.length; i++) {
        try {
          const wallet = await this.create(walletsData[i]);
          results.push(wallet);
        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Bulk wallet creation completed', {
        total: walletsData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: walletsData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk wallet creation failed', { error });
      throw new DatabaseError('Bulk wallet creation failed', 'bulkCreate', 'user_wallets', error);
    }
  }

  /**
   * Get wallet statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    active: number;
    deleted: number;
    chainDistribution: Array<{ chainId: string; count: number }>;
    recentlyCreated: number;
  }> {
    try {
      const [total, active, deleted, chainStats, recentCount] = await Promise.all([
        prisma.userWallet.count(),
        prisma.userWallet.count({ where: { isActive: true, isDeleted: false } }),
        prisma.userWallet.count({ where: { isDeleted: true } }),
        prisma.userWallet.groupBy({
          by: ['chainId'],
          _count: { chainId: true },
          where: { isDeleted: false },
        }),
        prisma.userWallet.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
            isDeleted: false,
          },
        }),
      ]);

      return {
        total,
        active,
        deleted,
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
        })),
        recentlyCreated: recentCount,
      };
    } catch (error) {
      logger.error('Failed to get wallet statistics', { error });
      throw new DatabaseError(
        'Failed to get wallet statistics',
        'getStatistics',
        'user_wallets',
        error
      );
    }
  }
}
