/**
 * Money and Decimal Precision Utilities
 *
 * Implements battle-tested decimal arithmetic for financial calculations
 * using decimal.js library to ensure precision safety for monetary computations.
 * 
 * REFACTORED: Replaced custom decimal implementation with decimal.js
 */

import Decimal from 'decimal.js';
import { logger } from './logger';

/**
 * Configuration for decimal precision and rounding
 */
export interface MoneyConfig {
  precision: number;
  rounding: number;
}

/**
 * Predefined configurations for different use cases
 */
export const MONEY_CONFIGS = {
  // 18 decimal places for crypto precision
  CRYPTO: {
    precision: 18,
    rounding: Decimal.ROUND_HALF_EVEN, // Banker's rounding
  } as MoneyConfig,

  // 2 decimal places for USD
  USD: {
    precision: 2,
    rounding: Decimal.ROUND_HALF_UP,
  } as MoneyConfig,

  // 6 decimal places for most fiat currencies
  FIAT: {
    precision: 6,
    rounding: Decimal.ROUND_HALF_EVEN,
  } as MoneyConfig,

  // 8 decimal places for Bitcoin-style precision
  BTC: {
    precision: 8,
    rounding: Decimal.ROUND_HALF_EVEN,
  } as MoneyConfig,
} as const;

/**
 * Money class using decimal.js for precise calculations
 */
export class Money {
  private readonly value: Decimal;
  private readonly config: MoneyConfig;

  constructor(value: Decimal.Value, config: MoneyConfig = MONEY_CONFIGS.CRYPTO) {
    this.config = config;
    
    try {
      this.value = new Decimal(value);
    } catch (error) {
      logger.warn('Invalid money value, defaulting to 0', { 
        value, 
        error: error instanceof Error ? error.message : String(error) 
      });
      this.value = new Decimal(0);
    }
  }

  // Arithmetic operations
  add(other: Money | Decimal.Value): Money {
    const otherMoney = other instanceof Money ? other : new Money(other, this.config);
    return new Money(this.value.add(otherMoney.value), this.config);
  }

  subtract(other: Money | Decimal.Value): Money {
    const otherMoney = other instanceof Money ? other : new Money(other, this.config);
    return new Money(this.value.sub(otherMoney.value), this.config);
  }

  multiply(other: Money | Decimal.Value): Money {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return new Money(this.value.mul(otherValue), this.config);
  }

  divide(other: Money | Decimal.Value): Money {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    
    if (otherValue.isZero()) {
      throw new Error('Division by zero');
    }
    
    return new Money(this.value.div(otherValue), this.config);
  }

  // Comparison operations
  equals(other: Money | Decimal.Value): boolean {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return this.value.eq(otherValue);
  }

  greaterThan(other: Money | Decimal.Value): boolean {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return this.value.gt(otherValue);
  }

  greaterThanOrEqual(other: Money | Decimal.Value): boolean {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return this.value.gte(otherValue);
  }

  lessThan(other: Money | Decimal.Value): boolean {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return this.value.lt(otherValue);
  }

  lessThanOrEqual(other: Money | Decimal.Value): boolean {
    const otherValue = other instanceof Money ? other.value : new Decimal(other);
    return this.value.lte(otherValue);
  }

  // State checks
  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isPositive(): boolean {
    return this.value.isPositive();
  }

  isNaN(): boolean {
    return this.value.isNaN();
  }

  isFinite(): boolean {
    return this.value.isFinite();
  }

  // Utility operations
  abs(): Money {
    return new Money(this.value.abs(), this.config);
  }

  round(precision?: number): Money {
    const targetPrecision = precision ?? this.config.precision;
    return new Money(
      this.value.toDecimalPlaces(targetPrecision, this.config.rounding),
      this.config
    );
  }

  floor(): Money {
    return new Money(this.value.floor(), this.config);
  }

  ceil(): Money {
    return new Money(this.value.ceil(), this.config);
  }

  // Output methods
  toString(): string {
    return this.value.toFixed(this.config.precision);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  toDecimalPlaces(precision: number): string {
    return this.value.toDecimalPlaces(precision, this.config.rounding).toString();
  }

  toCurrencyString(currency: string = 'USD', locale: string = 'en-US'): string {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: this.config.precision,
        maximumFractionDigits: this.config.precision,
      }).format(this.toNumber());
    } catch (error) {
      logger.warn('Currency formatting failed, using fallback', { 
        error: error instanceof Error ? error.message : String(error),
        currency, 
        locale 
      });
      return `${currency} ${this.toString()}`;
    }
  }

  // Get raw decimal value
  toDecimal(): Decimal {
    return this.value;
  }

  getRawValue(): string {
    return this.value.toString();
  }
}

/**
 * Factory class for creating Money instances with different configurations
 */
export class MoneyFactory {
  /**
   * Create USD amount (2 decimal places)
   */
  static usd(value: Decimal.Value): Money {
    return new Money(value, MONEY_CONFIGS.USD);
  }

  /**
   * Create crypto amount (18 decimal places)
   */
  static crypto(value: Decimal.Value): Money {
    return new Money(value, MONEY_CONFIGS.CRYPTO);
  }

  /**
   * Create Bitcoin amount (8 decimal places)
   */
  static btc(value: Decimal.Value): Money {
    return new Money(value, MONEY_CONFIGS.BTC);
  }

  /**
   * Create fiat amount (6 decimal places)
   */
  static fiat(value: Decimal.Value): Money {
    return new Money(value, MONEY_CONFIGS.FIAT);
  }

  /**
   * Create Money with custom configuration
   */
  static custom(value: Decimal.Value, config: MoneyConfig): Money {
    return new Money(value, config);
  }

  /**
   * Create zero amount with specified config
   */
  static zero(config: MoneyConfig = MONEY_CONFIGS.CRYPTO): Money {
    return new Money(0, config);
  }
}

/**
 * Utility functions for money operations
 */
export class MoneyUtils {
  /**
   * Sum an array of Money values
   */
  static sum(values: Money[]): Money {
    if (values.length === 0) {
      return MoneyFactory.zero();
    }

    return values.reduce((acc, value) => acc.add(value), MoneyFactory.zero(values[0].config));
  }

  /**
   * Calculate percentage of a Money value
   */
  static percentage(value: Money, percentage: number): Money {
    return value.multiply(percentage).divide(100);
  }

  /**
   * Convert between currencies using exchange rate
   */
  static convert(
    amount: Money,
    exchangeRate: Decimal.Value,
    targetConfig?: MoneyConfig
  ): Money {
    const converted = amount.multiply(exchangeRate);

    if (targetConfig) {
      return new Money(converted.toDecimal(), targetConfig);
    }

    return converted;
  }

  /**
   * Calculate token value in USD
   */
  static calculateTokenValueUSD(
    tokenBalance: Decimal.Value,
    tokenPrice: Decimal.Value
  ): Money {
    const balance = MoneyFactory.crypto(tokenBalance);
    const price = MoneyFactory.usd(tokenPrice);
    return balance.multiply(price.toDecimal());
  }

  /**
   * Safe division with fallback for zero denominator
   */
  static safeDivide(
    numerator: Money,
    denominator: Money,
    fallback: Money = MoneyFactory.zero()
  ): Money {
    if (denominator.isZero()) {
      return fallback;
    }
    return numerator.divide(denominator);
  }

  /**
   * Find maximum value in array
   */
  static max(values: Money[]): Money {
    if (values.length === 0) {
      throw new Error('Cannot find max of empty array');
    }

    return values.reduce((max, current) => 
      current.greaterThan(max) ? current : max
    );
  }

  /**
   * Find minimum value in array
   */
  static min(values: Money[]): Money {
    if (values.length === 0) {
      throw new Error('Cannot find min of empty array');
    }

    return values.reduce((min, current) => 
      current.lessThan(min) ? current : min
    );
  }

  /**
   * Format for API responses
   */
  static formatForAPI(amount: Money): {
    value: string;
    formatted: string;
    displayValue: number;
  } {
    return {
      value: amount.getRawValue(),
      formatted: amount.toString(),
      displayValue: amount.toNumber(),
    };
  }

  /**
   * Validate if a value can be converted to Money
   */
  static isValid(value: any): boolean {
    try {
      new Decimal(value);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Convenience helper object for quick money operations
 */
export const money = {
  // Factory methods
  usd: (value: Decimal.Value) => MoneyFactory.usd(value),
  crypto: (value: Decimal.Value) => MoneyFactory.crypto(value),
  btc: (value: Decimal.Value) => MoneyFactory.btc(value),
  fiat: (value: Decimal.Value) => MoneyFactory.fiat(value),
  zero: (config?: MoneyConfig) => MoneyFactory.zero(config),

  // Utility methods
  sum: (...values: Money[]) => MoneyUtils.sum(values),
  percent: (value: Money, percentage: number) => MoneyUtils.percentage(value, percentage),
  max: (...values: Money[]) => MoneyUtils.max(values),
  min: (...values: Money[]) => MoneyUtils.min(values),
  
  // Validation
  isValid: (value: any) => MoneyUtils.isValid(value),
} as const;

// Export everything
export { Decimal };
export default MoneyFactory;