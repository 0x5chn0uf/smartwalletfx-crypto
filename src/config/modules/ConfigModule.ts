export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigModule<T> {
  name: string;
  load(): T;
  validate(): ValidationResult;
  watch?(callback: (config: T) => void): void;
  getDependencies?(): string[];
}

export abstract class BaseConfigModule<T> implements ConfigModule<T> {
  abstract name: string;
  protected config?: T;
  protected watchers: ((config: T) => void)[] = [];

  abstract load(): T;

  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const config = this.load();
      this.validateConfig(config, errors, warnings);
    } catch (error) {
      errors.push(`Failed to load ${this.name} config: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  protected abstract validateConfig(config: T, errors: string[], warnings: string[]): void;

  watch(callback: (config: T) => void): void {
    this.watchers.push(callback);
  }

  protected notifyWatchers(config: T): void {
    this.watchers.forEach(watcher => {
      try {
        watcher(config);
      } catch (error) {
        console.error(`Error in config watcher for ${this.name}:`, error);
      }
    });
  }

  getDependencies(): string[] {
    return [];
  }
}