/**
 * Feature Flags for Complex Subsystems
 *
 * Gates intelligent batching, ML prediction, and optimizers behind flags
 * as specified in PRD section 6 - Feature Flags for Complex Subsystems.
 */

import { Config } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Feature flag definitions
 */
export interface FeatureFlags {
  // Core features
  websockets: boolean;
  graphql: boolean;
  swagger: boolean;
  cacheWarming: boolean;
  asyncPortfolio: boolean;

  // Intelligent/ML subsystems
  intelligentBatching: boolean;
  mlCacheWarming: boolean;
  mlPrediction: boolean;
  intelligentProviderRouting: boolean;
  costOptimization: boolean;
  realTimeOptimizer: boolean;
  predictiveAnalytics: boolean;

  // Performance features
  adaptiveConcurrency: boolean;
  intelligentRetries: boolean;
  dynamicRateLimiting: boolean;
  requestDeduplication: boolean;

  // Advanced monitoring
  enhancedMetrics: boolean;
  performanceTracking: boolean;
  anomalyDetection: boolean;

  // Experimental features
  experimental: {
    neuralNetworkRouting: boolean;
    quantumComputing: boolean;
    blockchainML: boolean;
    aiPortfolioAnalysis: boolean;
  };
}

/**
 * Default feature flag values (production-safe)
 */
const DEFAULT_FEATURES: FeatureFlags = {
  // Core features - enabled by default
  websockets: false,
  graphql: false,
  swagger: true,
  cacheWarming: true,
  asyncPortfolio: true,

  // Intelligent/ML subsystems - disabled by default for safety
  intelligentBatching: false,
  mlCacheWarming: false,
  mlPrediction: false,
  intelligentProviderRouting: false,
  costOptimization: false,
  realTimeOptimizer: false,
  predictiveAnalytics: false,

  // Performance features - selective enabling
  adaptiveConcurrency: true,
  intelligentRetries: true,
  dynamicRateLimiting: false,
  requestDeduplication: true,

  // Advanced monitoring - enabled for observability
  enhancedMetrics: true,
  performanceTracking: true,
  anomalyDetection: false,

  // Experimental features - all disabled by default
  experimental: {
    neuralNetworkRouting: false,
    quantumComputing: false,
    blockchainML: false,
    aiPortfolioAnalysis: false,
  },
};

/**
 * Environment-based feature flag overrides
 */
function getEnvironmentFeatures(): Partial<FeatureFlags> {
  const env = process.env.NODE_ENV;

  switch (env) {
    case 'development':
      return {
        swagger: true,
        websockets: true,
        enhancedMetrics: true,
        performanceTracking: true,
        // Enable some ML features for testing
        intelligentBatching: process.env.ENABLE_ML_FEATURES === 'true',
        mlCacheWarming: process.env.ENABLE_ML_FEATURES === 'true',
      };

    case 'staging':
      return {
        swagger: true,
        intelligentBatching: true,
        mlCacheWarming: true,
        costOptimization: true,
        enhancedMetrics: true,
        performanceTracking: true,
        anomalyDetection: true,
      };

    case 'production':
      return {
        swagger: process.env.ENABLE_SWAGGER === 'true',
        // ML features only if explicitly enabled
        intelligentBatching: process.env.ENABLE_INTELLIGENT_BATCHING === 'true',
        mlCacheWarming: process.env.ENABLE_ML_CACHE_WARMING === 'true',
        mlPrediction: process.env.ENABLE_ML_PREDICTION === 'true',
        intelligentProviderRouting: process.env.ENABLE_INTELLIGENT_ROUTING === 'true',
        costOptimization: process.env.ENABLE_COST_OPTIMIZATION === 'true',
        realTimeOptimizer: process.env.ENABLE_REAL_TIME_OPTIMIZER === 'true',
      };

    case 'test':
      return {
        // Disable most features for testing
        websockets: false,
        swagger: false,
        cacheWarming: false,
        asyncPortfolio: false,
        intelligentBatching: false,
        mlCacheWarming: false,
        enhancedMetrics: false,
      };

    default:
      return {};
  }
}

/**
 * Load feature flags from environment and config
 */
function loadFeatureFlags(config: Config): FeatureFlags {
  const baseFeatures = { ...DEFAULT_FEATURES };
  const envFeatures = getEnvironmentFeatures();
  const configFeatures = config.features || {};

  // Merge configurations with precedence: env > config > defaults
  const mergedFeatures = {
    ...baseFeatures,
    ...configFeatures,
    ...envFeatures,
    experimental: {
      ...baseFeatures.experimental,
      ...configFeatures.experimental,
      ...envFeatures.experimental,
    },
  };

  // Environment variable overrides for specific flags
  Object.keys(mergedFeatures).forEach(key => {
    if (key === 'experimental') return; // Handle separately

    const envKey = `FEATURE_${key.toUpperCase()}`;
    const envValue = process.env[envKey];

    if (envValue !== undefined) {
      (mergedFeatures as any)[key] = envValue.toLowerCase() === 'true';
    }
  });

  // Handle experimental features
  Object.keys(mergedFeatures.experimental).forEach(key => {
    const envKey = `EXPERIMENTAL_${key.toUpperCase()}`;
    const envValue = process.env[envKey];

    if (envValue !== undefined) {
      (mergedFeatures.experimental as any)[key] = envValue.toLowerCase() === 'true';
    }
  });

  return mergedFeatures;
}

/**
 * Global feature flags instance
 */
export function getFeatureFlags(config: Config): FeatureFlags {
  return loadFeatureFlags(config);
}

/**
 * Feature flag checker functions
 */
export class FeatureChecker {
  private static loggedFeatures = new Set<string>();
  private _features: FeatureFlags;

  constructor(features: FeatureFlags) {
    this._features = features;
  }

  /**
   * Check if a feature is enabled with optional logging
   */
  isEnabled(feature: keyof FeatureFlags, logUsage = false): boolean {
    const enabled = this._features[feature] as boolean;

    if (logUsage && !FeatureChecker.loggedFeatures.has(feature)) {
      logger.info('Feature flag checked', {
        feature,
        enabled,
        environment: process.env.NODE_ENV,
      });
      FeatureChecker.loggedFeatures.add(feature);
    }

    return enabled;
  }

  /**
   * Check if an experimental feature is enabled
   */
  isExperimentalEnabled(feature: keyof FeatureFlags['experimental'], logUsage = false): boolean {
    const enabled = this._features.experimental[feature];

    if (logUsage && !FeatureChecker.loggedFeatures.has(`experimental.${feature}`)) {
      logger.info('Experimental feature flag checked', {
        feature: `experimental.${feature}`,
        enabled,
        environment: process.env.NODE_ENV,
      });
      FeatureChecker.loggedFeatures.add(`experimental.${feature}`);
    }

    return enabled;
  }

  /**
   * Require a feature to be enabled (throws if disabled)
   */
  requireFeature(feature: keyof FeatureFlags, message?: string): void {
    if (!this.isEnabled(feature)) {
      const error = message || `Feature '${feature}' is required but disabled`;
      throw new Error(error);
    }
  }

  /**
   * Get feature status summary
   */
  getSummary(): {
    total: number;
    enabled: number;
    disabled: number;
    experimental: number;
    experimentalEnabled: number;
  } {
    const mainFeatures = Object.keys(this._features).filter(key => key !== 'experimental');
    const experimentalFeatures = Object.keys(this._features.experimental);

    const enabledMain = mainFeatures.filter(key => (this._features as any)[key]).length;
    const enabledExperimental = experimentalFeatures.filter(
      key => this._features.experimental[key as keyof FeatureFlags['experimental']]
    ).length;

    return {
      total: mainFeatures.length,
      enabled: enabledMain,
      disabled: mainFeatures.length - enabledMain,
      experimental: experimentalFeatures.length,
      experimentalEnabled: enabledExperimental,
    };
  }
}

/**
 * Feature flag middleware for Express routes
 */
export function requireFeature(features: FeatureFlags, feature: keyof FeatureFlags) {
  return (req: any, res: any, next: any) => {
    if (!new FeatureChecker(features).isEnabled(feature)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FEATURE_DISABLED',
          message: `Feature '${feature}' is disabled`,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }
    next();
  };
}

/**
 * Experimental feature middleware
 */
export function requireExperimentalFeature(
  features: FeatureFlags,
  feature: keyof FeatureFlags['experimental']
) {
  return (req: any, res: any, next: any) => {
    if (!new FeatureChecker(features).isExperimentalEnabled(feature)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'EXPERIMENTAL_FEATURE_DISABLED',
          message: `Experimental feature '${feature}' is disabled`,
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }
    next();
  };
}

/**
 * Deterministic batching implementation (default path)
 */
export class DeterministicBatcher {
  private static readonly BATCH_SIZE = 10;
  private static readonly BATCH_TIMEOUT = 100; // ms

  static async batchRequests<T, R>(
    requests: T[],
    processor: (batch: T[]) => Promise<R[]>
  ): Promise<R[]> {
    const results: R[] = [];

    // Simple batching without ML/intelligence
    for (let i = 0; i < requests.length; i += this.BATCH_SIZE) {
      const batch = requests.slice(i, i + this.BATCH_SIZE);

      try {
        const batchResults = await processor(batch);
        results.push(...batchResults);
      } catch (error) {
        logger.error('Deterministic batch processing failed', {
          batchIndex: Math.floor(i / this.BATCH_SIZE),
          batchSize: batch.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }

      // Small delay between batches to avoid overwhelming providers
      if (i + this.BATCH_SIZE < requests.length) {
        await new Promise(resolve => setTimeout(resolve, this.BATCH_TIMEOUT));
      }
    }

    return results;
  }
}

/**
 * Feature-aware service factory
 */
export function createServiceWithFeatures<T>(
  features: FeatureFlags,
  defaultImplementation: () => T,
  intelligentImplementation?: () => T,
  feature?: keyof FeatureFlags
): T {
  if (feature && intelligentImplementation && new FeatureChecker(features).isEnabled(feature)) {
    logger.info('Using intelligent implementation', { feature });
    return intelligentImplementation();
  }

  logger.info('Using default implementation', { feature: feature || 'none' });
  return defaultImplementation();
}

/**
 * Initialize feature flags and log status
 */
export function initializeFeatures(features: FeatureFlags): void {
  const summary = new FeatureChecker(features).getSummary();

  logger.info('Feature flags initialized', {
    environment: process.env.NODE_ENV,
    summary,
    enabledFeatures: Object.entries(features)
      .filter(([key, value]) => key !== 'experimental' && value)
      .map(([key]) => key),
    enabledExperimental: Object.entries(features.experimental)
      .filter(([, value]) => value)
      .map(([key]) => key),
  });

  // Warn about enabled experimental features in production
  if (process.env.NODE_ENV === 'production') {
    const enabledExperimental = Object.entries(features.experimental)
      .filter(([, value]) => value)
      .map(([key]) => key);

    if (enabledExperimental.length > 0) {
      logger.warn('Experimental features enabled in production', {
        features: enabledExperimental,
      });
    }
  }
}
