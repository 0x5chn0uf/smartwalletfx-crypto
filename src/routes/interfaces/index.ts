import type { Router } from 'express';
import type { ServiceDeps as ServiceDependencies } from '@/app/runtime';

export interface RouteFactory {
  (dependencies: ServiceDependencies): Router;
}

export interface RouteFactoryConfig {
  enableMetrics?: boolean;
  enableCaching?: boolean;
  enableValidation?: boolean;
}
