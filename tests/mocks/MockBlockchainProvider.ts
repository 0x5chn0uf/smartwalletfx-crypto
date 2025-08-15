/**
 * Mock Blockchain Provider for Testing
 * 
 * Provides deterministic responses for blockchain calls during testing
 * without requiring actual RPC connections
 */

import { ChainId } from '@/types/blockchain';
import { DeFiProtocol } from '@/types/defi';

export interface MockContractCall {
  method: string;
  args: any[];
  returnValue: any;
  shouldThrow?: boolean;
  delay?: number;
}

export interface MockChainData {
  chainId: ChainId;
  blockNumber: number;
  gasPrice: string;
  contracts: Map<string, MockContractCall[]>;
}

export class MockBlockchainProvider {
  private chains = new Map<ChainId, MockChainData>();
  private callHistory: Array<{
    chainId: ChainId;
    contractAddress: string;
    method: string;
    args: any[];
    timestamp: number;
  }> = [];

  constructor() {
    this.initializeDefaultChains();
  }

  private initializeDefaultChains() {
    const defaultChains = [
      ChainId.ETHEREUM,
      ChainId.POLYGON,
      ChainId.ARBITRUM,
      ChainId.OPTIMISM,
      ChainId.BASE
    ];

    defaultChains.forEach(chainId => {
      this.chains.set(chainId, {
        chainId,
        blockNumber: 18000000 + Math.floor(Math.random() * 1000000),
        gasPrice: '20000000000', // 20 gwei
        contracts: new Map()
      });
    });
  }

  /**
   * Mock contract call responses
   */
  mockContractCall(
    chainId: ChainId,
    contractAddress: string,
    calls: MockContractCall[]
  ): void {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not initialized`);
    }

    chain.contracts.set(contractAddress.toLowerCase(), calls);
  }

  /**
   * Simulate a contract call
   */
  async call(
    chainId: ChainId,
    contractAddress: string,
    method: string,
    args: any[] = []
  ): Promise<any> {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    // Record the call
    this.callHistory.push({
      chainId,
      contractAddress,
      method,
      args,
      timestamp: Date.now()
    });

    const contractCalls = chain.contracts.get(contractAddress.toLowerCase());
    if (!contractCalls) {
      throw new Error(`Contract ${contractAddress} not mocked on chain ${chainId}`);
    }

    // Find matching call
    const matchingCall = contractCalls.find(call => 
      call.method === method && 
      this.argsMatch(call.args, args)
    );

    if (!matchingCall) {
      // Return default based on method
      return this.getDefaultReturnValue(method, args);
    }

    // Simulate delay if specified
    if (matchingCall.delay) {
      await this.sleep(matchingCall.delay);
    }

    // Throw error if specified
    if (matchingCall.shouldThrow) {
      throw new Error(`Mocked error for ${method}`);
    }

    return matchingCall.returnValue;
  }

  /**
   * Get call history for assertions
   */
  getCallHistory(): Array<{
    chainId: ChainId;
    contractAddress: string;
    method: string;
    args: any[];
    timestamp: number;
  }> {
    return [...this.callHistory];
  }

  /**
   * Clear call history
   */
  clearCallHistory(): void {
    this.callHistory = [];
  }

  /**
   * Get block number for chain
   */
  getBlockNumber(chainId: ChainId): number {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    return chain.blockNumber;
  }

  /**
   * Set block number for chain
   */
  setBlockNumber(chainId: ChainId, blockNumber: number): void {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }
    chain.blockNumber = blockNumber;
  }

  /**
   * Simulate network failure
   */
  simulateNetworkFailure(chainId: ChainId, duration: number = 5000): void {
    const chain = this.chains.get(chainId);
    if (!chain) return;

    // Mock all contract calls to throw for specified duration
    const originalContracts = new Map(chain.contracts);
    
    chain.contracts.clear();
    
    setTimeout(() => {
      // Restore original contracts
      chain.contracts = originalContracts;
    }, duration);
  }

  /**
   * Reset all mocks
   */
  reset(): void {
    this.callHistory = [];
    this.chains.forEach(chain => {
      chain.contracts.clear();
    });
    this.initializeDefaultChains();
  }

  private argsMatch(expectedArgs: any[], actualArgs: any[]): boolean {
    if (expectedArgs.length !== actualArgs.length) {
      return false;
    }
    
    return expectedArgs.every((expected, index) => {
      if (expected === '*') return true; // Wildcard match
      return expected === actualArgs[index];
    });
  }

  private getDefaultReturnValue(method: string, args: any[]): any {
    const defaults: Record<string, any> = {
      'getBlockNumber': 18000000,
      'balanceOf': BigInt(0),
      'symbol': 'MOCK',
      'name': 'Mock Token',
      'decimals': 18,
      'totalSupply': BigInt(1000000),
      'getUserReservesData': [],
      'getUserAccountData': {
        totalCollateralETH: BigInt(0),
        totalDebtETH: BigInt(0),
        availableBorrowsETH: BigInt(0),
        currentLiquidationThreshold: BigInt(0),
        ltv: BigInt(0),
        healthFactor: BigInt(0)
      },
      'getReservesData': [],
      'tokenOfOwnerByIndex': BigInt(1),
      'positions': {
        nonce: BigInt(0),
        operator: '0x0000000000000000000000000000000000000000',
        token0: '0x0000000000000000000000000000000000000001',
        token1: '0x0000000000000000000000000000000000000002',
        fee: 3000,
        tickLower: -276320,
        tickUpper: 276320,
        liquidity: BigInt(0),
        feeGrowthInside0LastX128: BigInt(0),
        feeGrowthInside1LastX128: BigInt(0),
        tokensOwed0: BigInt(0),
        tokensOwed1: BigInt(0)
      },
      'getPool': '0x0000000000000000000000000000000000000003',
      'slot0': [
        BigInt('1000000000000000000'), // sqrtPriceX96
        0, // tick
        0, // observationIndex
        1, // observationCardinality
        1, // observationCardinalityNext
        0, // feeProtocol
        true // unlocked
      ],
      'liquidity': BigInt(1000000)
    };

    return defaults[method] || null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const mockBlockchainProvider = new MockBlockchainProvider();