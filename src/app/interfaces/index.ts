import type { Config } from '../../config';
import type { SimpleChainManager } from '../../services/SimpleChainManager';
import type { SolanaProvider } from '../../services/providers/SolanaProvider';
import type { DeFiPort } from '../../ports/DeFiPort';
import type { NFTPort } from '../../ports/NFTPort';
import type { SolanaPort } from '../../ports/SolanaPort';
import type { AsyncPortfolioService } from '../../services/AsyncPortfolioService';

export interface ServiceDependencies {
  chainManager: SimpleChainManager;
  solanaProvider: SolanaProvider;
  defiPort: DeFiPort;
  nftPort: NFTPort;
  solanaPort: SolanaPort;
  eventBus: any;
  priceService: any;
  asyncPortfolioService: AsyncPortfolioService;
  costTracker: any;
  cacheManager: any;
  runtimeConfig: Config;
}

export interface RuntimeHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    redis: boolean;
    chainManager: boolean;
    eventBus: boolean;
    defi: boolean;
    nft: boolean;
    solana: boolean;
  };
  timestamp: string;
}

export type RuntimeState =
  | 'uninitialized'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface Runtime {
  dependencies: ServiceDependencies;
  start(config: Config): Promise<void>;
  stop(): Promise<void>;
  getHealthStatus(): RuntimeHealthStatus;
}
