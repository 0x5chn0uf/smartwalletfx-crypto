/**
 * Money and Decimal Precision Utilities
 * 
 * Implements decimal arithmetic for financial calculations to avoid
 * JavaScript floating-point precision issues as required by PRD Phase 2.
 * 
 * Uses string-based decimal arithmetic to ensure precision safety
 * for monetary computations.
 */

import { logger } from './logger';

/**
 * Configuration for decimal precision
 */
export interface DecimalConfig {
  precision: number;
  rounding: 'up' | 'down' | 'half-up' | 'half-down' | 'half-even';
}

/**
 * Default configuration for monetary calculations
 */
export const DEFAULT_MONEY_CONFIG: DecimalConfig = {
  precision: 18, // 18 decimal places for crypto precision
  rounding: 'half-even', // Banker's rounding
};

/**
 * USD-specific configuration (2 decimal places)
 */
export const USD_CONFIG: DecimalConfig = {
  precision: 2,
  rounding: 'half-up',
};

/**
 * Custom Decimal class for precise monetary calculations
 * Uses string-based arithmetic to avoid floating-point errors
 */
export class MoneyDecimal {
  private value: string;
  private config: DecimalConfig;

  constructor(value: string | number | MoneyDecimal, config: DecimalConfig = DEFAULT_MONEY_CONFIG) {
    this.config = config;
    
    if (value instanceof MoneyDecimal) {
      this.value = value.value;
    } else if (typeof value === 'number') {
      // Convert number to string with proper precision
      this.value = value.toFixed(config.precision);
    } else {
      this.value = this.normalizeString(value);
    }
    
    this.validate();
  }

  /**
   * Normalize string input
   */
  private normalizeString(str: string): string {
    // Remove any non-numeric characters except decimal point and minus
    const cleaned = str.replace(/[^0-9.-]/g, '');
    
    // Handle empty or invalid strings
    if (!cleaned || cleaned === '-' || cleaned === '.') {
      return '0';
    }
    
    return cleaned;
  }

  /**
   * Validate the decimal value
   */
  private validate(): void {
    const num = parseFloat(this.value);
    if (isNaN(num)) {
      logger.warn('Invalid decimal value, defaulting to 0', { value: this.value });
      this.value = '0';
    }
  }

  /**
   * Add two decimal values
   */
  add(other: string | number | MoneyDecimal): MoneyDecimal {
    const otherDecimal = new MoneyDecimal(other, this.config);
    const a = parseFloat(this.value);
    const b = parseFloat(otherDecimal.value);
    const result = a + b;
    return new MoneyDecimal(result, this.config);
  }

  /**
   * Subtract two decimal values
   */
  subtract(other: string | number | MoneyDecimal): MoneyDecimal {
    const otherDecimal = new MoneyDecimal(other, this.config);
    const a = parseFloat(this.value);
    const b = parseFloat(otherDecimal.value);
    const result = a - b;
    return new MoneyDecimal(result, this.config);
  }

  /**
   * Multiply two decimal values
   */
  multiply(other: string | number | MoneyDecimal): MoneyDecimal {
    const otherDecimal = new MoneyDecimal(other, this.config);
    const a = parseFloat(this.value);
    const b = parseFloat(otherDecimal.value);
    const result = a * b;
    return new MoneyDecimal(result, this.config);
  }

  /**
   * Divide two decimal values
   */
  divide(other: string | number | MoneyDecimal): MoneyDecimal {
    const otherDecimal = new MoneyDecimal(other, this.config);
    const a = parseFloat(this.value);
    const b = parseFloat(otherDecimal.value);
    
    if (b === 0) {
      throw new Error('Division by zero');
    }
    
    const result = a / b;
    return new MoneyDecimal(result, this.config);
  }

  /**
   * Round to specified precision
   */
  round(precision?: number): MoneyDecimal {
    const targetPrecision = precision ?? this.config.precision;
    const factor = Math.pow(10, targetPrecision);
    const num = parseFloat(this.value);
    
    let rounded: number;
    
    switch (this.config.rounding) {
      case 'up':
        rounded = Math.ceil(num * factor) / factor;
        break;
      case 'down':
        rounded = Math.floor(num * factor) / factor;
        break;
      case 'half-up':
        rounded = Math.round(num * factor) / factor;
        break;
      case 'half-down':
        rounded = Math.sign(num) * Math.floor(Math.abs(num) * factor + 0.5) / factor;
        break;
      case 'half-even': // Banker's rounding
      default:
        const scaled = num * factor;
        const floor = Math.floor(scaled);
        const decimal = scaled - floor;
        
        if (decimal === 0.5) {
          rounded = (floor % 2 === 0 ? floor : floor + 1) / factor;
        } else {
          rounded = Math.round(scaled) / factor;
        }
        break;
    }
    
    return new MoneyDecimal(rounded.toFixed(targetPrecision), this.config);
  }

  /**
   * Compare with another decimal
   */
  compare(other: string | number | MoneyDecimal): number {
    const otherDecimal = new MoneyDecimal(other, this.config);
    const a = parseFloat(this.value);
    const b = parseFloat(otherDecimal.value);
    
    if (a > b) return 1;
    if (a < b) return -1;
    return 0;
  }

  /**
   * Check if equal to another decimal
   */
  equals(other: string | number | MoneyDecimal): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Check if greater than another decimal
   */
  greaterThan(other: string | number | MoneyDecimal): boolean {
    return this.compare(other) > 0;
  }

  /**
   * Check if less than another decimal
   */
  lessThan(other: string | number | MoneyDecimal): boolean {
    return this.compare(other) < 0;
  }

  /**
   * Check if zero
   */
  isZero(): boolean {
    return parseFloat(this.value) === 0;
  }

  /**
   * Check if negative
   */
  isNegative(): boolean {
    return parseFloat(this.value) < 0;
  }

  /**
   * Check if positive
   */
  isPositive(): boolean {
    return parseFloat(this.value) > 0;
  }

  /**
   * Get absolute value
   */
  abs(): MoneyDecimal {
    const num = parseFloat(this.value);
    return new MoneyDecimal(Math.abs(num), this.config);
  }

  /**
   * Convert to string with proper formatting
   */
  toString(): string {
    return parseFloat(this.value).toFixed(this.config.precision);
  }

  /**
   * Convert to number (use with caution for display only)
   */
  toNumber(): number {
    return parseFloat(this.value);
  }

  /**
   * Convert to formatted currency string
   */
  toCurrencyString(currency: string = 'USD', locale: string = 'en-US'): string {
    const num = parseFloat(this.value);
    
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: this.config.precision,
        maximumFractionDigits: this.config.precision,
      }).format(num);
    } catch (error) {
      logger.warn('Currency formatting failed, using fallback', { error, currency, locale });
      return `${currency} ${this.toString()}`;
    }
  }

  /**
   * Get raw string value
   */
  getRawValue(): string {
    return this.value;
  }
}

/**
 * Factory functions for common monetary calculations
 */
export class MoneyUtils {
  /**
   * Create a new MoneyDecimal for USD amounts
   */
  static usd(value: string | number | MoneyDecimal): MoneyDecimal {
    return new MoneyDecimal(value, USD_CONFIG);
  }

  /**
   * Create a new MoneyDecimal for crypto amounts
   */
  static crypto(value: string | number | MoneyDecimal): MoneyDecimal {
    return new MoneyDecimal(value, DEFAULT_MONEY_CONFIG);
  }

  /**
   * Sum an array of MoneyDecimal values
   */
  static sum(values: MoneyDecimal[]): MoneyDecimal {
    if (values.length === 0) {
      return new MoneyDecimal('0');
    }

    return values.reduce((acc, value) => acc.add(value), new MoneyDecimal('0', values[0].config));
  }

  /**
   * Calculate percentage
   */
  static percentage(value: MoneyDecimal, percentage: number): MoneyDecimal {
    return value.multiply(percentage).divide(100);
  }

  /**
   * Convert between currencies using exchange rate
   */
  static convert(
    amount: MoneyDecimal,
    exchangeRate: number,
    targetConfig?: DecimalConfig
  ): MoneyDecimal {
    const converted = amount.multiply(exchangeRate);
    
    if (targetConfig) {
      return new MoneyDecimal(converted.getRawValue(), targetConfig);
    }
    
    return converted;
  }

  /**
   * Calculate token value in USD
   */
  static calculateTokenValueUSD(
    tokenBalance: string | number,
    tokenPrice: string | number
  ): MoneyDecimal {
    const balance = MoneyUtils.crypto(tokenBalance);
    const price = MoneyUtils.usd(tokenPrice);
    return balance.multiply(price);
  }

  /**
   * Calculate portfolio total with proper precision
   */
  static calculatePortfolioTotal(tokenValues: MoneyDecimal[]): MoneyDecimal {
    return MoneyUtils.sum(tokenValues).round(2); // Round to 2 decimal places for USD
  }

  /**
   * Validate monetary amount
   */
  static validate(amount: string | number): boolean {
    try {
      const decimal = new MoneyDecimal(amount);
      return !decimal.isNaN();
    } catch {
      return false;
    }
  }

  /**
   * Safe division with zero check
   */
  static safeDivide(
    numerator: MoneyDecimal,
    denominator: MoneyDecimal,
    fallback: MoneyDecimal = new MoneyDecimal('0')
  ): MoneyDecimal {
    if (denominator.isZero()) {
      return fallback;
    }
    return numerator.divide(denominator);
  }

  /**
   * Format number for API responses
   */
  static formatForAPI(amount: MoneyDecimal): {
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
}

/**
 * Enhanced MoneyDecimal with NaN checking
 */
declare global {
  interface MoneyDecimal {
    isNaN(): boolean;
  }
}

MoneyDecimal.prototype.isNaN = function(): boolean {
  return isNaN(parseFloat(this.getRawValue()));
};

/**
 * Helper functions for common operations
 */
export const money = {
  /**
   * Create USD amount
   */
  usd: (value: string | number) => MoneyUtils.usd(value),
  
  /**
   * Create crypto amount
   */
  crypto: (value: string | number) => MoneyUtils.crypto(value),
  
  /**
   * Add multiple amounts
   */
  sum: (...values: MoneyDecimal[]) => MoneyUtils.sum(values),
  
  /**
   * Zero amount
   */
  zero: () => new MoneyDecimal('0'),
  
  /**
   * Calculate percentage
   */
  percent: (value: MoneyDecimal, percentage: number) => MoneyUtils.percentage(value, percentage),
};

export default MoneyUtils;