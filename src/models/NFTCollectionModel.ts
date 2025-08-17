// NFT Collection Model
// Database operations for NFT collection management

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '../utils/database';
import { logger } from '../utils/logger';
import { NFTCollectionCreateSchema, NFTCollectionUpdateSchema } from './validators';
import {
  NFTCollectionWithStats,
  QueryOptions,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';
import { z } from 'zod';

export class NFTCollectionModel {
  /**
   * Create a new NFT collection
   */
  static async create(
    data: z.infer<typeof NFTCollectionCreateSchema>
  ): Promise<NFTCollectionWithStats> {
    try {
      const validatedData = NFTCollectionCreateSchema.parse(data) as Prisma.NFTCollectionCreateInput;

      // Check for existing collection
      const existing = await prisma.nFTCollection.findFirst({
        where: {
          contractAddress: (validatedData.contractAddress as string).toLowerCase(),
          chainId: validatedData.chainId as string,
        },
      });

      if (existing) {
        throw new ConflictError(
          'NFTCollection',
          'contractAddress_chainId',
          `${validatedData.contractAddress}_${validatedData.chainId}`
        );
      }

      const collection = await prisma.nFTCollection.upsert({
        where: {
          chainId_contractAddress: {
            chainId: validatedData.chainId as string,
            contractAddress: (validatedData.contractAddress as string).toLowerCase(),
          },
        },
        create: {
          ...validatedData,
          contractAddress: (validatedData.contractAddress as string).toLowerCase(),
        },
        update: {
          ...validatedData,
          contractAddress: (validatedData.contractAddress as string).toLowerCase(),
          updatedAt: new Date(),
        },
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
      });

      logger.info('NFT collection created', {
        collectionId: collection.id,
        name: collection.name,
        contractAddress: collection.contractAddress,
        chainId: collection.chainId,
      });

      return collection as NFTCollectionWithStats;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create NFT collection', { data, error });
      throw new DatabaseError(
        'Failed to create NFT collection',
        'create',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Find collection by ID
   */
  static async findById(id: string): Promise<NFTCollectionWithStats | null> {
    try {
      return await prisma.nFTCollection.findFirst({
        where: {
          id,
        },
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT collection by ID', { id, error });
      throw new DatabaseError(
        'Failed to find NFT collection',
        'findById',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Find collection by contract address and chain
   */
  static async findByContract(
    contractAddress: string,
    chainId: string
  ): Promise<NFTCollectionWithStats | null> {
    try {
      return await prisma.nFTCollection.findFirst({
        where: {
          contractAddress: contractAddress.toLowerCase(),
          chainId,
        },
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT collection by contract', {
        contractAddress,
        chainId,
        error,
      });
      throw new DatabaseError(
        'Failed to find NFT collection',
        'findByContract',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Find collection by slug
   */
  static async findBySlug(slug: string): Promise<NFTCollectionWithStats | null> {
    try {
      return await prisma.nFTCollection.findFirst({
        where: {
          slug,
        },
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT collection by slug', { slug, error });
      throw new DatabaseError(
        'Failed to find NFT collection',
        'findBySlug',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Search collections by name
   */
  static async search(
    query: string,
    chainId?: string,
    limit: number = 20
  ): Promise<NFTCollectionWithStats[]> {
    try {
      const where: Prisma.NFTCollectionWhereInput = {
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
          {
            slug: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      };

      if (chainId) {
        where.chainId = chainId;
      }

      return await prisma.nFTCollection.findMany({
        where,
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
        orderBy: [{ verified: 'desc' }, { name: 'asc' }],
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to search NFT collections', { query, chainId, limit, error });
      throw new DatabaseError(
        'Failed to search NFT collections',
        'search',
        'nft_collections',
        error
      );
    }
  }

  /**
   * List collections with pagination
   */
  static async list(
    options: QueryOptions & {
      chainId?: string;
      category?: string;
      verified?: boolean;
    } = {}
  ): Promise<{
    collections: NFTCollectionWithStats[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sortBy = 'name',
        sortOrder = 'asc',

        chainId,
        category,
        verified,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.NFTCollectionWhereInput = {};

      if (chainId) where.chainId = chainId;
      if (category) where.category = category;
      if (verified !== undefined) where.verified = verified;

      const [collections, total] = await Promise.all([
        prisma.nFTCollection.findMany({
          where,
          include: {
            nftTokens: {
              take: 1,
              select: {
                id: true,
              },
            },
            _count: {
              select: {
                nftTokens: true,
                listings: true,
              },
            },
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.nFTCollection.count({ where }),
      ]);

      return {
        collections,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list NFT collections', { options, error });
      throw new DatabaseError('Failed to list NFT collections', 'list', 'nft_collections', error);
    }
  }

  /**
   * Update collection
   */
  static async update(
    id: string,
    data: z.infer<typeof NFTCollectionUpdateSchema>
  ): Promise<NFTCollectionWithStats> {
    try {
      const validatedData = NFTCollectionUpdateSchema.parse(data) as Prisma.NFTCollectionUpdateInput;

      if (validatedData.contractAddress) {
        (validatedData as any).contractAddress = (validatedData.contractAddress as string).toLowerCase();
      }

      const collection = await prisma.nFTCollection.update({
        where: { id },
        data: {
          ...(validatedData as any),
          updatedAt: new Date(),
        },
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
      });

      logger.info('NFT collection updated', {
        collectionId: id,
        updatedFields: Object.keys(validatedData),
      });

      return collection;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('NFTCollection', id);
      }

      logger.error('Failed to update NFT collection', { id, data, error });
      throw new DatabaseError(
        'Failed to update NFT collection',
        'update',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Soft delete collection
   */
  /*
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.nFTCollection.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });
      
      logger.info('NFT collection soft deleted', { collectionId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('NFTCollection', id);
      }
      
      logger.error('Failed to soft delete NFT collection', { id, error });
      throw new DatabaseError(
        'Failed to soft delete NFT collection',
        'softDelete',
        'nft_collections',
        error
      );
    }
  }
  */

  /**
   * Bulk create collections
   */
  static async bulkCreate(
    collectionsData: Array<z.infer<typeof NFTCollectionCreateSchema>>
  ): Promise<BatchResult<NFTCollectionWithStats>> {
    const startTime = Date.now();
    const results: NFTCollectionWithStats[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    try {
      await dbUtils.withRetry(async tx => {
        for (let i = 0; i < collectionsData.length; i++) {
          try {
            const validatedData = NFTCollectionCreateSchema.parse(collectionsData[i]) as Prisma.NFTCollectionCreateInput;

            const collection = await tx.nFTCollection.upsert({
              where: {
                contractAddress_chainId: {
                  contractAddress: (validatedData.contractAddress as string).toLowerCase(),
                  chainId: validatedData.chainId as string,
                },
              },
              create: {
                ...validatedData,
                contractAddress: (validatedData.contractAddress as string).toLowerCase(),
              },
              update: {
                ...validatedData,
                contractAddress: (validatedData.contractAddress as string).toLowerCase(),
                updatedAt: new Date(),
              },
              include: {
                nftTokens: {
                  take: 1,
                  select: {
                    id: true,
                  },
                },
                _count: {
                  select: {
                    nftTokens: true,
                    listings: true,
                  },
                },
              },
            });

            results.push(collection);
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Bulk NFT collection creation completed', {
        total: collectionsData.length,
        successful: results.length,
        failed: errors.length,
        duration,
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        metrics: {
          total: collectionsData.length,
          successful: results.length,
          failed: errors.length,
          duration,
        },
      };
    } catch (error) {
      logger.error('Bulk NFT collection creation failed', { error });
      throw new DatabaseError(
        'Bulk NFT collection creation failed',
        'bulkCreate',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Get trending collections
   */
  static async getTrending(
    chainId?: string,
    limit: number = 10,
    timeframe: '24h' | '7d' | '30d' = '24h'
  ): Promise<NFTCollectionWithStats[]> {
    try {
      const hoursAgo = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 720;
      const fromDate = new Date();
      fromDate.setHours(fromDate.getHours() - hoursAgo);

      const where: Prisma.NFTCollectionWhereInput = {
        verified: true,
      };

      if (chainId) {
        where.chainId = chainId;
      }

      // This is a simplified trending calculation
      // In practice, you'd want to use transaction volume, sales count, etc.
      return await prisma.nFTCollection.findMany({
        where,
        include: {
          nftTokens: {
            take: 1,
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              nftTokens: true,
              listings: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to get trending NFT collections', { chainId, limit, timeframe, error });
      throw new DatabaseError(
        'Failed to get trending NFT collections',
        'getTrending',
        'nft_collections',
        error
      );
    }
  }

  /**
   * Get collection statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    verified: number;
    totalNFTs: number;
    chainDistribution: Array<{ chainId: string; count: number }>;
    categoryDistribution: Array<{ category: string; count: number }>;
    standardDistribution: Array<{ standard: string; count: number }>;
  }> {
    try {
      const [total, verified, chainStats, categoryStats, standardStats, nftCount] =
        await Promise.all([
          prisma.nFTCollection.count({ where: {} }),
          prisma.nFTCollection.count({ where: { verified: true } }),
          prisma.nFTCollection.groupBy({
            by: ['chainId'],
            _count: { chainId: true },
            where: {},
          }),
          prisma.nFTCollection.groupBy({
            by: ['category'],
            _count: { category: true },
            where: {},
          }),
          prisma.nFTCollection.groupBy({
            by: ['standard'],
            _count: { standard: true },
            where: {},
          }),
          prisma.nFTToken.count({
            where: {
              collection: {},
            },
          }),
        ]);

      return {
        total,
        verified,
        totalNFTs: nftCount,
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
        })),
        categoryDistribution: categoryStats.map(stat => ({
          category: stat.category,
          count: stat._count.category,
        })),
        standardDistribution: standardStats.map(stat => ({
          standard: stat.standard,
          count: stat._count.standard,
        })),
      };
    } catch (error) {
      logger.error('Failed to get NFT collection statistics', { error });
      throw new DatabaseError(
        'Failed to get NFT collection statistics',
        'getStatistics',
        'nft_collections',
        error
      );
    }
  }
}