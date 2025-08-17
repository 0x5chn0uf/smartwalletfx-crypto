// DeFi Position Model
// Database operations for DeFi position management and tracking

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '../utils/database';
import { logger } from '../utils/logger';
import { DeFiPositionCreateSchema, DeFiPositionUpdateSchema } from './validators';
import {
  DeFiPositionWithRelations,
  DeFiPositionQueryOptions,
  DeFiAggregation,
  DatabaseError,
  NotFoundError,
  BatchResult,
} from './types';
import { z } from 'zod';

export class DeFiPositionModel {
  /**
   * Create a new DeFi position
   */
  static async create(
    data: z.infer<typeof DeFiPositionCreateSchema>
  ): Promise<DeFiPositionWithRelations> {
    try {
      const validatedData = DeFiPositionCreateSchema.parse(data);

      const position = await prisma.deFiPosition.create({
        data: {
          ...validatedData,
        },
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
      });

      logger.info('DeFi position created', {
        positionId: position.id,
        walletId: position.walletId,
        protocol: position.protocol,
        type: position.type,
      });

      return position;
    } catch (error) {
      logger.error('Failed to create DeFi position', { data, error });
      throw new DatabaseError('Failed to create DeFi position', 'create', 'defi_positions', error);
    }
  }

  /**
   * Find position by ID
   */
  static async findById(id: string): Promise<DeFiPositionWithRelations | null> {
    try {
      return await prisma.deFiPosition.findFirst({
        where: {
          id,
        },
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find DeFi position by ID', { id, error });
      throw new DatabaseError('Failed to find DeFi position', 'findById', 'defi_positions', error);
    }
  }

  /**
   * Find positions by wallet
   */
  static async findByWallet(walletId: string): Promise<DeFiPositionWithRelations[]> {
    try {
      return await prisma.deFiPosition.findMany({
        where: {
          walletId,
        },
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
        orderBy: {
          totalValueUSD: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find DeFi positions by wallet', { walletId, error });
      throw new DatabaseError(
        'Failed to find DeFi positions',
        'findByWallet',
        'defi_positions',
        error
      );
    }
  }

  /**
   * Find positions by protocol
   */
  static async findByProtocol(
    protocol: string,
    chainId?: string
  ): Promise<DeFiPositionWithRelations[]> {
    try {
      const where: Prisma.DeFiPositionWhereInput = {
        protocol,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.deFiPosition.findMany({
        where,
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
        orderBy: {
          totalValueUSD: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find DeFi positions by protocol', { protocol, chainId, error });
      throw new DatabaseError(
        'Failed to find DeFi positions',
        'findByProtocol',
        'defi_positions',
        error
      );
    }
  }

  /**
   * List positions with pagination and filters
   */
  static async list(options: DeFiPositionQueryOptions = {}): Promise<{
    positions: DeFiPositionWithRelations[];
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

        protocols,
        types,
        statuses,
        chainIds,
        minValue,
        maxValue,
        riskLevels,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.DeFiPositionWhereInput = {};

      if (protocols?.length) where.protocol = { in: protocols };
      if (types?.length) where.type = { in: types };
      if (statuses?.length) where.status = { in: statuses };
      if (chainIds?.length) where.chainId = { in: chainIds };
      if (riskLevels?.length) where.liquidationRisk = { in: riskLevels as any };
      if (minValue !== undefined) {
        where.totalValueUSD = { ...(where.totalValueUSD as Prisma.DecimalFilter), gte: minValue };
      }
      if (maxValue !== undefined) {
        where.totalValueUSD = { ...(where.totalValueUSD as Prisma.DecimalFilter), lte: maxValue };
      }

      const [positions, total] = await Promise.all([
        prisma.deFiPosition.findMany({
          where,
          include: {
            suppliedTokens: {
              include: {
                defiToken: {
                  include: {
                    token: true,
                  },
                },
              },
            },
            borrowedTokens: {
              include: {
                defiToken: {
                  include: {
                    token: true,
                  },
                },
              },
            },
            collateralTokens: {
              include: {
                defiToken: {
                  include: {
                    token: true,
                  },
                },
              },
            },
            rewards: {
              include: {
                defiToken: {
                  include: {
                    token: true,
                  },
                },
              },
            },
            yieldInfo: true,
            wallet: true,
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.deFiPosition.count({ where }),
      ]);

      return {
        positions,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list DeFi positions', { options, error });
      throw new DatabaseError('Failed to list DeFi positions', 'list', 'defi_positions', error);
    }
  }

  /**
   * Update position
   */
  static async update(
    id: string,
    data: z.infer<typeof DeFiPositionUpdateSchema>
  ): Promise<DeFiPositionWithRelations> {
    try {
      const validatedData = DeFiPositionUpdateSchema.parse(data);

      const position = await prisma.deFiPosition.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
      });

      logger.info('DeFi position updated', {
        positionId: id,
        updatedFields: Object.keys(validatedData),
      });

      return position;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('DeFiPosition', id);
      }

      logger.error('Failed to update DeFi position', { id, data, error });
      throw new DatabaseError('Failed to update DeFi position', 'update', 'defi_positions', error);
    }
  }

  /**
   * Soft delete position
   */
  /*
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.deFiPosition.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });
      
      logger.info('DeFi position soft deleted', { positionId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('DeFiPosition', id);
      }
      
      logger.error('Failed to soft delete DeFi position', { id, error });
      throw new DatabaseError(
        'Failed to soft delete DeFi position',
        'softDelete',
        'defi_positions',
        error
      );
    }
  }
  */

  /**
   * Calculate DeFi aggregation for wallet
   */
  static async calculateAggregation(walletId: string): Promise<DeFiAggregation> {
    try {
      const positions = await this.findByWallet(walletId);

      const totalValueUSD = positions.reduce(
        (sum, position) => sum + position.totalValueUSD.toNumber(),
        0
      );

      const netValueUSD = positions.reduce(
        (sum, position) => sum + position.netValueUSD.toNumber(),
        0
      );

      // Calculate supplied, borrowed, and rewards totals
      const totalSuppliedUSD = positions.reduce((sum, position) => {
        return (
          sum +
          (position.suppliedTokens?.reduce((suppliedSum, supplied) => {
            return suppliedSum + (supplied.valueUSD?.toNumber() || 0);
          }, 0) || 0)
        );
      }, 0);

      const totalBorrowedUSD = positions.reduce((sum, position) => {
        return (
          sum +
          (position.borrowedTokens?.reduce((borrowedSum, borrowed) => {
            return borrowedSum + (borrowed.valueUSD?.toNumber() || 0);
          }, 0) || 0)
        );
      }, 0);

      const totalRewardsUSD = positions.reduce((sum, position) => {
        return (
          sum +
          (position.rewards?.reduce((rewardSum, reward) => {
            return rewardSum + (reward.valueUSD?.toNumber() || 0);
          }, 0) || 0)
        );
      }, 0);

      // Protocol distribution
      const protocolMap = new Map<string, { valueUSD: number; count: number }>();
      positions.forEach(position => {
        const existing = protocolMap.get(position.protocol) || { valueUSD: 0, count: 0 };
        protocolMap.set(position.protocol, {
          valueUSD: existing.valueUSD + position.totalValueUSD.toNumber(),
          count: existing.count + 1,
        });
      });

      const protocolDistribution = Array.from(protocolMap.entries()).map(([protocol, data]) => ({
        protocol,
        valueUSD: data.valueUSD,
        percentage: totalValueUSD > 0 ? (data.valueUSD / totalValueUSD) * 100 : 0,
        positionCount: data.count,
      }));

      // Type distribution
      const typeMap = new Map<string, { valueUSD: number; count: number }>();
      positions.forEach(position => {
        const existing = typeMap.get(position.type) || { valueUSD: 0, count: 0 };
        typeMap.set(position.type, {
          valueUSD: existing.valueUSD + position.totalValueUSD.toNumber(),
          count: existing.count + 1,
        });
      });

      const typeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        valueUSD: data.valueUSD,
        percentage: totalValueUSD > 0 ? (data.valueUSD / totalValueUSD) * 100 : 0,
        positionCount: data.count,
      }));

      // Risk summary
      const positionsAtRisk = positions.filter(position =>
        ['high', 'critical'].includes(position.liquidationRisk)
      ).length;

      const totalCollateralUSD = positions.reduce((sum, position) => {
        return (
          sum +
          (position.collateralTokens?.reduce((collateralSum, collateral) => {
            return collateralSum + (collateral.valueUSD?.toNumber() || 0);
          }, 0) || 0)
        );
      }, 0);

      const healthFactors = positions
        .map(position => position.healthFactor?.toNumber())
        .filter((hf): hf is number => hf !== null && hf !== undefined);

      const averageHealthFactor =
        healthFactors.length > 0
          ? healthFactors.reduce((sum, hf) => sum + hf, 0) / healthFactors.length
          : undefined;

      const overallRisk =
        positionsAtRisk > positions.length * 0.5
          ? 'high'
          : positionsAtRisk > positions.length * 0.2
            ? 'medium'
            : 'low';

      return {
        totalValueUSD,
        netValueUSD,
        totalSuppliedUSD,
        totalBorrowedUSD,
        totalRewardsUSD,
        protocolDistribution,
        typeDistribution,
        riskSummary: {
          overallRisk,
          positionsAtRisk,
          totalCollateralUSD,
          averageHealthFactor,
        },
      };
    } catch (error) {
      logger.error('Failed to calculate DeFi aggregation', { walletId, error });
      throw new DatabaseError(
        'Failed to calculate DeFi aggregation',
        'calculateAggregation',
        'defi_positions',
        error
      );
    }
  }

  /**
   * Get positions at risk
   */
  static async getPositionsAtRisk(
    riskLevel: 'medium' | 'high' | 'critical' = 'high'
  ): Promise<DeFiPositionWithRelations[]> {
    try {
      const riskLevels =
        riskLevel === 'medium'
          ? ['medium', 'high', 'critical']
          : riskLevel === 'high'
            ? ['high', 'critical']
            : ['critical'];

      return await prisma.deFiPosition.findMany({
        where: {
          liquidationRisk: {
            in: riskLevels,
          },
          status: 'active',
        },
        include: {
          suppliedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          borrowedTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          collateralTokens: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          rewards: {
            include: {
              defiToken: {
                include: {
                  token: true,
                },
              },
            },
          },
          yieldInfo: true,
          wallet: true,
        },
        orderBy: [{ liquidationRisk: 'desc' }, { healthFactor: 'asc' }],
      });
    } catch (error) {
      logger.error('Failed to get positions at risk', { riskLevel, error });
      throw new DatabaseError(
        'Failed to get positions at risk',
        'getPositionsAtRisk',
        'defi_positions',
        error
      );
    }
  }

  /**
   * Get DeFi statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    active: number;
    totalValueUSD: number;
    totalSuppliedUSD: number;
    totalBorrowedUSD: number;
    protocolDistribution: Array<{ protocol: string; count: number; totalValue: number }>;
    typeDistribution: Array<{ type: string; count: number; totalValue: number }>;
    riskDistribution: Array<{ risk: string; count: number }>;
  }> {
    try {
      const [total, active, protocolStats, typeStats, riskStats, valueStats] = await Promise.all([
        prisma.deFiPosition.count({ where: {} }),
        prisma.deFiPosition.count({ where: { status: 'active' } }),
        prisma.deFiPosition.groupBy({
          by: ['protocol'],
          _count: { protocol: true },
          _sum: { totalValueUSD: true },
          where: {},
        }),
        prisma.deFiPosition.groupBy({
          by: ['type'],
          _count: { type: true },
          _sum: { totalValueUSD: true },
          where: {},
        }),
        prisma.deFiPosition.groupBy({
          by: ['liquidationRisk'],
          _count: { liquidationRisk: true },
          where: {},
        }),
        prisma.deFiPosition.aggregate({
          _sum: { totalValueUSD: true, netValueUSD: true },
          where: {},
        }),
      ]);

      return {
        total,
        active,
        totalValueUSD: valueStats._sum.totalValueUSD?.toNumber() || 0,
        totalSuppliedUSD: 0, // This would require complex aggregation
        totalBorrowedUSD: 0, // This would require complex aggregation
        protocolDistribution: protocolStats.map(stat => ({
          protocol: stat.protocol,
          count: stat._count.protocol,
          totalValue: stat._sum.totalValueUSD?.toNumber() || 0,
        })),
        typeDistribution: typeStats.map(stat => ({
          type: stat.type,
          count: stat._count.type,
          totalValue: stat._sum.totalValueUSD?.toNumber() || 0,
        })),
        riskDistribution: riskStats.map(stat => ({
          risk: stat.liquidationRisk,
          count: stat._count.liquidationRisk,
        })),
      };
    } catch (error) {
      logger.error('Failed to get DeFi statistics', { error });
      throw new DatabaseError(
        'Failed to get DeFi statistics',
        'getStatistics',
        'defi_positions',
        error
      );
    }
  }
}
