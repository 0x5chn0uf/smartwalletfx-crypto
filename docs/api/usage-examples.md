# SmartWalletFX API Usage Examples and Best Practices

> **Comprehensive guide with practical examples for integrating with the SmartWalletFX Crypto Data API Phase 3**

## 🎯 Overview

This guide provides practical examples, best practices, and integration patterns for using the SmartWalletFX Crypto Data API effectively. All examples are optimized for Phase 3 features including enhanced performance, security, and cost optimization.

## 🗺️ Table of Contents

1. [Quick Start](#quick-start)
2. [Authentication](#authentication)
3. [Portfolio Integration](#portfolio-integration)
4. [DeFi Position Tracking](#defi-position-tracking)
5. [NFT Collection Management](#nft-collection-management)
6. [Multi-chain Operations](#multi-chain-operations)
7. [Error Handling](#error-handling)
8. [Performance Optimization](#performance-optimization)
9. [Best Practices](#best-practices)
10. [SDK Examples](#sdk-examples)

## 🚀 Quick Start

### Basic API Request

```bash
# Simple portfolio request
curl -X GET "https://api.smartwalletfx.com/api/portfolio/0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a" \
  -H "X-API-Key: swfx_your_api_key_here" \
  -H "Accept: application/json"
```

### Response Format

```json
{
  "success": true,
  "data": {
    "address": "0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a",
    "totalValueUSD": 12500.75,
    "netWorthUSD": 11800.50,
    "defi": {
      "totalValueUSD": 8500.25,
      "positionCount": 12,
      "protocolCount": 4
    },
    "nfts": {
      "totalValueUSD": 3500.00,
      "totalCollections": 8,
      "totalNFTs": 45
    },
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": 150,
    "cacheStatus": "hit",
    "costUsed": 0.001
  }
}
```

## 🔐 Authentication

### API Key Setup

```javascript
// JavaScript/Node.js
const API_KEY = 'swfx_your_api_key_here';
const BASE_URL = 'https://api.smartwalletfx.com';

const headers = {
  'X-API-Key': API_KEY,
  'Accept': 'application/json',
  'Content-Type': 'application/json'
};

// Make authenticated request
const response = await fetch(`${BASE_URL}/api/portfolio/address`, {
  headers: headers
});
```

```python
# Python
import requests

API_KEY = 'swfx_your_api_key_here'
BASE_URL = 'https://api.smartwalletfx.com'

headers = {
    'X-API-Key': API_KEY,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
}

# Make authenticated request
response = requests.get(f'{BASE_URL}/api/portfolio/address', headers=headers)
```

### Rate Limiting Handling

```javascript
// Rate limit aware client
class SmartWalletClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.smartwalletfx.com';
    this.rateLimitRemaining = 1000;
    this.rateLimitReset = Date.now() + 60000;
  }
  
  async makeRequest(endpoint, options = {}) {
    // Check rate limit
    if (this.rateLimitRemaining <= 10) {
      const waitTime = this.rateLimitReset - Date.now();
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Accept': 'application/json',
        ...options.headers
      }
    });
    
    // Update rate limit info
    this.rateLimitRemaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '1000');
    this.rateLimitReset = parseInt(response.headers.get('X-RateLimit-Reset') || Date.now() + 60000);
    
    return response;
  }
}
```

## 💼 Portfolio Integration

### Complete Portfolio Data

```javascript
// Comprehensive portfolio retrieval
async function getCompletePortfolio(address, options = {}) {
  const params = new URLSearchParams({
    chains: options.chains || 'ethereum,polygon,arbitrum,optimism,base',
    include: options.include || 'defi,nfts,tokens',
    refresh: options.refresh || 'false'
  });
  
  try {
    const response = await fetch(
      `${BASE_URL}/api/portfolio/${address}?${params}`,
      { headers }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error.message);
    }
    
    return data.data;
  } catch (error) {
    console.error('Portfolio fetch error:', error);
    throw error;
  }
}

// Usage
const portfolio = await getCompletePortfolio(
  '0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a',
  {
    chains: 'ethereum,polygon,arbitrum',
    include: 'defi,nfts',
    refresh: false
  }
);

console.log(`Total Value: $${portfolio.totalValueUSD.toLocaleString()}`);
console.log(`DeFi Positions: ${portfolio.defi.positionCount}`);
console.log(`NFT Collections: ${portfolio.nfts.totalCollections}`);
```

### Portfolio Tracking Dashboard

```javascript
// Real-time portfolio tracking
class PortfolioTracker {
  constructor(addresses, updateInterval = 300000) { // 5 minutes
    this.addresses = addresses;
    this.updateInterval = updateInterval;
    this.portfolios = new Map();
    this.listeners = [];
  }
  
  async startTracking() {
    // Initial load
    await this.updateAllPortfolios();
    
    // Set up periodic updates
    this.intervalId = setInterval(
      () => this.updateAllPortfolios(),
      this.updateInterval
    );
  }
  
  stopTracking() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
  
  async updateAllPortfolios() {
    const updates = await Promise.allSettled(
      this.addresses.map(address => this.updatePortfolio(address))
    );
    
    updates.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        this.notifyListeners('portfolioUpdated', {
          address: this.addresses[index],
          portfolio: result.value
        });
      } else {
        this.notifyListeners('portfolioError', {
          address: this.addresses[index],
          error: result.reason
        });
      }
    });
  }
  
  async updatePortfolio(address) {
    const portfolio = await getCompletePortfolio(address);
    const previous = this.portfolios.get(address);
    
    this.portfolios.set(address, portfolio);
    
    // Calculate changes
    if (previous) {
      const valueChange = portfolio.totalValueUSD - previous.totalValueUSD;
      const percentChange = (valueChange / previous.totalValueUSD) * 100;
      
      portfolio.changes = {
        valueChange,
        percentChange,
        timeSince: new Date(previous.lastUpdated)
      };
    }
    
    return portfolio;
  }
  
  onUpdate(callback) {
    this.listeners.push(callback);
  }
  
  notifyListeners(event, data) {
    this.listeners.forEach(callback => callback(event, data));
  }
}

// Usage
const tracker = new PortfolioTracker([
  '0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a',
  '0x8ba1f109551bD432803012645Hac136c53B5C7
]);

tracker.onUpdate((event, data) => {
  if (event === 'portfolioUpdated') {
    console.log(`Portfolio ${data.address} updated:`);
    console.log(`Value: $${data.portfolio.totalValueUSD.toLocaleString()}`);
    
    if (data.portfolio.changes) {
      console.log(`Change: ${data.portfolio.changes.percentChange.toFixed(2)}%`);
    }
  }
});

tracker.startTracking();
```

## 🛋 DeFi Position Tracking

### DeFi Positions Overview

```javascript
// Fetch and analyze DeFi positions
async function getDeFiPositions(address, options = {}) {
  const params = new URLSearchParams({
    chains: options.chains || 'ethereum,polygon,arbitrum',
    protocols: options.protocols || '',
    limit: options.limit || '50',
    page: options.page || '1'
  });
  
  const response = await fetch(
    `${BASE_URL}/api/defi/positions/${address}?${params}`,
    { headers }
  );
  
  const data = await response.json();
  return data.data;
}

// Advanced DeFi analytics
class DeFiAnalyzer {
  static analyzePositions(positions) {
    const analysis = {
      totalValue: 0,
      totalBorrowed: 0,
      protocolDistribution: {},
      riskMetrics: {
        healthFactors: [],
        liquidationRisk: 'low'
      },
      yieldSummary: {
        totalAPY: 0,
        weightedAPY: 0
      }
    };
    
    positions.forEach(position => {
      analysis.totalValue += position.valueUSD;
      
      // Protocol distribution
      if (!analysis.protocolDistribution[position.protocol]) {
        analysis.protocolDistribution[position.protocol] = {
          value: 0,
          count: 0
        };
      }
      analysis.protocolDistribution[position.protocol].value += position.valueUSD;
      analysis.protocolDistribution[position.protocol].count += 1;
      
      // Risk metrics
      if (position.health && position.health > 0) {
        analysis.riskMetrics.healthFactors.push(position.health);
      }
      
      // Yield calculation
      if (position.apy && position.valueUSD > 0) {
        analysis.yieldSummary.totalAPY += position.apy * position.valueUSD;
      }
    });
    
    // Calculate weighted APY
    if (analysis.totalValue > 0) {
      analysis.yieldSummary.weightedAPY = analysis.yieldSummary.totalAPY / analysis.totalValue;
    }
    
    // Determine liquidation risk
    const minHealthFactor = Math.min(...analysis.riskMetrics.healthFactors);
    if (minHealthFactor < 1.1) {
      analysis.riskMetrics.liquidationRisk = 'critical';
    } else if (minHealthFactor < 1.5) {
      analysis.riskMetrics.liquidationRisk = 'high';
    } else if (minHealthFactor < 2.0) {
      analysis.riskMetrics.liquidationRisk = 'medium';
    }
    
    return analysis;
  }
}

// Usage
const positions = await getDeFiPositions('0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a');
const analysis = DeFiAnalyzer.analyzePositions(positions.positions);

console.log('DeFi Analysis:', {
  totalValue: `$${analysis.totalValue.toLocaleString()}`,
  weightedAPY: `${analysis.yieldSummary.weightedAPY.toFixed(2)}%`,
  liquidationRisk: analysis.riskMetrics.liquidationRisk,
  topProtocol: Object.keys(analysis.protocolDistribution)
    .sort((a, b) => analysis.protocolDistribution[b].value - analysis.protocolDistribution[a].value)[0]
});
```

### Protocol-Specific Queries

```bash
# Aave V3 positions only
curl -X GET "https://api.smartwalletfx.com/api/defi/positions/0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a?protocols=aave-v3" \
  -H "X-API-Key: swfx_your_api_key_here"

# Multiple protocols
curl -X GET "https://api.smartwalletfx.com/api/defi/positions/0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a?protocols=aave-v3,compound-v3,uniswap-v3" \
  -H "X-API-Key: swfx_your_api_key_here"

# Specific chains
curl -X GET "https://api.smartwalletfx.com/api/defi/positions/0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a?chains=ethereum,arbitrum" \
  -H "X-API-Key: swfx_your_api_key_here"
```

## 🇫 NFT Collection Management

### NFT Portfolio Overview

```javascript
// Comprehensive NFT data retrieval
async function getNFTPortfolio(address, options = {}) {
  const params = new URLSearchParams({
    chains: options.chains || 'ethereum,polygon',
    includeMetadata: options.includeMetadata || 'true',
    limit: options.limit || '20',
    page: options.page || '1'
  });
  
  const response = await fetch(
    `${BASE_URL}/api/nft/${address}?${params}`,
    { headers }
  );
  
  return await response.json();
}

// NFT Collection Analyzer
class NFTAnalyzer {
  static analyzeCollections(collections) {
    const analysis = {
      totalValue: 0,
      totalFloorValue: 0,
      collectionCount: collections.length,
      totalNFTs: 0,
      topCollections: [],
      rarityDistribution: {
        legendary: 0,
        rare: 0,
        uncommon: 0,
        common: 0
      }
    };
    
    collections.forEach(collection => {
      analysis.totalValue += collection.totalValueUSD || 0;
      analysis.totalFloorValue += collection.floorPriceUSD * collection.tokenCount || 0;
      analysis.totalNFTs += collection.tokenCount;
      
      // Analyze individual NFTs
      if (collection.tokens) {
        collection.tokens.forEach(token => {
          if (token.rarity && token.rarity.rank) {
            const totalSupply = 10000; // Assume 10k collection
            const rarityPercentile = (token.rarity.rank / totalSupply) * 100;
            
            if (rarityPercentile <= 1) {
              analysis.rarityDistribution.legendary++;
            } else if (rarityPercentile <= 10) {
              analysis.rarityDistribution.rare++;
            } else if (rarityPercentile <= 30) {
              analysis.rarityDistribution.uncommon++;
            } else {
              analysis.rarityDistribution.common++;
            }
          }
        });
      }
    });
    
    // Sort collections by value
    analysis.topCollections = collections
      .sort((a, b) => (b.totalValueUSD || 0) - (a.totalValueUSD || 0))
      .slice(0, 5)
      .map(collection => ({
        name: collection.name,
        value: collection.totalValueUSD,
        count: collection.tokenCount,
        floorPrice: collection.floorPriceUSD
      }));
    
    return analysis;
  }
}

// Usage
const nftData = await getNFTPortfolio('0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a');
const analysis = NFTAnalyzer.analyzeCollections(nftData.data.collections);

console.log('NFT Portfolio Analysis:', {
  totalValue: `$${analysis.totalValue.toLocaleString()}`,
  totalNFTs: analysis.totalNFTs,
  collections: analysis.collectionCount,
  topCollection: analysis.topCollections[0]?.name,
  rarityBreakdown: analysis.rarityDistribution
});
```

### Collection-Specific Analysis

```javascript
// Analyze specific NFT collection
async function analyzeNFTCollection(address, contractAddress, chainId = '1') {
  const response = await fetch(
    `${BASE_URL}/api/nft/${address}/${contractAddress}?chainId=${chainId}`,
    { headers }
  );
  
  const data = await response.json();
  const collection = data.data;
  
  // Calculate collection metrics
  const metrics = {
    totalValue: collection.totalValueUSD,
    floorValue: collection.floorPriceUSD * collection.tokenCount,
    premiumOverFloor: ((collection.totalValueUSD - (collection.floorPriceUSD * collection.tokenCount)) / (collection.floorPriceUSD * collection.tokenCount)) * 100,
    averageRarity: 0,
    topTraits: {}
  };
  
  // Analyze traits and rarity
  if (collection.tokens) {
    const rarityScores = collection.tokens
      .filter(token => token.rarity && token.rarity.score)
      .map(token => token.rarity.score);
    
    if (rarityScores.length > 0) {
      metrics.averageRarity = rarityScores.reduce((sum, score) => sum + score, 0) / rarityScores.length;
    }
    
    // Analyze traits
    collection.tokens.forEach(token => {
      if (token.rarity && token.rarity.traits) {
        token.rarity.traits.forEach(trait => {
          if (!metrics.topTraits[trait.traitType]) {
            metrics.topTraits[trait.traitType] = {};
          }
          if (!metrics.topTraits[trait.traitType][trait.value]) {
            metrics.topTraits[trait.traitType][trait.value] = 0;
          }
          metrics.topTraits[trait.traitType][trait.value]++;
        });
      }
    });
  }
  
  return {
    collection,
    metrics
  };
}
```

## 🌐 Multi-chain Operations

### Cross-chain Portfolio Aggregation

```javascript
// Multi-chain portfolio aggregator
class MultiChainPortfolio {
  constructor(address) {
    this.address = address;
    this.chains = {
      'ethereum': { id: '1', name: 'Ethereum' },
      'polygon': { id: '137', name: 'Polygon' },
      'arbitrum': { id: '42161', name: 'Arbitrum' },
      'optimism': { id: '10', name: 'Optimism' },
      'base': { id: '8453', name: 'Base' }
    };
  }
  
  async getAggregatedPortfolio() {
    // Fetch data for all chains in parallel
    const chainPromises = Object.keys(this.chains).map(async (chainKey) => {
      try {
        const portfolio = await getCompletePortfolio(this.address, {
          chains: chainKey,
          include: 'defi,tokens,nfts'
        });
        
        return {
          chain: chainKey,
          chainInfo: this.chains[chainKey],
          portfolio,
          success: true
        };
      } catch (error) {
        return {
          chain: chainKey,
          chainInfo: this.chains[chainKey],
          error: error.message,
          success: false
        };
      }
    });
    
    const results = await Promise.all(chainPromises);
    
    return this.aggregateResults(results);
  }
  
  aggregateResults(results) {
    const aggregated = {
      address: this.address,
      totalValueUSD: 0,
      chains: {},
      summary: {
        defi: {
          totalValueUSD: 0,
          positionCount: 0,
          protocolCount: 0
        },
        nfts: {
          totalValueUSD: 0,
          totalCollections: 0,
          totalNFTs: 0
        },
        tokens: {
          totalValueUSD: 0,
          tokenCount: 0
        }
      },
      distribution: []
    };
    
    results.forEach(result => {
      if (result.success) {
        const portfolio = result.portfolio;
        
        // Add to total value
        aggregated.totalValueUSD += portfolio.totalValueUSD;
        
        // Store chain-specific data
        aggregated.chains[result.chain] = {
          ...result.chainInfo,
          value: portfolio.totalValueUSD,
          percentage: 0, // Will calculate later
          defi: portfolio.defi,
          nfts: portfolio.nfts,
          tokens: portfolio.tokens
        };
        
        // Aggregate summaries
        if (portfolio.defi) {
          aggregated.summary.defi.totalValueUSD += portfolio.defi.totalValueUSD || 0;
          aggregated.summary.defi.positionCount += portfolio.defi.positionCount || 0;
          aggregated.summary.defi.protocolCount += portfolio.defi.protocolCount || 0;
        }
        
        if (portfolio.nfts) {
          aggregated.summary.nfts.totalValueUSD += portfolio.nfts.totalValueUSD || 0;
          aggregated.summary.nfts.totalCollections += portfolio.nfts.totalCollections || 0;
          aggregated.summary.nfts.totalNFTs += portfolio.nfts.totalNFTs || 0;
        }
        
        if (portfolio.tokens) {
          aggregated.summary.tokens.totalValueUSD += portfolio.tokens.totalValueUSD || 0;
          aggregated.summary.tokens.tokenCount += portfolio.tokens.tokenCount || 0;
        }
      } else {
        // Store error for chain
        aggregated.chains[result.chain] = {
          ...result.chainInfo,
          error: result.error,
          value: 0,
          percentage: 0
        };
      }
    });
    
    // Calculate chain distribution percentages
    Object.keys(aggregated.chains).forEach(chainKey => {
      const chain = aggregated.chains[chainKey];
      if (chain.value && aggregated.totalValueUSD > 0) {
        chain.percentage = (chain.value / aggregated.totalValueUSD) * 100;
        
        aggregated.distribution.push({
          chain: chainKey,
          name: chain.name,
          value: chain.value,
          percentage: chain.percentage
        });
      }
    });
    
    // Sort distribution by value
    aggregated.distribution.sort((a, b) => b.value - a.value);
    
    return aggregated;
  }
}

// Usage
const multiChain = new MultiChainPortfolio('0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a');
const aggregated = await multiChain.getAggregatedPortfolio();

console.log('Multi-chain Portfolio:', {
  totalValue: `$${aggregated.totalValueUSD.toLocaleString()}`,
  primaryChain: aggregated.distribution[0]?.name,
  chainCount: aggregated.distribution.length,
  defiValue: `$${aggregated.summary.defi.totalValueUSD.toLocaleString()}`,
  nftValue: `$${aggregated.summary.nfts.totalValueUSD.toLocaleString()}`
});
```

### Solana Integration

```javascript
// Solana-specific portfolio retrieval
async function getSolanaPortfolio(address, options = {}) {
  const params = new URLSearchParams({
    include: options.include || 'tokens,nfts,defi,staking'
  });
  
  const response = await fetch(
    `${BASE_URL}/api/solana/${address}?${params}`,
    { headers }
  );
  
  return await response.json();
}

// Combined EVM + Solana portfolio
async function getCombinedPortfolio(evmAddress, solanaAddress) {
  const [evmPortfolio, solanaPortfolio] = await Promise.all([
    getCompletePortfolio(evmAddress),
    getSolanaPortfolio(solanaAddress)
  ]);
  
  return {
    evm: {
      address: evmAddress,
      ...evmPortfolio
    },
    solana: {
      address: solanaAddress,
      ...solanaPortfolio.data
    },
    combined: {
      totalValueUSD: evmPortfolio.totalValueUSD + (solanaPortfolio.data.totalValueUSD || 0),
      chains: ['evm', 'solana']
    }
  };
}
```

## ⚠️ Error Handling

### Comprehensive Error Handling

```javascript
// Robust API client with error handling
class SmartWalletAPIClient {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseURL = options.baseURL || 'https://api.smartwalletfx.com';
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
  }
  
  async makeRequest(endpoint, options = {}, attempt = 1) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'X-API-Key': this.apiKey,
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      // Handle different HTTP status codes
      if (response.status === 401) {
        throw new APIError('Unauthorized - check your API key', 'UNAUTHORIZED', 401);
      }
      
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
        throw new RateLimitError(`Rate limit exceeded. Retry after ${retryAfter} seconds`, retryAfter);
      }
      
      if (response.status === 404) {
        throw new APIError('Resource not found', 'NOT_FOUND', 404);
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new APIError(
          errorData.error?.message || 'Request failed',
          errorData.error?.code || 'UNKNOWN_ERROR',
          response.status
        );
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new APIError(
          data.error.message,
          data.error.code,
          response.status,
          data.error.details
        );
      }
      
      return data;
    } catch (error) {
      // Handle network errors and retries
      if (error instanceof TypeError && error.message.includes('fetch')) {
        if (attempt <= this.retryAttempts) {
          await this.delay(this.retryDelay * attempt);
          return this.makeRequest(endpoint, options, attempt + 1);
        }
        throw new NetworkError('Network connection failed after retries');
      }
      
      // Handle rate limiting with exponential backoff
      if (error instanceof RateLimitError && attempt <= this.retryAttempts) {
        await this.delay(error.retryAfter * 1000);
        return this.makeRequest(endpoint, options, attempt + 1);
      }
      
      // Re-throw API errors
      throw error;
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Custom error classes
class APIError extends Error {
  constructor(message, code, status, details = null) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Usage with error handling
async function safeGetPortfolio(address) {
  const client = new SmartWalletAPIClient('swfx_your_api_key_here');
  
  try {
    const response = await client.makeRequest(`/api/portfolio/${address}`);
    return response.data;
  } catch (error) {
    if (error instanceof APIError) {
      console.error(`API Error [${error.code}]:`, error.message);
      if (error.details) {
        console.error('Details:', error.details);
      }
    } else if (error instanceof RateLimitError) {
      console.error('Rate limit exceeded:', error.message);
      // Implement backoff strategy
    } else if (error instanceof NetworkError) {
      console.error('Network error:', error.message);
      // Implement offline handling
    } else {
      console.error('Unexpected error:', error);
    }
    
    throw error;
  }
}
```

## 🚀 Performance Optimization

### Batch Requests

```javascript
// Batch multiple portfolio requests
class BatchPortfolioClient {
  constructor(apiKey, batchSize = 10) {
    this.client = new SmartWalletAPIClient(apiKey);
    this.batchSize = batchSize;
  }
  
  async getMultiplePortfolios(addresses, options = {}) {
    const batches = this.chunkArray(addresses, this.batchSize);
    const results = [];
    
    for (const batch of batches) {
      const batchPromises = batch.map(address => 
        this.client.makeRequest(`/api/portfolio/${address}`, {
          method: 'GET'
        }).catch(error => ({ address, error: error.message }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to respect rate limits
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.delay(100);
      }
    }
    
    return results;
  }
  
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Caching Strategy

```javascript
// Client-side caching for better performance
class CachedAPIClient {
  constructor(apiKey, cacheOptions = {}) {
    this.client = new SmartWalletAPIClient(apiKey);
    this.cache = new Map();
    this.defaultTTL = cacheOptions.ttl || 300000; // 5 minutes
    this.maxSize = cacheOptions.maxSize || 1000;
  }
  
  async get(endpoint, options = {}) {
    const cacheKey = this.generateCacheKey(endpoint, options);
    const cached = this.cache.get(cacheKey);
    
    // Check if cached data is still valid
    if (cached && Date.now() - cached.timestamp < this.defaultTTL) {
      return {
        ...cached.data,
        metadata: {
          ...cached.data.metadata,
          cacheStatus: 'hit'
        }
      };
    }
    
    // Fetch fresh data
    const response = await this.client.makeRequest(endpoint, options);
    
    // Store in cache
    this.setCache(cacheKey, response);
    
    return {
      ...response,
      metadata: {
        ...response.metadata,
        cacheStatus: 'miss'
      }
    };
  }
  
  setCache(key, data) {
    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
  
  generateCacheKey(endpoint, options) {
    return `${endpoint}:${JSON.stringify(options)}`;
  }
  
  clearCache() {
    this.cache.clear();
  }
}
```

## ✅ Best Practices

### 1. API Key Security

```javascript
// ❌ Don't: Hardcode API keys
const API_KEY = 'swfx_1234567890abcdef'; // Bad!

// ✅ Do: Use environment variables
const API_KEY = process.env.SMARTWALLET_API_KEY;

// ✅ Do: Validate API key format
function validateAPIKey(key) {
  return key && key.startsWith('swfx_') && key.length >= 20;
}

// ✅ Do: Implement key rotation
class APIKeyManager {
  constructor() {
    this.primaryKey = process.env.SMARTWALLET_API_KEY_PRIMARY;
    this.backupKey = process.env.SMARTWALLET_API_KEY_BACKUP;
    this.currentKey = this.primaryKey;
  }
  
  async rotateKey() {
    // Test backup key
    try {
      await this.testKey(this.backupKey);
      this.currentKey = this.backupKey;
      console.log('Successfully rotated to backup key');
    } catch (error) {
      console.error('Failed to rotate key:', error.message);
    }
  }
  
  async testKey(key) {
    const response = await fetch('https://api.smartwalletfx.com/health', {
      headers: { 'X-API-Key': key }
    });
    
    if (!response.ok) {
      throw new Error('Key validation failed');
    }
  }
}
```

### 2. Request Optimization

```javascript
// ✅ Best practices for requests
class OptimizedClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.smartwalletfx.com';
  }
  
  // ✅ Use specific includes to reduce response size
  async getPortfolioTokensOnly(address) {
    return this.makeRequest(`/api/portfolio/${address}?include=tokens`);
  }
  
  // ✅ Use chain filtering to reduce cost
  async getEthereumOnlyPortfolio(address) {
    return this.makeRequest(`/api/portfolio/${address}?chains=ethereum`);
  }
  
  // ✅ Implement pagination for large datasets
  async getAllNFTs(address, pageSize = 50) {
    const allNFTs = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const response = await this.makeRequest(
        `/api/nft/${address}?limit=${pageSize}&page=${page}`
      );
      
      allNFTs.push(...response.data.collections);
      hasMore = response.data.pagination.hasNext;
      page++;
      
      // Respect rate limits
      if (hasMore) {
        await this.delay(100);
      }
    }
    
    return allNFTs;
  }
  
  // ✅ Use cache headers appropriately
  async getCachedPortfolio(address, maxAge = 300) {
    const headers = {
      'X-API-Key': this.apiKey,
      'Cache-Control': `max-age=${maxAge}`
    };
    
    return fetch(`${this.baseURL}/api/portfolio/${address}`, { headers });
  }
}
```

### 3. Error Recovery Patterns

```javascript
// ✅ Graceful degradation
class ResilientPortfolioService {
  constructor(client) {
    this.client = client;
  }
  
  async getPortfolioWithFallback(address) {
    try {
      // Try to get complete portfolio
      return await this.client.get(`/api/portfolio/${address}?include=defi,nfts,tokens`);
    } catch (error) {
      console.warn('Complete portfolio failed, trying basic:', error.message);
      
      try {
        // Fallback to basic portfolio
        return await this.client.get(`/api/portfolio/${address}?include=tokens`);
      } catch (basicError) {
        console.warn('Basic portfolio failed, using cache:', basicError.message);
        
        // Final fallback to cached data
        return this.getCachedPortfolio(address);
      }
    }
  }
  
  async getPartialPortfolio(address) {
    const promises = [
      this.client.get(`/api/portfolio/${address}?include=tokens`).catch(() => null),
      this.client.get(`/api/defi/positions/${address}`).catch(() => null),
      this.client.get(`/api/nft/${address}`).catch(() => null)
    ];
    
    const [tokens, defi, nfts] = await Promise.all(promises);
    
    return {
      address,
      tokens: tokens?.data || null,
      defi: defi?.data || null,
      nfts: nfts?.data || null,
      partial: true
    };
  }
}
```

### 4. Monitoring and Logging

```javascript
// ✅ Comprehensive logging
class MonitoredAPIClient {
  constructor(apiKey, logger) {
    this.client = new SmartWalletAPIClient(apiKey);
    this.logger = logger || console;
    this.metrics = {
      requests: 0,
      errors: 0,
      totalLatency: 0,
      cacheHits: 0
    };
  }
  
  async makeRequest(endpoint, options = {}) {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    this.logger.info('API Request Started', {
      requestId,
      endpoint,
      timestamp: new Date().toISOString()
    });
    
    try {
      this.metrics.requests++;
      
      const response = await this.client.makeRequest(endpoint, options);
      const latency = Date.now() - startTime;
      
      this.metrics.totalLatency += latency;
      
      if (response.metadata?.cacheStatus === 'hit') {
        this.metrics.cacheHits++;
      }
      
      this.logger.info('API Request Completed', {
        requestId,
        endpoint,
        latency,
        cacheStatus: response.metadata?.cacheStatus,
        cost: response.metadata?.costUsed
      });
      
      return response;
    } catch (error) {
      this.metrics.errors++;
      
      this.logger.error('API Request Failed', {
        requestId,
        endpoint,
        error: error.message,
        latency: Date.now() - startTime
      });
      
      throw error;
    }
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      averageLatency: this.metrics.totalLatency / this.metrics.requests,
      errorRate: this.metrics.errors / this.metrics.requests,
      cacheHitRate: this.metrics.cacheHits / this.metrics.requests
    };
  }
  
  generateRequestId() {
    return Math.random().toString(36).substr(2, 9);
  }
}
```

## 🛠️ SDK Examples

### TypeScript SDK

```typescript
// TypeScript SDK with full type safety
interface PortfolioData {
  address: string;
  totalValueUSD: number;
  netWorthUSD: number;
  defi?: DeFiSummary;
  nfts?: NFTSummary;
  lastUpdated: string;
}

interface DeFiSummary {
  totalValueUSD: number;
  positionCount: number;
  protocolCount: number;
  protocols: ProtocolSummary[];
}

class SmartWalletSDK {
  private client: SmartWalletAPIClient;
  
  constructor(apiKey: string) {
    this.client = new SmartWalletAPIClient(apiKey);
  }
  
  async getPortfolio(address: string, options?: {
    chains?: string[];
    include?: ('defi' | 'nfts' | 'tokens')[];
    refresh?: boolean;
  }): Promise<PortfolioData> {
    const params = new URLSearchParams();
    
    if (options?.chains) {
      params.set('chains', options.chains.join(','));
    }
    
    if (options?.include) {
      params.set('include', options.include.join(','));
    }
    
    if (options?.refresh) {
      params.set('refresh', 'true');
    }
    
    const response = await this.client.makeRequest(
      `/api/portfolio/${address}?${params}`
    );
    
    return response.data;
  }
  
  async getDeFiPositions(address: string, options?: {
    chains?: string[];
    protocols?: string[];
    limit?: number;
    page?: number;
  }): Promise<{ positions: DeFiPosition[]; summary: DeFiSummary }> {
    const params = new URLSearchParams();
    
    if (options?.chains) {
      params.set('chains', options.chains.join(','));
    }
    
    if (options?.protocols) {
      params.set('protocols', options.protocols.join(','));
    }
    
    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }
    
    if (options?.page) {
      params.set('page', options.page.toString());
    }
    
    const response = await this.client.makeRequest(
      `/api/defi/positions/${address}?${params}`
    );
    
    return response.data;
  }
}

// Usage
const sdk = new SmartWalletSDK('swfx_your_api_key_here');

const portfolio = await sdk.getPortfolio(
  '0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a',
  {
    chains: ['ethereum', 'polygon'],
    include: ['defi', 'tokens'],
    refresh: false
  }
);

console.log(`Portfolio value: $${portfolio.totalValueUSD.toLocaleString()}`);
```

### Python SDK

```python
# Python SDK example
import requests
import asyncio
import aiohttp
from typing import List, Optional, Dict, Any

class SmartWalletSDK:
    def __init__(self, api_key: str, base_url: str = "https://api.smartwalletfx.com"):
        self.api_key = api_key
        self.base_url = base_url
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={
                'X-API-Key': self.api_key,
                'Accept': 'application/json'
            },
            timeout=aiohttp.ClientTimeout(total=30)
        )
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def get_portfolio(self, 
                          address: str, 
                          chains: Optional[List[str]] = None,
                          include: Optional[List[str]] = None,
                          refresh: bool = False) -> Dict[str, Any]:
        params = {}
        
        if chains:
            params['chains'] = ','.join(chains)
        
        if include:
            params['include'] = ','.join(include)
            
        if refresh:
            params['refresh'] = 'true'
        
        url = f"{self.base_url}/api/portfolio/{address}"
        
        async with self.session.get(url, params=params) as response:
            if response.status == 200:
                data = await response.json()
                if data['success']:
                    return data['data']
                else:
                    raise Exception(f"API Error: {data['error']['message']}")
            else:
                response.raise_for_status()
    
    async def get_defi_positions(self,
                               address: str,
                               chains: Optional[List[str]] = None,
                               protocols: Optional[List[str]] = None,
                               limit: int = 50,
                               page: int = 1) -> Dict[str, Any]:
        params = {
            'limit': str(limit),
            'page': str(page)
        }
        
        if chains:
            params['chains'] = ','.join(chains)
            
        if protocols:
            params['protocols'] = ','.join(protocols)
        
        url = f"{self.base_url}/api/defi/positions/{address}"
        
        async with self.session.get(url, params=params) as response:
            response.raise_for_status()
            data = await response.json()
            return data['data']

# Usage
async def main():
    async with SmartWalletSDK('swfx_your_api_key_here') as sdk:
        portfolio = await sdk.get_portfolio(
            '0x742d35Cc6634C0532925a3b8D60c7b35C4D2C14a',
            chains=['ethereum', 'polygon'],
            include=['defi', 'tokens']
        )
        
        print(f"Portfolio value: ${portfolio['totalValueUSD']:,.2f}")
        
        if 'defi' in portfolio:
            defi_data = portfolio['defi']
            print(f"DeFi positions: {defi_data['positionCount']}")
            print(f"DeFi value: ${defi_data['totalValueUSD']:,.2f}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

**Last Updated**: Phase 3 Release  
**API Version**: 3.0.0  
**SDK Versions**: JS/TS 3.0.0, Python 3.0.0

*For API support and questions: api-support@smartwalletfx.com*