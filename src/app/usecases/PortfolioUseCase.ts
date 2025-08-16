import { ServiceDeps as ServiceDependencies } from '@/app/runtime';
import { redisManager } from '@/utils/redis';

export interface AggregatedPortfolioOptions {
  chains?: any[];
  includeDefi?: boolean;
  includeNfts?: boolean;
  includeMetadata?: boolean;
  includeAnalytics?: boolean;
  forceRefresh?: boolean;
  minDefiValue?: number;
  minNftValue?: number;
}

export class PortfolioUseCase {
  constructor(private readonly deps: ServiceDependencies) {}

  async getAggregatedPortfolio(address: string, options: AggregatedPortfolioOptions) {
    const cacheKey = `portfolio-complete:${address}:${JSON.stringify(options)}`;
    if (!options.forceRefresh) {
      const cached = await redisManager.get(cacheKey);
      if (cached) {
        return { cached: true, data: cached };
      }
    }

    const [defiResult, nftResult] = await Promise.all([
      options.includeDefi
        ? this.deps.defiPort
            .getDeFiPortfolio(address, {
              chainIds: options.chains,
              includeInactive: false,
            } as any)
            .catch(() => null)
        : Promise.resolve(null),
      options.includeNfts
        ? this.deps.nftPort
            .getNFTPortfolio(address, {
              chainIds: options.chains,
              includeMetadata: options.includeMetadata,
              includeAnalytics: options.includeAnalytics,
              minValue: options.minNftValue,
            } as any)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const defiData = (defiResult as any)?.success ? (defiResult as any).data : null;
    const nftData = (nftResult as any)?.success ? (nftResult as any).data : null;

    const summary = this.buildPortfolioSummary(address, defiData, nftData);

    const performanceMetrics = options.includeAnalytics
      ? this.calculatePerformanceMetrics(defiData, nftData)
      : null;
    const riskAnalysis = options.includeAnalytics
      ? this.calculateRiskAnalysis(defiData, nftData)
      : null;

    const portfolioData = {
      address,
      summary: {
        totalValueUSD: summary.totalValueUSD,
        defiValueUSD: summary.defiValueUSD,
        nftValueUSD: summary.nftValueUSD,
        netWorth: summary.netWorth,
        totalPositions: summary.totalPositions,
        totalCollections: summary.totalCollections,
        totalNFTs: summary.totalNFTs,
        lastUpdated: new Date().toISOString(),
      },
      defi: defiData,
      nfts: nftData,
      chainDistribution: summary.chainDistribution,
      assetAllocation: summary.assetAllocation,
      performanceMetrics,
      riskAnalysis,
      insights: options.includeAnalytics ? this.generatePortfolioInsights(defiData, nftData) : null,
    };

    await redisManager.set(cacheKey, portfolioData, 300);
    return { cached: false, data: portfolioData };
  }

  async getSummary(address: string, chains?: any[]) {
    const [defiResult, nftResult] = await Promise.allSettled([
      this.deps.defiPort.getDeFiPortfolio(address, { chainIds: chains, includeInactive: false } as any),
      this.deps.nftPort.getNFTPortfolio(address, { chainIds: chains, includeMetadata: false, includeListings: false } as any),
    ]);

    const defiValue =
      defiResult.status === 'fulfilled' && (defiResult.value as any).success && (defiResult.value as any).data
        ? (defiResult.value as any).data.totalValueUSD || 0
        : 0;
    const nftValue =
      nftResult.status === 'fulfilled' && (nftResult.value as any).success && (nftResult.value as any).data
        ? (nftResult.value as any).data.totalValue?.usdValue || 0
        : 0;
    const totalValue = defiValue + nftValue;

    return {
      address,
      totalValueUSD: totalValue,
      breakdown: { defiValueUSD: defiValue, nftValueUSD: nftValue },
      percentageBreakdown:
        totalValue > 0
          ? {
              defiPercentage: (defiValue / totalValue) * 100,
              nftPercentage: (nftValue / totalValue) * 100,
            }
          : null,
      lastUpdated: new Date().toISOString(),
    };
  }

  async getAsyncStatus(requestId: string) {
    return this.deps.asyncPortfolioService.getRequestStatus(requestId);
  }

  async getAsyncResult(requestId: string) {
    return this.deps.asyncPortfolioService.getRequestResult(requestId);
  }

  // --- helpers migrated from routes ---
  private buildPortfolioSummary(address: string, defiData: any, nftData: any) {
    const defiValueUSD = defiData?.totalValueUSD || 0;
    const nftValueUSD = nftData?.totalValue?.usdValue || 0;
    const totalValueUSD = defiValueUSD + nftValueUSD;

    const chainDistribution: any[] = [
      // Simplified: in-depth distribution can be added from service data
    ];

    const assetAllocation = {
      defiPercentage: totalValueUSD > 0 ? (defiValueUSD / totalValueUSD) * 100 : 0,
      nftPercentage: totalValueUSD > 0 ? (nftValueUSD / totalValueUSD) * 100 : 0,
    } as any;

    return {
      address,
      totalValueUSD,
      defiValueUSD,
      nftValueUSD,
      netWorth: totalValueUSD, // Placeholder until liabilities supported
      totalPositions: defiData?.positions?.length || 0,
      totalCollections: nftData?.collections?.length || 0,
      totalNFTs: nftData?.tokens?.length || 0,
      chainDistribution,
      assetAllocation,
    };
  }

  private calculatePerformanceMetrics(defiData: any, nftData: any) {
    return {
      apiCalls: {
        defi: defiData?.metadata?.apiCalls || 0,
        nft: nftData?.metadata?.apiCalls || 0,
      },
      cache: {
        hitRate: (defiData?.metadata?.cacheHitRate || 0 + nftData?.metadata?.cacheHitRate || 0) / 2,
      },
    };
  }

  private calculateRiskAnalysis(defiData: any, nftData: any) {
    return {
      defiRiskLevel: defiData?.risk?.level || 'unknown',
      nftMarketVolatility: nftData?.market?.volatility || 'unknown',
    };
  }

  private generatePortfolioInsights(defiData: any, nftData: any) {
    const insights: string[] = [];
    if ((defiData?.positions?.length || 0) === 0) insights.push('No DeFi positions found');
    if ((nftData?.tokens?.length || 0) === 0) insights.push('No NFTs found');
    return insights;
  }
}
