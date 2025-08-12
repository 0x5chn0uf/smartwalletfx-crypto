# Multi-stage build for optimal image size and security

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

# Add security updates and create non-root user
RUN apk update && apk upgrade && \
    addgroup -g 1001 -S nodejs && \
    adduser -S crypto-service -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=crypto-service:nodejs /app/dist ./dist
COPY --from=builder --chown=crypto-service:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=crypto-service:nodejs /app/package.json ./package.json

# Create logs directory
RUN mkdir -p /app/logs && chown crypto-service:nodejs /app/logs

# Switch to non-root user
USER crypto-service

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application
CMD ["node", "dist/server.js"]

# Labels for metadata
LABEL maintainer="SmartWalletFX Team"
LABEL service="crypto-data-service"
LABEL version="1.0.0"
LABEL description="High-performance Node.js microservice for crypto data retrieval"