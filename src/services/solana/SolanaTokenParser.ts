/**
 * Solana Token Account Parser
 *
 * Comprehensive parser for Solana token accounts, SPL tokens, and DeFi positions.
 * Handles detection of various token types, account structures, and position analysis.
 */

import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { logger } from '@/utils/logger';
import { redisManager } from '@/utils/redis';
import {
  SolanaToken,
  SolanaPortfolio,
  SolanaDeFiPosition,
  SolanaProtocol,
  SolanaPositionType,
  WELL_KNOWN_TOKENS,
  SOLANA_NATIVE_MINT,
  PROTOCOL_PROGRAM_IDS,
} from '@/types/solana-defi';

export interface TokenAccountData {
  mint: string;
  owner: string;
  amount: bigint;
  decimals?: number;
  uiAmount?: number;
  delegateOption: number;
  delegate?: string;
  state: number;
  isNativeOption: number;
  isNative?: bigint;
  delegatedAmount: bigint;
  closeAuthorityOption: number;
  closeAuthority?: string;
}

export interface ParsedTokenAccount {
  pubkey: string;
  account: AccountInfo<Buffer>;
  data: TokenAccountData;
  token: SolanaToken;
  balance: number;
  value: number;
  isNative: boolean;
}

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  description?: string;
  tags?: string[];
  verified: boolean;
  coingeckoId?: string;
}

export class SolanaTokenParser {
  private readonly connection: Connection;
  private readonly tokenMetadataCache = new Map<string, TokenMetadata>();

  // SPL Token program ID
  private static readonly TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  private static readonly TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

  // Token account layout offsets
  private static readonly TOKEN_ACCOUNT_LAYOUT = {
    MINT_OFFSET: 0,
    OWNER_OFFSET: 32,
    AMOUNT_OFFSET: 64,
    DELEGATE_OPTION_OFFSET: 72,
    DELEGATE_OFFSET: 73,
    STATE_OFFSET: 105,
    IS_NATIVE_OPTION_OFFSET: 106,
    IS_NATIVE_OFFSET: 107,
    DELEGATED_AMOUNT_OFFSET: 115,
    CLOSE_AUTHORITY_OPTION_OFFSET: 123,
    CLOSE_AUTHORITY_OFFSET: 124,
  };

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.initializeWellKnownTokens();
  }

  /**
   * Initialize cache with well-known tokens
   */
  private initializeWellKnownTokens(): void {
    Object.values(WELL_KNOWN_TOKENS).forEach(token => {
      this.tokenMetadataCache.set(token.mint, {
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoURI: token.logoURI,
        verified: token.verified,
        tags: token.tags,
      });
    });
  }

  /**
   * Get all token accounts for a wallet address
   */
  async getTokenAccounts(walletAddress: string): Promise<ParsedTokenAccount[]> {
    const cacheKey = `solana:token-accounts:${walletAddress}`;

    try {
      // Check cache first
      const cached = await redisManager.get<ParsedTokenAccount[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const publicKey = new PublicKey(walletAddress);
      const accounts: ParsedTokenAccount[] = [];

      // Get SPL token accounts
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(publicKey, {
        programId: new PublicKey(SolanaTokenParser.TOKEN_PROGRAM_ID),
      });

      // Get Token-2022 accounts
      const token2022Accounts = await this.connection.getTokenAccountsByOwner(publicKey, {
        programId: new PublicKey(SolanaTokenParser.TOKEN_2022_PROGRAM_ID),
      });

      // Parse SPL token accounts
      for (const tokenAccount of tokenAccounts.value) {
        const parsed = await this.parseTokenAccount(
          tokenAccount.pubkey.toString(),
          tokenAccount.account
        );
        if (parsed) {
          accounts.push(parsed);
        }
      }

      // Parse Token-2022 accounts
      for (const tokenAccount of token2022Accounts.value) {
        const parsed = await this.parseTokenAccount(
          tokenAccount.pubkey.toString(),
          tokenAccount.account
        );
        if (parsed) {
          accounts.push(parsed);
        }
      }

      // Get native SOL balance
      const nativeBalance = await this.connection.getBalance(publicKey);
      if (nativeBalance > 0) {
        const nativeAccount: ParsedTokenAccount = {
          pubkey: walletAddress,
          account: {} as AccountInfo<Buffer>,
          data: {
            mint: SOLANA_NATIVE_MINT,
            owner: walletAddress,
            amount: BigInt(nativeBalance),
            decimals: 9,
            uiAmount: nativeBalance / 1e9,
            delegateOption: 0,
            state: 1,
            isNativeOption: 1,
            isNative: BigInt(nativeBalance),
            delegatedAmount: BigInt(0),
            closeAuthorityOption: 0,
          },
          token: WELL_KNOWN_TOKENS.SOL,
          balance: nativeBalance / 1e9,
          value: nativeBalance / 1e9, // Would need price data for accurate value
          isNative: true,
        };
        accounts.push(nativeAccount);
      }

      // Cache for 2 minutes
      await redisManager.set(cacheKey, accounts, 120);

      return accounts;
    } catch (error) {
      logger.error('Failed to get token accounts', {
        walletAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Parse individual token account
   */
  async parseTokenAccount(
    pubkey: string,
    account: AccountInfo<Buffer>
  ): Promise<ParsedTokenAccount | null> {
    try {
      if (!account.data || account.data.length < 165) {
        return null;
      }

      const data = this.parseTokenAccountData(account.data);
      const token = await this.getTokenMetadata(data.mint);

      const decimals = token.decimals || data.decimals || 9;
      const balance = Number(data.amount) / Math.pow(10, decimals);

      // Skip accounts with zero balance unless they're native SOL
      if (balance === 0 && data.mint !== SOLANA_NATIVE_MINT) {
        return null;
      }

      return {
        pubkey,
        account,
        data,
        token,
        balance,
        value: balance, // Would need price data for accurate value
        isNative: data.mint === SOLANA_NATIVE_MINT,
      };
    } catch (error) {
      logger.debug('Failed to parse token account', {
        pubkey,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Parse raw token account data
   */
  private parseTokenAccountData(data: Buffer): TokenAccountData {
    const layout = SolanaTokenParser.TOKEN_ACCOUNT_LAYOUT;

    return {
      mint: new PublicKey(data.subarray(layout.MINT_OFFSET, layout.MINT_OFFSET + 32)).toString(),
      owner: new PublicKey(data.subarray(layout.OWNER_OFFSET, layout.OWNER_OFFSET + 32)).toString(),
      amount: data.readBigUInt64LE(layout.AMOUNT_OFFSET),
      delegateOption: data.readUInt8(layout.DELEGATE_OPTION_OFFSET),
      delegate:
        data.readUInt8(layout.DELEGATE_OPTION_OFFSET) !== 0
          ? new PublicKey(
              data.subarray(layout.DELEGATE_OFFSET, layout.DELEGATE_OFFSET + 32)
            ).toString()
          : undefined,
      state: data.readUInt8(layout.STATE_OFFSET),
      isNativeOption: data.readUInt8(layout.IS_NATIVE_OPTION_OFFSET),
      isNative:
        data.readUInt8(layout.IS_NATIVE_OPTION_OFFSET) !== 0
          ? data.readBigUInt64LE(layout.IS_NATIVE_OFFSET)
          : undefined,
      delegatedAmount: data.readBigUInt64LE(layout.DELEGATED_AMOUNT_OFFSET),
      closeAuthorityOption: data.readUInt8(layout.CLOSE_AUTHORITY_OPTION_OFFSET),
      closeAuthority:
        data.readUInt8(layout.CLOSE_AUTHORITY_OPTION_OFFSET) !== 0
          ? new PublicKey(
              data.subarray(layout.CLOSE_AUTHORITY_OFFSET, layout.CLOSE_AUTHORITY_OFFSET + 32)
            ).toString()
          : undefined,
    };
  }

  /**
   * Get token metadata from various sources
   */
  async getTokenMetadata(mint: string): Promise<SolanaToken> {
    // Check cache first
    if (this.tokenMetadataCache.has(mint)) {
      return this.tokenMetadataCache.get(mint)! as SolanaToken;
    }

    try {
      // Try to fetch from Solana Labs token list or other metadata sources
      const metadata = await this.fetchTokenMetadata(mint);

      if (metadata) {
        this.tokenMetadataCache.set(mint, metadata);
        return metadata as SolanaToken;
      }

      // Fallback for unknown tokens
      const fallback: SolanaToken = {
        mint,
        name: 'Unknown Token',
        symbol: mint.slice(0, 8),
        decimals: 9,
        verified: false,
      };

      this.tokenMetadataCache.set(mint, fallback);
      return fallback;
    } catch (error) {
      logger.debug('Failed to fetch token metadata', { mint, error: (error as Error).message });

      // Return fallback
      const fallback: SolanaToken = {
        mint,
        name: 'Unknown Token',
        symbol: mint.slice(0, 8),
        decimals: 9,
        verified: false,
      };

      return fallback;
    }
  }

  /**
   * Fetch token metadata from external sources
   */
  private async fetchTokenMetadata(mint: string): Promise<TokenMetadata | null> {
    try {
      // Try to get on-chain metadata first
      const metadataAccount = await this.getTokenMetadataAccount(mint);
      if (metadataAccount) {
        return metadataAccount;
      }

      // Could also try Jupiter token list, Solana Labs token list, etc.
      return null;
    } catch (error) {
      logger.debug('Failed to fetch token metadata', { mint, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Get on-chain token metadata account
   */
  private async getTokenMetadataAccount(mint: string): Promise<TokenMetadata | null> {
    try {
      // Metaplex metadata program ID
      const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

      // Derive metadata account address
      const [metadataAddress] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          new PublicKey(METADATA_PROGRAM_ID).toBuffer(),
          new PublicKey(mint).toBuffer(),
        ],
        new PublicKey(METADATA_PROGRAM_ID)
      );

      const accountInfo = await this.connection.getAccountInfo(metadataAddress);
      if (!accountInfo) {
        return null;
      }

      // Parse metadata (simplified)
      return this.parseMetadataAccount(accountInfo.data);
    } catch (error) {
      logger.debug('Failed to get metadata account', { mint, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Parse Metaplex metadata account
   */
  private parseMetadataAccount(data: Buffer): TokenMetadata | null {
    try {
      // This is a simplified parser
      // In practice, you'd use the proper Metaplex metadata layout
      return null;
    } catch (error) {
      logger.debug('Failed to parse metadata account', error);
      return null;
    }
  }

  /**
   * Detect DeFi positions from token accounts and transaction history
   */
  async detectDeFiPositions(walletAddress: string): Promise<SolanaDeFiPosition[]> {
    try {
      const positions: SolanaDeFiPosition[] = [];
      const publicKey = new PublicKey(walletAddress);

      // Get all program accounts related to known DeFi protocols
      for (const [protocol, programIds] of Object.entries(PROTOCOL_PROGRAM_IDS)) {
        for (const programId of programIds) {
          try {
            const accounts = await this.connection.getProgramAccounts(new PublicKey(programId), {
              filters: [
                {
                  memcmp: {
                    offset: 32, // Common owner field offset
                    bytes: publicKey.toBase58(),
                  },
                },
              ],
            });

            // Parse each account based on protocol
            for (const account of accounts) {
              const position = await this.parseProtocolAccount(
                protocol as SolanaProtocol,
                account.pubkey.toString(),
                account.account
              );

              if (position) {
                positions.push(position);
              }
            }
          } catch (error) {
            logger.debug(`Failed to get ${protocol} accounts`, error);
          }
        }
      }

      return positions;
    } catch (error) {
      logger.error('Failed to detect DeFi positions', {
        walletAddress,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Parse protocol-specific account data
   */
  private async parseProtocolAccount(
    protocol: SolanaProtocol,
    accountAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): Promise<SolanaDeFiPosition | null> {
    try {
      switch (protocol) {
        case SolanaProtocol.MARINADE:
          return this.parseMarinadeAccount(accountAddress, accountInfo);
        case SolanaProtocol.ORCA:
          return this.parseOrcaAccount(accountAddress, accountInfo);
        case SolanaProtocol.JUPITER:
          return this.parseJupiterAccount(accountAddress, accountInfo);
        default:
          return this.parseGenericPosition(protocol, accountAddress, accountInfo);
      }
    } catch (error) {
      logger.debug('Failed to parse protocol account', {
        protocol,
        accountAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Parse Marinade-specific accounts
   */
  private parseMarinadeAccount(
    accountAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): SolanaDeFiPosition | null {
    // Implementation would depend on specific Marinade account structures
    return null;
  }

  /**
   * Parse Orca-specific accounts
   */
  private parseOrcaAccount(
    accountAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): SolanaDeFiPosition | null {
    // Implementation would depend on specific Orca account structures
    return null;
  }

  /**
   * Parse Jupiter-specific accounts
   */
  private parseJupiterAccount(
    accountAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): SolanaDeFiPosition | null {
    // Jupiter doesn't typically have persistent user accounts
    return null;
  }

  /**
   * Parse generic DeFi position
   */
  private parseGenericPosition(
    protocol: SolanaProtocol,
    accountAddress: string,
    accountInfo: AccountInfo<Buffer>
  ): SolanaDeFiPosition | null {
    // Generic parser for unknown protocol structures
    return {
      id: `${protocol}-${accountAddress}`,
      protocol,
      type: SolanaPositionType.STAKING, // Default type
      account: accountAddress,
      tokens: [],
      value: 0,
      lastUpdated: Date.now(),
      metadata: {
        accountAddress,
        programId: accountInfo.owner.toString(),
        dataLength: accountInfo.data.length,
      },
    };
  }

  /**
   * Build comprehensive portfolio from parsed data
   */
  async buildPortfolio(walletAddress: string): Promise<SolanaPortfolio> {
    try {
      const [tokenAccounts, defiPositions] = await Promise.all([
        this.getTokenAccounts(walletAddress),
        this.detectDeFiPositions(walletAddress),
      ]);

      // Calculate total portfolio value
      const tokenValue = tokenAccounts.reduce((sum, account) => sum + account.value, 0);
      const defiValue = defiPositions.reduce((sum, position) => sum + position.value, 0);
      const totalValue = tokenValue + defiValue;

      // Get native SOL balance
      const nativeAccount = tokenAccounts.find(account => account.isNative);
      const nativeBalance = nativeAccount?.balance || 0;

      // Build token balances
      const tokenBalances = tokenAccounts
        .filter(account => !account.isNative && account.balance > 0)
        .map(account => ({
          mint: account.token.mint,
          amount: account.balance,
          value: account.value,
          token: account.token,
        }));

      return {
        address: walletAddress,
        totalValue,
        nativeBalance,
        tokenBalances,
        defiPositions,
        stakingPositions: [], // Would be filled by Marinade adapter
        liquidityPositions: [], // Would be filled by Orca adapter
        openOrders: [], // Would be filled by Serum adapter
        lastUpdated: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to build Solana portfolio', {
        walletAddress,
        error: (error as Error).message,
      });

      // Return empty portfolio on error
      return {
        address: walletAddress,
        totalValue: 0,
        nativeBalance: 0,
        tokenBalances: [],
        defiPositions: [],
        stakingPositions: [],
        liquidityPositions: [],
        openOrders: [],
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Health check for the token parser
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test connection with a simple RPC call
      const slot = await this.connection.getSlot();
      return slot > 0;
    } catch (error) {
      logger.warn('Solana token parser health check failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get parser statistics
   */
  getStats() {
    return {
      tokenMetadataCacheSize: this.tokenMetadataCache.size,
      wellKnownTokensCount: Object.keys(WELL_KNOWN_TOKENS).length,
      supportedProtocols: Object.keys(PROTOCOL_PROGRAM_IDS).length,
    };
  }
}

export default SolanaTokenParser;
