// Token Model
// Database operations for token management and price tracking

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import {
  TokenCreateSchema,
} from './validators';
import {
  TokenWithPrice,
  QueryOptions,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';

export class TokenModel {
  /**
   * Create a new token
   */
  static async create(data: typeof TokenCreateSchema._input): Promise<TokenWithPrice> {
    try {
      const validatedData = TokenCreateSchema.parse(data);

      // Check for existing token
      const existing = await prisma.token.findUnique({
        where: {
          address_chainId: {
            address: validatedData.address.toLowerCase(),
            chainId: validatedData.chainId,
          },
        },
      });

      if (existing && !existing.isDeleted) {
        throw new ConflictError(
          'Token',
          'address_chainId',
          `${validatedData.address}_${validatedData.chainId}`
        );
      }

      const token = await prisma.token.upsert({
        where: {
          address_chainId: {
            address: validatedData.address.toLowerCase(),
            chainId: validatedData.chainId,
          },
        },
        create: {
          ...validatedData,
          address: validatedData.address.toLowerCase(),
          isDeleted: false,
        },
        update: {
          ...validatedData,
          address: validatedData.address.toLowerCase(),
          isActive: true,
          isDeleted: false,
          updatedAt: new Date(),
        },
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
      });

      logger.info('Token created', {
        tokenId: token.id,
        symbol: token.symbol,
        chainId: token.chainId,
      });

      return token;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create token', { data, error });
      throw new DatabaseError('Failed to create token', 'create', 'tokens', error);
    }
  }

  /**
   * Find token by ID
   */
  static async findById(id: string): Promise<TokenWithPrice | null> {
    try {
      return await prisma.token.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find token by ID', { id, error });
      throw new DatabaseError('Failed to find token', 'findById', 'tokens', error);
    }
  }

  /**
   * Find token by address and chain
   */
  static async findByAddress(address: string, chainId: string): Promise<TokenWithPrice | null> {
    try {
      return await prisma.token.findFirst({
        where: {
          address: address.toLowerCase(),
          chainId,
          isDeleted: false,
        },
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find token by address', { address, chainId, error });
      throw new DatabaseError('Failed to find token', 'findByAddress', 'tokens', error);
    }
  }

  /**
   * Find tokens by symbol
   */
  static async findBySymbol(symbol: string, chainId?: string): Promise<TokenWithPrice[]> {
    try {
      const where: Prisma.TokenWhereInput = {
        symbol: {
          equals: symbol,
          mode: 'insensitive',
        },
        isDeleted: false,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.token.findMany({
        where,
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: [{ isNative: 'desc' }, { symbol: 'asc' }],
      });
    } catch (error) {
      logger.error('Failed to find tokens by symbol', { symbol, chainId, error });
      throw new DatabaseError('Failed to find tokens', 'findBySymbol', 'tokens', error);
    }
  }

  /**
   * Search tokens by name or symbol
   */
  static async search(
    query: string,
    chainId?: string,
    limit: number = 20
  ): Promise<TokenWithPrice[]> {
    try {
      const where: Prisma.TokenWhereInput = {
        OR: [
          {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            symbol: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
        isDeleted: false,
        isActive: true,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.token.findMany({
        where,
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: [{ isNative: 'desc' }, { isStable: 'desc' }, { symbol: 'asc' }],
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to search tokens', { query, chainId, limit, error });
      throw new DatabaseError('Failed to search tokens', 'search', 'tokens', error);
    }
  }

  /**
   * List tokens with pagination
   */
  static async list(
    options: QueryOptions & {
      chainId?: string;
      isNative?: boolean;
      isStable?: boolean;
    } = {}
  ): Promise<{
    tokens: TokenWithPrice[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'symbol',
        sortOrder = 'asc',
        includeDeleted = false,
        chainId,
        isNative,
        isStable,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.TokenWhereInput = includeDeleted ? {} : { isDeleted: false };

      if (chainId) where.chainId = chainId;
      if (isNative !== undefined) where.isNative = isNative;
      if (isStable !== undefined) where.isStable = isStable;

      const [tokens, total] = await Promise.all([
        prisma.token.findMany({
          where,
          include: {
            priceCache: {
              where: {
                expiresAt: {
                  gt: new Date(),
                },
              },
              orderBy: {
                updatedAt: 'desc',
              },
              take: 1,
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.token.count({ where }),
      ]);

      return {
        tokens,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list tokens', { options, error });
      throw new DatabaseError('Failed to list tokens', 'list', 'tokens', error);
    }
  }

  /**
   * Update token
   */
  static async update(
    id: string,
    data: Partial<typeof TokenCreateSchema._input>
  ): Promise<TokenWithPrice> {
    try {
      const token = await prisma.token.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
      });

      logger.info('Token updated', {
        tokenId: id,
        updatedFields: Object.keys(data),
      });

      return token;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Token', id);
      }

      logger.error('Failed to update token', { id, data, error });
      throw new DatabaseError('Failed to update token', 'update', 'tokens', error);
    }
  }

  /**
   * Soft delete token
   */
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.token.update({
        where: { id },
        data: {
          isDeleted: true,
          isActive: false,
          updatedAt: new Date(),
        },
      });

      logger.info('Token soft deleted', { tokenId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Token', id);
      }

      logger.error('Failed to soft delete token', { id, error });
      throw new DatabaseError('Failed to soft delete token', 'softDelete', 'tokens', error);
    }
  }

  /**
   * Bulk create tokens
   */
  static async bulkCreate(
    tokensData: Array<typeof TokenCreateSchema._input>
  ): Promise<BatchResult<TokenWithPrice>> {
    const startTime = Date.now();

    try {
      // Use upsert for bulk creation to handle duplicates
      const results = await dbUtils.withRetry(async tx => {
        const tokens: TokenWithPrice[] = [];

        for (const tokenData of tokensData) {
          const validatedData = TokenCreateSchema.parse(tokenData);

          const token = await tx.token.upsert({
            where: {
              address_chainId: {
                address: validatedData.address.toLowerCase(),
                chainId: validatedData.chainId,
              },
            },
            create: {
              ...validatedData,
              address: validatedData.address.toLowerCase(),
              isDeleted: false,
            },
            update: {
              ...validatedData,
              address: validatedData.address.toLowerCase(),
              isActive: true,
              isDeleted: false,
              updatedAt: new Date(),
            },
            include: {
              priceCache: {
                where: {
                  expiresAt: {
                    gt: new Date(),
                  },
                },
                orderBy: {
                  updatedAt: 'desc',
                },
                take: 1,
              },
            },
          });

          tokens.push(token);
        }

        return tokens;
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk token creation completed', {
        total: tokensData.length,
        successful: results.length,
        duration,
      });

      return {
        success: true,
        results,
        errors: [],
        metrics: {
          total: tokensData.length,
          successful: results.length,
          failed: 0,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk token creation failed', { error });
      throw new DatabaseError('Bulk token creation failed', 'bulkCreate', 'tokens', error);
    }
  }

  /**
   * Get native tokens for all chains
   */
  static async getNativeTokens(): Promise<TokenWithPrice[]> {
    try {
      return await prisma.token.findMany({
        where: {
          isNative: true,
          isDeleted: false,
          isActive: true,
        },
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: {
          chainId: 'asc',
        },
      });
    } catch (error) {
      logger.error('Failed to get native tokens', { error });
      throw new DatabaseError('Failed to get native tokens', 'getNativeTokens', 'tokens', error);
    }
  }

  /**
   * Get stable coins
   */
  static async getStablecoins(chainId?: string): Promise<TokenWithPrice[]> {
    try {
      const where: Prisma.TokenWhereInput = {
        isStable: true,
        isDeleted: false,
        isActive: true,
      };

      if (chainId) where.chainId = chainId;

      return await prisma.token.findMany({
        where,
        include: {
          priceCache: {
            where: {
              expiresAt: {
                gt: new Date(),
              },
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: [{ chainId: 'asc' }, { symbol: 'asc' }],
      });
    } catch (error) {
      logger.error('Failed to get stablecoins', { chainId, error });
      throw new DatabaseError('Failed to get stablecoins', 'getStablecoins', 'tokens', error);
    }
  }

  /**
   * Get token statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    active: number;
    native: number;
    stable: number;
    chainDistribution: Array<{ chainId: string; count: number }>;
  }> {
    try {
      const [total, active, native, stable, chainStats] = await Promise.all([
        prisma.token.count({ where: { isDeleted: false } }),
        prisma.token.count({ where: { isActive: true, isDeleted: false } }),
        prisma.token.count({ where: { isNative: true, isDeleted: false } }),
        prisma.token.count({ where: { isStable: true, isDeleted: false } }),
        prisma.token.groupBy({
          by: ['chainId'],
          _count: { chainId: true },
          where: { isDeleted: false },
        }),
      ]);

      return {
        total,
        active,
        native,
        stable,
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
        })),
      };
    } catch (error) {
      logger.error('Failed to get token statistics', { error });
      throw new DatabaseError('Failed to get token statistics', 'getStatistics', 'tokens', error);
    }
  }

  /**
   * Update token logo URL
   */
  static async updateLogo(id: string, logoUrl: string): Promise<void> {
    try {
      await prisma.token.update({
        where: { id },
        data: {
          logoUrl,
          updatedAt: new Date(),
        },
      });

      logger.info('Token logo updated', { tokenId: id, logoUrl });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Token', id);
      }

      logger.error('Failed to update token logo', { id, logoUrl, error });
      throw new DatabaseError('Failed to update token logo', 'updateLogo', 'tokens', error);
    }
  }
}
