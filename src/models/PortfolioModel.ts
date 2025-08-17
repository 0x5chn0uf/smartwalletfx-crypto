// Portfolio Model
// Database operations for portfolio management and tracking

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import { PortfolioCreateSchema, PortfolioUpdateSchema } from './validators';
import {
  PortfolioWithBalances,
  PortfolioQueryOptions,
  PortfolioAggregation,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';

// Decimal conversion utilities
const toNumber = (decimal: Prisma.Decimal | number | null | undefined): number => {
  if (decimal === null || decimal === undefined) return 0;
  if (typeof decimal === 'number') return decimal;
  return decimal.toNumber();
};

const toDecimal = (value: number | string | Prisma.Decimal): Prisma.Decimal => {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
};

export class PortfolioModel {
  /**
   * Create a new portfolio
   */
  static async create(data: typeof PortfolioCreateSchema._input): Promise<PortfolioWithBalances> {
    try {
      const validatedData = PortfolioCreateSchema.parse(data);

      // Check for existing portfolio
      const existing = await prisma.portfolio.findUnique({
        where: {
          walletId_chainId: {
            walletId: validatedData.walletId,
            chainId: validatedData.chainId,
          },
        },
      });

      if (existing && !existing.isDeleted) {
        throw new ConflictError(
          'Portfolio',
          'walletId_chainId',
          `${validatedData.walletId}_${validatedData.chainId}`
        );
      }

      const portfolio = await prisma.portfolio.upsert({
        where: {
          walletId_chainId: {
            walletId: validatedData.walletId,
            chainId: validatedData.chainId,
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
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
      });

      logger.info('Portfolio created', {
        portfolioId: portfolio.id,
        walletId: portfolio.walletId,
        chainId: portfolio.chainId,
      });

      return portfolio;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create portfolio', { data, error });
      throw new DatabaseError('Failed to create portfolio', 'create', 'portfolios', error);
    }
  }

  /**
   * Find portfolio by ID
   */
  static async findById(id: string): Promise<PortfolioWithBalances | null> {
    try {
      return await prisma.portfolio.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        include: {
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find portfolio by ID', { id, error });
      throw new DatabaseError('Failed to find portfolio', 'findById', 'portfolios', error);
    }
  }

  /**
   * Find portfolio by wallet and chain
   */
  static async findByWalletAndChain(
    walletId: string,
    chainId: string
  ): Promise<PortfolioWithBalances | null> {
    try {
      return await prisma.portfolio.findFirst({
        where: {
          walletId,
          chainId,
          isDeleted: false,
        },
        include: {
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find portfolio by wallet and chain', { walletId, chainId, error });
      throw new DatabaseError(
        'Failed to find portfolio',
        'findByWalletAndChain',
        'portfolios',
        error
      );
    }
  }

  /**
   * Find portfolios by wallet
   */
  static async findByWallet(walletId: string): Promise<PortfolioWithBalances[]> {
    try {
      return await prisma.portfolio.findMany({
        where: {
          walletId,
          isDeleted: false,
        },
        include: {
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
        orderBy: {
          totalValueUSD: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find portfolios by wallet', { walletId, error });
      throw new DatabaseError('Failed to find portfolios', 'findByWallet', 'portfolios', error);
    }
  }

  /**
   * List portfolios with pagination and filters
   */
  static async list(options: PortfolioQueryOptions = {}): Promise<{
    portfolios: PortfolioWithBalances[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'totalValueUSD',
        sortOrder = 'desc',
        includeDeleted = false,
        chainIds,
        minValue,
        maxValue,
        includeEmptyBalances = false,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.PortfolioWhereInput = includeDeleted ? {} : { isDeleted: false };

      if (chainIds?.length) where.chainId = { in: chainIds };
      if (minValue !== undefined) {
        where.totalValueUSD = {
          ...(typeof where.totalValueUSD === 'object' ? where.totalValueUSD : {}),
          gte: toDecimal(minValue),
        };
      }
      if (maxValue !== undefined) {
        where.totalValueUSD = {
          ...(typeof where.totalValueUSD === 'object' ? where.totalValueUSD : {}),
          lte: toDecimal(maxValue),
        };
      }
      if (!includeEmptyBalances) where.tokenCount = { gt: 0 };

      const [portfolios, total] = await Promise.all([
        prisma.portfolio.findMany({
          where,
          include: {
            wallet: {
              include: {
                tokenBalances: {
                  include: {
                    token: true,
                  },
                },
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.portfolio.count({ where }),
      ]);

      return {
        portfolios,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list portfolios', { options, error });
      throw new DatabaseError('Failed to list portfolios', 'list', 'portfolios', error);
    }
  }

  /**
   * Update portfolio
   */
  static async update(
    id: string,
    data: typeof PortfolioUpdateSchema._input
  ): Promise<PortfolioWithBalances> {
    try {
      const validatedData = PortfolioUpdateSchema.parse(data);

      const portfolio = await prisma.portfolio.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
      });

      logger.info('Portfolio updated', {
        portfolioId: id,
        updatedFields: Object.keys(validatedData),
      });

      return portfolio;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Portfolio', id);
      }

      logger.error('Failed to update portfolio', { id, data, error });
      throw new DatabaseError('Failed to update portfolio', 'update', 'portfolios', error);
    }
  }

  /**
   * Update portfolio by wallet and chain
   */
  static async updateByWalletAndChain(
    walletId: string,
    chainId: string,
    data: typeof PortfolioUpdateSchema._input
  ): Promise<PortfolioWithBalances> {
    try {
      const validatedData = PortfolioUpdateSchema.parse(data);

      const portfolio = await prisma.portfolio.upsert({
        where: {
          walletId_chainId: {
            walletId,
            chainId,
          },
        },
        create: {
          walletId,
          chainId,
          ...validatedData,
          totalValueUSD: validatedData.totalValueUSD || 0,
          tokenCount: validatedData.tokenCount || 0,
          diversificationScore: validatedData.diversificationScore || 0,
          isDeleted: false,
        },
        update: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          wallet: {
            include: {
              tokenBalances: {
                include: {
                  token: true,
                },
              },
            },
          },
        },
      });

      logger.info('Portfolio updated by wallet and chain', {
        walletId,
        chainId,
        portfolioId: portfolio.id,
      });

      return portfolio;
    } catch (error) {
      logger.error('Failed to update portfolio by wallet and chain', {
        walletId,
        chainId,
        data,
        error,
      });
      throw new DatabaseError(
        'Failed to update portfolio',
        'updateByWalletAndChain',
        'portfolios',
        error
      );
    }
  }

  /**
   * Soft delete portfolio
   */
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.portfolio.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });

      logger.info('Portfolio soft deleted', { portfolioId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('Portfolio', id);
      }

      logger.error('Failed to soft delete portfolio', { id, error });
      throw new DatabaseError('Failed to soft delete portfolio', 'softDelete', 'portfolios', error);
    }
  }

  /**
   * Calculate portfolio aggregation
   */
  static async calculateAggregation(walletId: string): Promise<PortfolioAggregation> {
    try {
      const portfolios = await this.findByWallet(walletId);

      const totalValueUSD = portfolios.reduce(
        (sum, portfolio) => sum + toNumber(portfolio.totalValueUSD),
        0
      );

      const totalTokens = portfolios.reduce((sum, portfolio) => sum + portfolio.tokenCount, 0);

      // Chain distribution
      const chainDistribution = portfolios.map(portfolio => ({
        chainId: portfolio.chainId,
        valueUSD: toNumber(portfolio.totalValueUSD),
        percentage:
          totalValueUSD > 0 ? (toNumber(portfolio.totalValueUSD) / totalValueUSD) * 100 : 0,
        tokenCount: portfolio.tokenCount,
      }));

      // Get token balances for top tokens calculation
      const allBalances = portfolios.flatMap(portfolio => portfolio.wallet.tokenBalances || []);

      const topTokens = allBalances
        .filter(balance => balance.balanceUSD && toNumber(balance.balanceUSD) > 0)
        .sort((a, b) => toNumber(b.balanceUSD) - toNumber(a.balanceUSD))
        .slice(0, 10)
        .map(balance => ({
          token: { ...balance.token, priceCache: [] } as any,
          valueUSD: toNumber(balance.balanceUSD),
          percentage: totalValueUSD > 0 ? (toNumber(balance.balanceUSD) / totalValueUSD) * 100 : 0,
        }));

      // Calculate historical changes (mock data for now)
      const change24h = { valueUSD: 0, percentage: 0 };
      const change7d = { valueUSD: 0, percentage: 0 };
      const change30d = { valueUSD: 0, percentage: 0 };

      return {
        totalValueUSD,
        totalTokens,
        chainDistribution,
        topTokens,
        change24h,
        change7d,
        change30d,
      };
    } catch (error) {
      logger.error('Failed to calculate portfolio aggregation', { walletId, error });
      throw new DatabaseError(
        'Failed to calculate portfolio aggregation',
        'calculateAggregation',
        'portfolios',
        error
      );
    }
  }

  /**
   * Get portfolio statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    active: number;
    totalValueUSD: number;
    averageValueUSD: number;
    chainDistribution: Array<{ chainId: string; count: number; totalValue: number }>;
  }> {
    try {
      const [total, active, chainStats, valueStats] = await Promise.all([
        prisma.portfolio.count({ where: { isDeleted: false } }),
        prisma.portfolio.count({ where: { isDeleted: false, tokenCount: { gt: 0 } } }),
        prisma.portfolio.groupBy({
          by: ['chainId'],
          _count: { chainId: true },
          _sum: { totalValueUSD: true },
          where: { isDeleted: false },
        }),
        prisma.portfolio.aggregate({
          _sum: { totalValueUSD: true },
          _avg: { totalValueUSD: true },
          where: { isDeleted: false },
        }),
      ]);

      return {
        total,
        active,
        totalValueUSD: toNumber(valueStats._sum.totalValueUSD),
        averageValueUSD: toNumber(valueStats._avg.totalValueUSD),
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
          totalValue: toNumber(stat._sum.totalValueUSD),
        })),
      };
    } catch (error) {
      logger.error('Failed to get portfolio statistics', { error });
      throw new DatabaseError(
        'Failed to get portfolio statistics',
        'getStatistics',
        'portfolios',
        error
      );
    }
  }
}
