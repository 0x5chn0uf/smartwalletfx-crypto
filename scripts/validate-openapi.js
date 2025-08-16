// Simple OpenAPI aggregation and validation loader using swagger-jsdoc
// Loads YAML path files and prints a summary. Exits non-zero on parse errors.
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Crypto Data API',
      version: '1.0.0',
    },
  },
  apis: ['./src/docs/**/*.yaml'],
};

try {
  const spec = swaggerJsdoc(options);
  const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;
  console.log(`[openapi] Loaded ${pathCount} paths, ${Object.keys(spec.components?.schemas || {}).length} schemas`);
} catch (err) {
  console.error('[openapi] Failed to build spec:', err && err.message ? err.message : err);
  process.exit(1);
}

