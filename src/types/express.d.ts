import { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      correlationId: string;
      logger: Logger;
    }
  }
}