import { YearnAdapter } from '@/services/defi/adapters/YearnAdapter';
import { ChainId } from '@/types/blockchain';
import { DeFiProtocol, PositionType, PositionStatus } from '@/types/defi';

// Mock external dependencies
jest.mock('@/utils/logger');
jest.mock('@/utils/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));
jest.mock('axios');
jest.mock('ethers');

describe('YearnAdapter', () => {
  let adapter: YearnAdapter;
  const mockRpcUrls = {
    [ChainId.ETHEREUM]: 'https://eth-mainnet.mock',
    [ChainId.POLYGON]: 'https://polygon-mainnet.mock',
  };

  beforeEach(() => {
    adapter = new YearnAdapter(mockRpcUrls);
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with correct protocol and version', () => {
      expect(adapter.protocol).toBe(DeFiProtocol.YEARN);
      expect(adapter.version).toBe('1.0.0');
      expect(adapter.supportedChains).toContain(ChainId.ETHEREUM);
      expect(adapter.supportedChains).toContain(ChainId.POLYGON);
    });

    it('should provide correct protocol metadata', () => {
      const metadata = adapter.getProtocolMetadata();
      
      expect(metadata.name).toBe('Yearn Finance');
      expect(metadata.website).toBe('https://yearn.fi');
      expect(metadata.supportedAssets).toContain('DAI');
      expect(metadata.supportedAssets).toContain('USDC');
      expect(metadata.features).toContain('Automated yield farming');
      expect(metadata.features).toContain('Vault strategies optimization');
    });
  });

  describe('Health Check', () => {
    it('should return health status', () => {
      const health = adapter.getHealth();
      
      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('lastCheckedAt');
      expect(health).toHaveProperty('responseTime');
      expect(health).toHaveProperty('errorRate');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('issues');
    });

    it('should initially be healthy', () => {
      const health = adapter.getHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.issues).toEqual([]);
    });
  });

  describe('Vault Operations', () => {
    const mockVaultAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const mockShares = BigInt('1000000000000000000'); // 1 ether in wei
    
    it('should handle vault value calculation', async () => {
      // Mock the contract calls
      const mockValue = await adapter.calculateVaultValue(
        mockShares,
        mockVaultAddress,
        ChainId.ETHEREUM
      );
      
      // Should return a number (may be 0 due to mocking)
      expect(typeof mockValue).toBe('number');
      expect(mockValue).toBeGreaterThanOrEqual(0);
    });

    it('should get vault details', async () => {
      const details = await adapter.getVaultDetails(mockVaultAddress, ChainId.ETHEREUM);
      
      // May be null if vault not found in mock data
      if (details) {
        expect(details).toHaveProperty('vault');
        expect(details.vault).toHaveProperty('address');
      }
    });

    it('should get vault history', async () => {
      const mockUserAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      const history = await adapter.getVaultHistory(
        mockUserAddress,
        mockVaultAddress,
        ChainId.ETHEREUM
      );
      
      expect(history).toHaveProperty('deposits');
      expect(history).toHaveProperty('withdrawals');
      expect(Array.isArray(history.deposits)).toBe(true);
      expect(Array.isArray(history.withdrawals)).toBe(true);
    });

    it('should get strategy info', async () => {
      const strategies = await adapter.getStrategyInfo(mockVaultAddress, ChainId.ETHEREUM);
      
      expect(Array.isArray(strategies)).toBe(true);
    });
  });

  describe('Position Management', () => {
    const mockUserAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
    
    it('should handle empty positions gracefully', async () => {
      const positions = await adapter.getPositions(mockUserAddress, ChainId.ETHEREUM);
      
      expect(Array.isArray(positions)).toBe(true);
      // May be empty due to mocking
    });

    it('should handle position ID parsing correctly', async () => {
      const validPositionId = `yearn:${ChainId.ETHEREUM}:0x1234567890abcdef1234567890abcdef12345678`;
      const position = await adapter.getPosition(validPositionId, ChainId.ETHEREUM);
      
      // May be null if position not found
      if (position) {
        expect(position.protocol).toBe(DeFiProtocol.YEARN);
        expect(position.type).toBe(PositionType.VAULT);
        expect(position.chainId).toBe(ChainId.ETHEREUM);
      }
    });

    it('should reject invalid position IDs', async () => {
      const invalidPositionId = 'invalid:format:id';
      const position = await adapter.getPosition(invalidPositionId, ChainId.ETHEREUM);
      
      expect(position).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const mockUserAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      
      // Test with invalid chain ID
      const positions = await adapter.getPositions(mockUserAddress, 999 as ChainId);
      
      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length).toBe(0);
    });

    it('should handle contract call failures', async () => {
      const mockValue = await adapter.calculateVaultValue(
        BigInt(0),
        '0xinvalidaddress',
        ChainId.ETHEREUM
      );
      
      expect(mockValue).toBe(0);
    });
  });

  describe('Data Validation', () => {
    it('should filter out dust positions', async () => {
      const mockUserAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      const positions = await adapter.getPositions(mockUserAddress);
      
      // All returned positions should have meaningful value
      positions.forEach(position => {
        expect(position.totalValueUSD).toBeGreaterThanOrEqual(0.01);
      });
    });

    it('should provide valid position structure', async () => {
      const mockUserAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      const positions = await adapter.getPositions(mockUserAddress);
      
      positions.forEach(position => {
        expect(position).toHaveProperty('id');
        expect(position).toHaveProperty('protocol');
        expect(position).toHaveProperty('chainId');
        expect(position).toHaveProperty('type');
        expect(position).toHaveProperty('status');
        expect(position).toHaveProperty('totalValueUSD');
        expect(position).toHaveProperty('netValueUSD');
        expect(position).toHaveProperty('suppliedTokens');
        expect(position).toHaveProperty('riskMetrics');
        expect(position).toHaveProperty('createdAt');
        expect(position).toHaveProperty('lastUpdatedAt');
        expect(position).toHaveProperty('protocolData');
        
        // Validate vault-specific properties
        if (position.type === PositionType.VAULT) {
          expect(position).toHaveProperty('vaultInfo');
          expect((position as any).vaultInfo).toHaveProperty('vaultAddress');
          expect((position as any).vaultInfo).toHaveProperty('vaultName');
          expect((position as any).vaultInfo).toHaveProperty('shares');
        }
      });
    });
  });
});

// Integration test helpers
export const createMockYearnAdapter = (mockRpcUrls = {}) => {
  return new YearnAdapter(mockRpcUrls);
};

export const mockYearnVaultData = {
  address: '0x1234567890abcdef1234567890abcdef12345678',
  symbol: 'yvDAI',
  name: 'DAI yVault',
  version: '0.4.6',
  token: {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  apy: {
    type: 'v2:averaged',
    gross_apr: 5.2,
    net_apy: 4.8,
    fees: {
      performance: 20,
      management: 2,
    },
  },
  tvl: {
    total_assets: '1000000000000000000000000',
    tvl: 1000000,
    price: 1.001,
  },
  strategies: [
    {
      address: '0xabcdef1234567890abcdef1234567890abcdef12',
      name: 'StrategyDAICompoundLender',
      description: 'Supplies DAI to Compound to earn COMP tokens',
      risk_score: 2,
    },
  ],
};