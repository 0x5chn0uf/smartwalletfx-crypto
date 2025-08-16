export interface SecretManagerPort {
  getSecret(key: string): Promise<string | undefined>;
  getRequiredSecret(key: string): Promise<string>;
}
