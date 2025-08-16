// Shared model-layer interfaces

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

export interface Migration {
  id: string;
  name: string;
  description: string;
  version: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
  validate?: () => Promise<boolean>;
}
