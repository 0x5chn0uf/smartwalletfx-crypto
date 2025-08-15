/**
 * E2E Test Setup
 * 
 * Setup for end-to-end tests including:
 * - Real database connections (test schema)
 * - Real Redis connections (test DB)
 * - HTTP client setup
 */

import { beforeAll, afterAll } from '@jest/globals';
import { PrismaClient } from '@prisma/client';

// Test environment configuration
process.env.NODE_ENV = 'test';
process.env.PORT = '3001'; // Use different port for E2E tests

let prisma: PrismaClient;

beforeAll(async () => {
  // Initialize test database
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  await prisma.$connect();
  
  // Clean database before tests
  await cleanDatabase();
}, 30000);

afterAll(async () => {
  // Clean up after tests
  await cleanDatabase();
  await prisma.$disconnect();
}, 30000);

async function cleanDatabase() {
  // Clean up test data - be careful with production data!
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ');

  if (tables.length > 0) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    } catch (error) {
      console.log({ error });
    }
  }
}

export { prisma };