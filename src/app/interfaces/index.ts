import type { Config } from '@/config';
import type { ChainManager } from '@/services/ChainManager';
import type { SolanaProvider } from '@/services/providers/SolanaProvider';
import type { DeFiPort } from '@/ports/DeFiPort';
import type { NFTPort } from '@/ports/NFTPort';
import type { SolanaPort } from '@/ports/SolanaPort';
import type { AsyncPortfolioService } from '@/services/AsyncPortfolioService';
import type { CostMonitoringService } from '@/services/CostMonitoringService';
import type { WorkerManager } from '@/workers/WorkerManager';

export interface ServiceDependencies {
  chainManager: ChainManager;
  solanaProvider: SolanaProvider;
  defiPort: DeFiPort;
  nftPort: NFTPort;
  solanaPort: SolanaPort;
  eventBus: any;
  workerManager: WorkerManager;
  priceService: any;
  asyncPortfolioService: AsyncPortfolioService;
  costMonitoringService: CostMonitoringService;
  runtimeConfig: Config;
}

export interface RuntimeHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    redis: boolean;
    chainManager: boolean;
    eventBus: boolean;
    workers: boolean;
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
