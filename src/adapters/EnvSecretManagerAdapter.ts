import { SecretManagerPort } from '../../src/ports/SecretManagerPort';

export class EnvSecretManagerAdapter implements SecretManagerPort {
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async getRequiredSecret(key: string): Promise<string> {
    const secret = process.env[key];
    if (!secret) {
      throw new Error(`Required secret ${key} is not set in environment variables.`);
    }
    return secret;
  }
}
