// NFT Token Model
// Database operations for NFT token management

import { Prisma } from '@prisma/client';
import { prisma, dbUtils } from '@/utils/database';
import { logger } from '@/utils/logger';
import {
  NFTTokenCreateSchema,
  NFTTokenUpdateSchema,
} from './validators';
import {
  NFTTokenWithRelations,
  NFTQueryOptions,
  NFTAggregation,
  DatabaseError,
  NotFoundError,
  ConflictError,
  BatchResult,
} from './types';

export class NFTTokenModel {
  /**
   * Create a new NFT token
   */
  static async create(data: typeof NFTTokenCreateSchema._input): Promise<NFTTokenWithRelations> {
    try {
      const validatedData = NFTTokenCreateSchema.parse(data);

      // Check for existing token
      const existing = await prisma.nFTToken.findFirst({
        where: {
          contractAddress: validatedData.contractAddress.toLowerCase(),
          tokenId: validatedData.tokenId,
          chainId: validatedData.chainId,
        },
      });

      if (existing) {
        throw new ConflictError(
          'NFTToken',
          'contractAddress_tokenId_chainId',
          `${validatedData.contractAddress}_${validatedData.tokenId}_${validatedData.chainId}`
        );
      }

      const nftToken = await prisma.nFTToken.upsert({
        where: {
          chainId_contractAddress_tokenId: {
            chainId: validatedData.chainId,
            contractAddress: validatedData.contractAddress.toLowerCase(),
            tokenId: validatedData.tokenId,
          },
        },
        create: {
          ...validatedData,
          contractAddress: validatedData.contractAddress.toLowerCase(),
          owner: validatedData.owner.toLowerCase(),
        },
        update: {
          ...validatedData,
          contractAddress: validatedData.contractAddress.toLowerCase(),
          owner: validatedData.owner.toLowerCase(),
          updatedAt: new Date(),
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
      });

      logger.info('NFT token created', {
        nftId: nftToken.id,
        name: nftToken.name,
        contractAddress: nftToken.contractAddress,
        tokenId: nftToken.tokenId,
        chainId: nftToken.chainId,
      });

      return nftToken;
    } catch (error) {
      if (error instanceof ConflictError) throw error;

      logger.error('Failed to create NFT token', { data, error });
      throw new DatabaseError('Failed to create NFT token', 'create', 'nft_tokens', error);
    }
  }

  /**
   * Find NFT token by ID
   */
  static async findById(id: string): Promise<NFTTokenWithRelations | null> {
    try {
      return await prisma.nFTToken.findFirst({
        where: {
          id,
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT token by ID', { id, error });
      throw new DatabaseError('Failed to find NFT token', 'findById', 'nft_tokens', error);
    }
  }

  /**
   * Find NFT token by contract and token ID
   */
  static async findByContractAndTokenId(
    contractAddress: string,
    tokenId: string,
    chainId: string
  ): Promise<NFTTokenWithRelations | null> {
    try {
      return await prisma.nFTToken.findFirst({
        where: {
          contractAddress: contractAddress.toLowerCase(),
          tokenId,
          chainId,
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT token by contract and token ID', {
        contractAddress,
        tokenId,
        chainId,
        error,
      });
      throw new DatabaseError(
        'Failed to find NFT token',
        'findByContractAndTokenId',
        'nft_tokens',
        error
      );
    }
  }

  /**
   * Find NFT tokens by wallet
   */
  static async findByWallet(walletId: string): Promise<NFTTokenWithRelations[]> {
    try {
      return await prisma.nFTToken.findMany({
        where: {
          walletId,
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
        orderBy: {
          lastTransferredAt: 'desc',
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT tokens by wallet', { walletId, error });
      throw new DatabaseError('Failed to find NFT tokens', 'findByWallet', 'nft_tokens', error);
    }
  }

  /**
   * Find NFT tokens by collection
   */
  static async findByCollection(collectionId: string): Promise<NFTTokenWithRelations[]> {
    try {
      return await prisma.nFTToken.findMany({
        where: {
          collectionId,
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
        orderBy: {
          rarityRank: 'asc',
        },
      });
    } catch (error) {
      logger.error('Failed to find NFT tokens by collection', { collectionId, error });
      throw new DatabaseError('Failed to find NFT tokens', 'findByCollection', 'nft_tokens', error);
    }
  }

  /**
   * Search NFT tokens
   */
  static async search(
    query: string,
    options: {
      chainId?: string;
      collectionId?: string;
      isListed?: boolean;
      limit?: number;
    } = {}
  ): Promise<NFTTokenWithRelations[]> {
    try {
      const { chainId, collectionId, isListed, limit = 20 } = options;

      const where: Prisma.NFTTokenWhereInput = {
        OR: [
          {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            tokenId: {
              contains: query,
            },
          },
        ],
      };

      if (chainId) where.chainId = chainId;
      if (collectionId) where.collectionId = collectionId;
      if (isListed !== undefined) where.isListed = isListed;

      return await prisma.nFTToken.findMany({
        where,
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
        orderBy: [{ isListed: 'desc' }, { rarityRank: 'asc' }, { name: 'asc' }],
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to search NFT tokens', { query, options, error });
      throw new DatabaseError('Failed to search NFT tokens', 'search', 'nft_tokens', error);
    }
  }

  /**
   * List NFT tokens with pagination and filters
   */
  static async list(options: NFTQueryOptions = {}): Promise<{
    tokens: NFTTokenWithRelations[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'lastTransferredAt',
        sortOrder = 'desc',

        walletId,
        collectionId,
        chainId,
        category,
        isListed,
        minPrice,
        maxPrice,
        rarityTier,
        search,
      } = options;

      const skip = (page - 1) * limit;

      const where: Prisma.NFTTokenWhereInput = {};

      if (walletId) where.walletId = walletId;
      if (collectionId) where.collectionId = collectionId;
      if (chainId) where.chainId = chainId;
      if (isListed !== undefined) where.isListed = isListed;
      if (rarityTier) where.rarityTier = rarityTier;

      if (category) {
        where.collection = {
          category,
        };
      }

      if (minPrice !== undefined || maxPrice !== undefined) {
        where.estimatedValueUSD = {};
        if (minPrice !== undefined) where.estimatedValueUSD.gte = minPrice;
        if (maxPrice !== undefined) where.estimatedValueUSD.lte = maxPrice;
      }

      if (search) {
        where.OR = [
          {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            tokenId: {
              contains: search,
            },
          },
        ];
      }

      const [tokens, total] = await Promise.all([
        prisma.nFTToken.findMany({
          where,
          include: {
            collection: true,
            ownership: {
              orderBy: {
                acquiredAt: 'desc',
              },
            },
            listings: {
              where: {
                status: 'active',
              },
            },
            wallet: true,
          },
          orderBy: {
            [sortBy]: sortOrder,
          },
          skip,
          take: limit,
        }),
        prisma.nFTToken.count({ where }),
      ]);

      return {
        tokens,
        total,
        page,
        limit,
      };
    } catch (error) {
      logger.error('Failed to list NFT tokens', { options, error });
      throw new DatabaseError('Failed to list NFT tokens', 'list', 'nft_tokens', error);
    }
  }

  /**
   * Update NFT token
   */
  static async update(
    id: string,
    data: typeof NFTTokenUpdateSchema._input
  ): Promise<NFTTokenWithRelations> {
    try {
      const validatedData = NFTTokenUpdateSchema.parse(data);

      if (validatedData.contractAddress) {
        validatedData.contractAddress = validatedData.contractAddress.toLowerCase();
      }
      if (validatedData.owner) {
        validatedData.owner = validatedData.owner.toLowerCase();
      }

      const nftToken = await prisma.nFTToken.update({
        where: { id },
        data: {
          ...validatedData,
          updatedAt: new Date(),
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
      });

      logger.info('NFT token updated', {
        nftId: id,
        updatedFields: Object.keys(validatedData),
      });

      return nftToken;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('NFTToken', id);
      }

      logger.error('Failed to update NFT token', { id, data, error });
      throw new DatabaseError('Failed to update NFT token', 'update', 'nft_tokens', error);
    }
  }

  /**
   * Transfer NFT token ownership
   */
  static async transfer(
    id: string,
    newOwner: string,
    newWalletId: string,
    transactionHash?: string
  ): Promise<NFTTokenWithRelations> {
    try {
      const nftToken = await prisma.nFTToken.update({
        where: { id },
        data: {
          owner: newOwner.toLowerCase(),
          walletId: newWalletId,
          lastTransferredAt: new Date(),
          updatedAt: new Date(),
        },
        include: {
          collection: true,
          ownership: {
            orderBy: {
              acquiredAt: 'desc',
            },
          },
          listings: {
            where: {
              status: 'active',
            },
          },
          wallet: true,
        },
      });

      logger.info('NFT token transferred', {
        nftId: id,
        newOwner,
        newWalletId,
        transactionHash,
      });

      return nftToken;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('NFTToken', id);
      }

      logger.error('Failed to transfer NFT token', { id, newOwner, newWalletId, error });
      throw new DatabaseError('Failed to transfer NFT token', 'transfer', 'nft_tokens', error);
    }
  }

  /**
   * Soft delete NFT token
   */
  /*
  static async softDelete(id: string): Promise<void> {
    try {
      await prisma.nFTToken.update({
        where: { id },
        data: {
          isDeleted: true,
          updatedAt: new Date(),
        },
      });
      
      logger.info('NFT token soft deleted', { nftId: id });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundError('NFTToken', id);
      }
      
      logger.error('Failed to soft delete NFT token', { id, error });
      throw new DatabaseError(
        'Failed to soft delete NFT token',
        'softDelete',
        'nft_tokens',
        error
      );
    }
  }
  */

  /**
   * Calculate NFT aggregation for wallet
   */
  static async calculateAggregation(walletId: string): Promise<NFTAggregation> {
    try {
      const tokens = await this.findByWallet(walletId);

      const totalNFTs = tokens.length;
      const collections = new Set(tokens.map(token => token.collectionId));
      const totalCollections = collections.size;

      const totalValueUSD = tokens.reduce(
        (sum, token) => sum + (token.estimatedValueUSD?.toNumber() || 0),
        0
      );

      const floorValueUSD = tokens.reduce(
        (sum, token) => sum + (token.floorPriceUSD?.toNumber() || 0),
        0
      );

      // Chain distribution
      const chainMap = new Map<string, { count: number; valueUSD: number }>();
      tokens.forEach(token => {
        const existing = chainMap.get(token.chainId) || { count: 0, valueUSD: 0 };
        chainMap.set(token.chainId, {
          count: existing.count + 1,
          valueUSD: existing.valueUSD + (token.estimatedValueUSD?.toNumber() || 0),
        });
      });

      const chainDistribution = Array.from(chainMap.entries()).map(([chainId, data]) => ({
        chainId,
        count: data.count,
        valueUSD: data.valueUSD,
        percentage: totalNFTs > 0 ? (data.count / totalNFTs) * 100 : 0,
      }));

      // Category distribution
      const categoryMap = new Map<string, { count: number; valueUSD: number }>();
      tokens.forEach(token => {
        const category = token.collection?.category || 'unknown';
        const existing = categoryMap.get(category) || { count: 0, valueUSD: 0 };
        categoryMap.set(category, {
          count: existing.count + 1,
          valueUSD: existing.valueUSD + (token.estimatedValueUSD?.toNumber() || 0),
        });
      });

      const categoryDistribution = Array.from(categoryMap.entries()).map(([category, data]) => ({
        category,
        count: data.count,
        valueUSD: data.valueUSD,
        percentage: totalNFTs > 0 ? (data.count / totalNFTs) * 100 : 0,
      }));

      // Top collections
      const collectionMap = new Map<
        string,
        {
          collection: any;
          count: number;
          totalValue: number;
        }
      >();

      tokens.forEach(token => {
        if (token.collection) {
          const existing = collectionMap.get(token.collectionId) || {
            collection: token.collection,
            count: 0,
            totalValue: 0,
          };
          collectionMap.set(token.collectionId, {
            collection: token.collection,
            count: existing.count + 1,
            totalValue: existing.totalValue + (token.estimatedValueUSD?.toNumber() || 0),
          });
        }
      });

      const topCollections = Array.from(collectionMap.values())
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, 10)
        .map(data => ({
          collection: data.collection,
          ownedCount: data.count,
          totalValueUSD: data.totalValue,
          averageValueUSD: data.count > 0 ? data.totalValue / data.count : 0,
        }));

      return {
        totalNFTs,
        totalCollections,
        totalValueUSD,
        floorValueUSD,
        chainDistribution,
        categoryDistribution,
        topCollections,
      };
    } catch (error) {
      logger.error('Failed to calculate NFT aggregation', { walletId, error });
      throw new DatabaseError(
        'Failed to calculate NFT aggregation',
        'calculateAggregation',
        'nft_tokens',
        error
      );
    }
  }

  /**
   * Get NFT statistics
   */
  static async getStatistics(): Promise<{
    total: number;
    listed: number;
    totalValueUSD: number;
    averageValueUSD: number;
    chainDistribution: Array<{ chainId: string; count: number }>;
    categoryDistribution: Array<{ category: string; count: number }>;
    rarityDistribution: Array<{ rarity: string; count: number }>;
  }> {
    try {
      const [total, listed, chainStats, categoryStats, rarityStats, valueStats] = await Promise.all(
        [
          prisma.nFTToken.count({ where: {} }),
          prisma.nFTToken.count({ where: { isListed: true } }),
          prisma.nFTToken.groupBy({
            by: ['chainId'],
            _count: { chainId: true },
            where: {},
          }),
          prisma.nFTToken.groupBy({
            by: ['chainId'],
            _count: { chainId: true },
            where: {},
          }),
          prisma.nFTToken.groupBy({
            by: ['rarityTier'],
            _count: { rarityTier: true },
            where: { isDeleted: false, rarityTier: { not: null } },
          }),
          prisma.nFTToken.aggregate({
            _sum: { estimatedValueUSD: true },
            _avg: { estimatedValueUSD: true },
            where: {},
          }),
        ]
      );

      return {
        total,
        listed,
        totalValueUSD: valueStats._sum.estimatedValueUSD?.toNumber() || 0,
        averageValueUSD: valueStats._avg.estimatedValueUSD?.toNumber() || 0,
        chainDistribution: chainStats.map(stat => ({
          chainId: stat.chainId,
          count: stat._count.chainId,
        })),
        categoryDistribution: categoryStats.map(stat => ({
          category: stat.chainId, // This should be fixed to use actual categories
          count: stat._count.chainId,
        })),
        rarityDistribution: rarityStats.map(stat => ({
          rarity: stat.rarityTier || 'unknown',
          count: stat._count.rarityTier,
        })),
      };
    } catch (error) {
      logger.error('Failed to get NFT statistics', { error });
      throw new DatabaseError('Failed to get NFT statistics', 'getStatistics', 'nft_tokens', error);
    }
  }
}
