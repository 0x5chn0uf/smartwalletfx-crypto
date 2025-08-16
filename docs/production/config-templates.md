# Production Configuration Templates

> Production-ready configuration templates for all environments and deployment scenarios

## 🎯 Overview

This document provides comprehensive configuration templates for deploying the SmartWalletFX Crypto Data Service across different environments (development, staging, production) and deployment platforms (Docker, Kubernetes, cloud services).

## 🔧 Environment Configuration Templates

### Production Environment (.env.production)

```bash
# =============================================================================
# PRODUCTION ENVIRONMENT CONFIGURATION
# =============================================================================

# Application Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DEBUG_MODE=false

# Service Identity
SERVICE_NAME=crypto-data-service
SERVICE_VERSION=3.0.0
DEPLOYMENT_ENV=production

# Database Configuration
DATABASE_URL=postgresql://crypto_user:${DB_PASSWORD}@prod-postgres-cluster:5432/crypto_data?sslmode=require
DATABASE_POOL_SIZE=20
DATABASE_CONNECTION_TIMEOUT=60000
DATABASE_IDLE_TIMEOUT=300000
DATABASE_STATEMENT_TIMEOUT=30000
DATABASE_LOCK_TIMEOUT=10000

# Redis Configuration
REDIS_URL=redis://prod-redis-cluster:6379/0
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_MAX_RETRIES=3
REDIS_RETRY_DELAY=1000
REDIS_COMMAND_TIMEOUT=5000
REDIS_CONNECT_TIMEOUT=10000

# Security Configuration
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
JWT_ISSUER=smartwalletfx
CORS_ORIGINS=https://app.smartwalletfx.com,https://admin.smartwalletfx.com
CORS_CREDENTIALS=true
CORS_MAX_AGE=86400

# Rate Limiting
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=false
RATE_LIMIT_REDIS_PREFIX=rl:prod

# External API Keys (from secret manager)
ALCHEMY_API_KEY=${ALCHEMY_API_KEY}
MORALIS_API_KEY=${MORALIS_API_KEY}
HELIUS_API_KEY=${HELIUS_API_KEY}
QUICKNODE_API_KEY=${QUICKNODE_API_KEY}

# Provider Configuration
PRIMARY_PROVIDER=alchemy
SECONDARY_PROVIDER=moralis
TERTIARY_PROVIDER=quicknode
PROVIDER_FAILOVER_ENABLED=true
PROVIDER_ROTATION_ENABLED=true
CIRCUIT_BREAKER_ENABLED=true

# Caching Configuration
CACHE_ENABLED=true
CACHE_TTL=300
INTELLIGENT_CACHE_ENABLED=true
PREDICTIVE_CACHE_ENABLED=true
CACHE_WARMING_INTERVAL=3600000
CACHE_COMPRESSION_ENABLED=true

# Performance Optimization
CONCURRENCY_ENABLED=true
CHAIN_MANAGER_CONCURRENCY=10
REQUEST_DEDUPLICATION=true
BATCH_AGGREGATION=true
BATCH_SIZE=100
BATCH_TIMEOUT=5000

# Cost Tracking
COST_TRACKING_ENABLED=true
MONTHLY_BUDGET=800
ALERT_THRESHOLD=680
COST_OPTIMIZATION=aggressive
BUDGET_ALERT_WEBHOOK=${COST_ALERT_WEBHOOK}

# Monitoring & Observability
PROMETHEUS_ENABLED=true
METRICS_PREFIX=crypto_data
DETAILED_METRICS=true
CUSTOM_METRICS_ENABLED=true
SENTRY_DSN=${SENTRY_DSN}
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=${BUILD_VERSION}

# Logging Configuration
LOG_FORMAT=json
LOG_TIMESTAMP=true
LOG_CORRELATION_ID=true
LOG_SAMPLING_RATE=1.0
LOG_MAX_FILE_SIZE=100MB
LOG_MAX_FILES=30

# Health Checks
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_INTERVAL=30000
READINESS_CHECK_ENABLED=true
LIVENESS_CHECK_ENABLED=true

# Feature Flags
SWAGGER_ENABLED=false
DEBUG_ENDPOINTS_ENABLED=false
ADMIN_ENDPOINTS_ENABLED=true
METRICS_ENDPOINT_ENABLED=true
PROFILING_ENABLED=false

# Worker Configuration
WORKER_ENABLED=true
WORKER_CONCURRENCY=4
WORKER_MAX_JOBS_PER_WORKER=1
WORKER_RETRY_ATTEMPTS=3
WORKER_RETRY_DELAY=5000

# Blockchain Configuration
SUPPORTED_CHAINS=ethereum,polygon,arbitrum,optimism,base,solana
DEFAULT_CHAIN=ethereum
CHAIN_TIMEOUT=30000
BLOCK_CONFIRMATIONS=12

# External Services
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
IPFS_TIMEOUT=10000
PRICE_API_ENDPOINT=https://api.coingecko.com/api/v3
PRICE_API_TIMEOUT=5000

# Security Headers
HELMET_ENABLED=true
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true
CSP_ENABLED=true
FRAME_OPTIONS=DENY

# SSL/TLS Configuration
SSL_ENABLED=true
SSL_CERT_PATH=/etc/ssl/certs/crypto-service.crt
SSL_KEY_PATH=/etc/ssl/private/crypto-service.key
SSL_CA_PATH=/etc/ssl/certs/ca-bundle.crt
```

### Staging Environment (.env.staging)

```bash
# =============================================================================
# STAGING ENVIRONMENT CONFIGURATION
# =============================================================================

# Application Configuration
NODE_ENV=staging
PORT=3000
LOG_LEVEL=debug
DEBUG_MODE=true

# Service Identity
SERVICE_NAME=crypto-data-service
SERVICE_VERSION=3.0.0-staging
DEPLOYMENT_ENV=staging

# Database Configuration
DATABASE_URL=postgresql://crypto_user:${DB_PASSWORD}@staging-postgres:5432/crypto_data_staging
DATABASE_POOL_SIZE=10
DATABASE_CONNECTION_TIMEOUT=30000
DATABASE_IDLE_TIMEOUT=180000

# Redis Configuration
REDIS_URL=redis://staging-redis:6379/0
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_MAX_RETRIES=3

# Security Configuration
JWT_SECRET=${JWT_SECRET_STAGING}
CORS_ORIGINS=https://staging.smartwalletfx.com,http://localhost:3000
CORS_CREDENTIALS=true

# Rate Limiting (More permissive for testing)
RATE_LIMIT_MAX=5000
RATE_LIMIT_WINDOW=15
RATE_LIMIT_REDIS_PREFIX=rl:staging

# External API Keys (Staging keys)
ALCHEMY_API_KEY=${ALCHEMY_API_KEY_STAGING}
MORALIS_API_KEY=${MORALIS_API_KEY_STAGING}
HELIUS_API_KEY=${HELIUS_API_KEY_STAGING}

# Provider Configuration
PRIMARY_PROVIDER=alchemy
PROVIDER_FAILOVER_ENABLED=true
CIRCUIT_BREAKER_ENABLED=true

# Caching Configuration
CACHE_ENABLED=true
CACHE_TTL=60
INTELLIGENT_CACHE_ENABLED=true
PREDICTIVE_CACHE_ENABLED=false

# Cost Tracking (Lower budget for staging)
COST_TRACKING_ENABLED=true
MONTHLY_BUDGET=200
ALERT_THRESHOLD=160

# Monitoring & Observability
PROMETHEUS_ENABLED=true
DETAILED_METRICS=true
SENTRY_DSN=${SENTRY_DSN_STAGING}
SENTRY_ENVIRONMENT=staging

# Feature Flags (More permissive for testing)
SWAGGER_ENABLED=true
DEBUG_ENDPOINTS_ENABLED=true
ADMIN_ENDPOINTS_ENABLED=true
PROFILING_ENABLED=true

# Worker Configuration
WORKER_ENABLED=true
WORKER_CONCURRENCY=2

# Blockchain Configuration
SUPPORTED_CHAINS=ethereum,polygon,solana
DEFAULT_CHAIN=ethereum
CHAIN_TIMEOUT=30000
```

### Development Environment (.env.development)

```bash
# =============================================================================
# DEVELOPMENT ENVIRONMENT CONFIGURATION
# =============================================================================

# Application Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DEBUG_MODE=true

# Service Identity
SERVICE_NAME=crypto-data-service
SERVICE_VERSION=3.0.0-dev
DEPLOYMENT_ENV=development

# Database Configuration (Local)
DATABASE_URL=postgresql://crypto_user:crypto_pass@localhost:5432/crypto_data_dev
DATABASE_POOL_SIZE=5
DATABASE_CONNECTION_TIMEOUT=10000

# Redis Configuration (Local)
REDIS_URL=redis://localhost:6379/0
REDIS_MAX_RETRIES=3

# Security Configuration (Development only)
JWT_SECRET=dev-secret-key-change-in-production
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8080
CORS_CREDENTIALS=true

# Rate Limiting (Very permissive)
RATE_LIMIT_MAX=10000
RATE_LIMIT_WINDOW=1
RATE_LIMIT_ENABLED=false

# External API Keys (Development/Test keys)
ALCHEMY_API_KEY=your-dev-alchemy-key
MORALIS_API_KEY=your-dev-moralis-key
HELIUS_API_KEY=your-dev-helius-key

# Provider Configuration
PRIMARY_PROVIDER=alchemy
PROVIDER_FAILOVER_ENABLED=false
CIRCUIT_BREAKER_ENABLED=false

# Caching Configuration (Short TTL for testing)
CACHE_ENABLED=true
CACHE_TTL=30
INTELLIGENT_CACHE_ENABLED=false
PREDICTIVE_CACHE_ENABLED=false

# Cost Tracking (Disabled or minimal)
COST_TRACKING_ENABLED=false
MONTHLY_BUDGET=50

# Monitoring & Observability
PROMETHEUS_ENABLED=true
DETAILED_METRICS=true
SENTRY_DSN=""
SENTRY_ENVIRONMENT=development

# Feature Flags (All enabled for development)
SWAGGER_ENABLED=true
DEBUG_ENDPOINTS_ENABLED=true
ADMIN_ENDPOINTS_ENABLED=true
PROFILING_ENABLED=true

# Worker Configuration
WORKER_ENABLED=false
WORKER_CONCURRENCY=1

# Blockchain Configuration (Testnets)
SUPPORTED_CHAINS=ethereum,polygon
DEFAULT_CHAIN=ethereum
CHAIN_TIMEOUT=10000
```

## 🐳 Docker Configuration Templates

### Production Dockerfile

```dockerfile
# =============================================================================
# PRODUCTION DOCKERFILE
# =============================================================================

# Use multi-stage build for smaller production image
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY src/ src/
COPY prisma/ prisma/

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S crypto-service -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=crypto-service:nodejs /app/dist ./dist
COPY --from=builder --chown=crypto-service:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Copy additional runtime files
COPY --chown=crypto-service:nodejs prisma/ ./prisma/

# Create logs directory
RUN mkdir -p /app/logs && \
    chown -R crypto-service:nodejs /app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Switch to non-root user
USER crypto-service

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
```

### Docker Compose Production

```yaml
# =============================================================================
# PRODUCTION DOCKER COMPOSE
# =============================================================================

version: '3.8'

services:
  crypto-service:
    build:
      context: .
      dockerfile: Dockerfile
    image: smartwalletfx/crypto-service:${VERSION:-latest}
    container_name: crypto-service
    restart: unless-stopped
    
    ports:
      - "3000:3000"
    
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://crypto_user:${POSTGRES_PASSWORD}@postgres:5432/crypto_data
      - REDIS_URL=redis://redis:6379/0
    
    env_file:
      - .env.production
    
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    
    volumes:
      - ./logs:/app/logs
      - ./ssl:/app/ssl:ro
    
    networks:
      - crypto-network
    
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
      restart_policy:
        condition: on-failure
        delay: 30s
        max_attempts: 3
        window: 120s
    
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  postgres:
    image: postgres:15-alpine
    container_name: crypto-postgres
    restart: unless-stopped
    
    environment:
      POSTGRES_DB: crypto_data
      POSTGRES_USER: crypto_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
    
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
      - ./scripts/postgres.conf:/etc/postgresql/postgresql.conf:ro
    
    ports:
      - "5432:5432"
    
    networks:
      - crypto-network
    
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crypto_user -d crypto_data"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: crypto-redis
    restart: unless-stopped
    
    command: >
      redis-server
      --maxmemory 2gb
      --maxmemory-policy allkeys-lru
      --save 900 1
      --save 300 10
      --save 60 10000
      --appendonly yes
      --appendfsync everysec
    
    volumes:
      - redis_data:/data
      - ./scripts/redis.conf:/usr/local/etc/redis/redis.conf:ro
    
    ports:
      - "6379:6379"
    
    networks:
      - crypto-network
    
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  nginx:
    image: nginx:alpine
    container_name: crypto-nginx
    restart: unless-stopped
    
    ports:
      - "80:80"
      - "443:443"
    
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/logs:/var/log/nginx
    
    depends_on:
      - crypto-service
    
    networks:
      - crypto-network
    
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  prometheus:
    image: prom/prometheus:latest
    container_name: crypto-prometheus
    restart: unless-stopped
    
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    
    ports:
      - "9090:9090"
    
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/rules:/etc/prometheus/rules:ro
      - prometheus_data:/prometheus
    
    networks:
      - crypto-network

  grafana:
    image: grafana/grafana:latest
    container_name: crypto-grafana
    restart: unless-stopped
    
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_USERS_ALLOW_SIGN_UP=false
    
    ports:
      - "3001:3000"
    
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources:ro
    
    networks:
      - crypto-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  prometheus_data:
    driver: local
  grafana_data:
    driver: local

networks:
  crypto-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

## ☸️ Kubernetes Configuration Templates

### Production Deployment

```yaml
# =============================================================================
# KUBERNETES PRODUCTION DEPLOYMENT
# =============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: crypto-data
  labels:
    name: crypto-data
    environment: production

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: crypto-service-config
  namespace: crypto-data
data:
  NODE_ENV: "production"
  PORT: "3000"
  LOG_LEVEL: "info"
  SERVICE_NAME: "crypto-data-service"
  CACHE_ENABLED: "true"
  CACHE_TTL: "300"
  PROMETHEUS_ENABLED: "true"
  RATE_LIMIT_MAX: "1000"
  RATE_LIMIT_WINDOW: "15"
  WORKER_ENABLED: "true"
  WORKER_CONCURRENCY: "4"
  SUPPORTED_CHAINS: "ethereum,polygon,arbitrum,optimism,base,solana"
  PRIMARY_PROVIDER: "alchemy"
  PROVIDER_FAILOVER_ENABLED: "true"
  CIRCUIT_BREAKER_ENABLED: "true"
  COST_TRACKING_ENABLED: "true"
  MONTHLY_BUDGET: "800"

---
apiVersion: v1
kind: Secret
metadata:
  name: crypto-service-secrets
  namespace: crypto-data
type: Opaque
data:
  DATABASE_URL: <base64-encoded-database-url>
  REDIS_URL: <base64-encoded-redis-url>
  JWT_SECRET: <base64-encoded-jwt-secret>
  ALCHEMY_API_KEY: <base64-encoded-alchemy-key>
  MORALIS_API_KEY: <base64-encoded-moralis-key>
  HELIUS_API_KEY: <base64-encoded-helius-key>
  SENTRY_DSN: <base64-encoded-sentry-dsn>

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-service
  namespace: crypto-data
  labels:
    app: crypto-service
    version: v3.0.0
    environment: production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: crypto-service
  template:
    metadata:
      labels:
        app: crypto-service
        version: v3.0.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
        config/hash: "${CONFIG_HASH}"
    spec:
      serviceAccountName: crypto-service
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
      - name: crypto-service
        image: smartwalletfx/crypto-service:v3.0.0
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
          protocol: TCP
        envFrom:
        - configMapRef:
            name: crypto-service-config
        - secretRef:
            name: crypto-service-secrets
        env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          successThreshold: 1
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          successThreshold: 1
          failureThreshold: 3
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
        volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: logs
          mountPath: /app/logs
      volumes:
      - name: tmp
        emptyDir: {}
      - name: logs
        emptyDir: {}
      nodeSelector:
        kubernetes.io/arch: amd64
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - crypto-service
              topologyKey: kubernetes.io/hostname
      tolerations:
      - key: "crypto-data"
        operator: "Equal"
        value: "true"
        effect: "NoSchedule"

---
apiVersion: v1
kind: Service
metadata:
  name: crypto-service
  namespace: crypto-data
  labels:
    app: crypto-service
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-backend-protocol: http
spec:
  type: LoadBalancer
  selector:
    app: crypto-service
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  sessionAffinity: None

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: crypto-service
  namespace: crypto-data
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/crypto-service-role

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: crypto-service-ingress
  namespace: crypto-data
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "1000"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - api.smartwalletfx.com
    secretName: crypto-service-tls
  rules:
  - host: api.smartwalletfx.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: crypto-service
            port:
              number: 80

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: crypto-service-hpa
  namespace: crypto-data
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: crypto-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
      - type: Pods
        value: 2
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60

---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: crypto-service-pdb
  namespace: crypto-data
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: crypto-service
```

### Database StatefulSet

```yaml
# =============================================================================
# POSTGRESQL STATEFULSET
# =============================================================================

apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-config
  namespace: crypto-data
data:
  postgresql.conf: |
    # Connection Settings
    max_connections = 200
    shared_buffers = 4GB
    effective_cache_size = 12GB
    maintenance_work_mem = 512MB
    checkpoint_completion_target = 0.9
    wal_buffers = 64MB
    default_statistics_target = 500
    random_page_cost = 1.1
    effective_io_concurrency = 200
    work_mem = 32MB
    min_wal_size = 2GB
    max_wal_size = 8GB
    
    # Logging
    log_destination = 'stderr'
    logging_collector = on
    log_directory = 'pg_log'
    log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
    log_statement = 'mod'
    log_min_duration_statement = 1000
    
    # Performance
    synchronous_commit = on
    checkpoint_timeout = 15min
    max_wal_senders = 10
    hot_standby = on

---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: crypto-data
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: crypto_data
        - name: POSTGRES_USER
          value: crypto_user
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-secrets
              key: password
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        - name: postgres-config
          mountPath: /etc/postgresql/postgresql.conf
          subPath: postgresql.conf
        resources:
          requests:
            memory: 8Gi
            cpu: 2000m
          limits:
            memory: 16Gi
            cpu: 4000m
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - crypto_user
            - -d
            - crypto_data
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - crypto_user
            - -d
            - crypto_data
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: postgres-config
        configMap:
          name: postgres-config
  volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 500Gi

---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: crypto-data
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
  clusterIP: None
```

## 🔧 nginx Configuration

### Production nginx.conf

```nginx
# =============================================================================
# PRODUCTION NGINX CONFIGURATION
# =============================================================================

user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        application/atom+xml
        application/geo+json
        application/javascript
        application/x-javascript
        application/json
        application/ld+json
        application/manifest+json
        application/rdf+xml
        application/rss+xml
        application/xhtml+xml
        application/xml
        font/eot
        font/otf
        font/ttf
        image/svg+xml
        text/css
        text/javascript
        text/plain
        text/xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general:10m rate=100r/s;

    # Upstream configuration
    upstream crypto_service {
        least_conn;
        server crypto-service-1:3000 max_fails=3 fail_timeout=30s;
        server crypto-service-2:3000 max_fails=3 fail_timeout=30s;
        server crypto-service-3:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name api.smartwalletfx.com;

        # SSL configuration
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_session_cache shared:le_nginx_SSL:10m;
        ssl_session_timeout 1440m;
        ssl_session_tickets off;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers off;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;

        # Security headers
        add_header Strict-Transport-Security "max-age=63072000" always;
        add_header X-Frame-Options DENY always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';" always;

        # Rate limiting
        limit_req zone=general burst=200 nodelay;

        # Health check endpoint (no rate limiting)
        location /health {
            access_log off;
            proxy_pass http://crypto_service;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_connect_timeout 5s;
            proxy_send_timeout 10s;
            proxy_read_timeout 10s;
        }

        # API endpoints with stricter rate limiting
        location /api/ {
            limit_req zone=api burst=50 nodelay;
            
            proxy_pass http://crypto_service;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            
            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            # Buffer settings
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
            proxy_busy_buffers_size 8k;
        }

        # Static content caching
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            proxy_pass http://crypto_service;
        }

        # Default location
        location / {
            proxy_pass http://crypto_service;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name api.smartwalletfx.com;
        return 301 https://$server_name$request_uri;
    }
}
```

## 📋 Configuration Validation Scripts

### Environment Validation Script

```bash
#!/bin/bash
# =============================================================================
# PRODUCTION CONFIGURATION VALIDATION SCRIPT
# =============================================================================

set -e

echo "🔍 Validating Production Configuration..."

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Validation functions
validate_required_env() {
    local var_name=$1
    local var_value=${!var_name}
    
    if [ -z "$var_value" ]; then
        echo -e "${RED}❌ Required environment variable $var_name is not set${NC}"
        return 1
    else
        echo -e "${GREEN}✅ $var_name is set${NC}"
        return 0
    fi
}

validate_database_connection() {
    echo "🗄️ Validating database connection..."
    
    if command -v psql &> /dev/null; then
        if psql "$DATABASE_URL" -c "SELECT 1;" &> /dev/null; then
            echo -e "${GREEN}✅ Database connection successful${NC}"
        else
            echo -e "${RED}❌ Database connection failed${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠️ psql not available, skipping database validation${NC}"
    fi
}

validate_redis_connection() {
    echo "🔄 Validating Redis connection..."
    
    if command -v redis-cli &> /dev/null; then
        local redis_host=$(echo $REDIS_URL | cut -d'/' -f3 | cut -d':' -f1)
        local redis_port=$(echo $REDIS_URL | cut -d'/' -f3 | cut -d':' -f2)
        
        if redis-cli -h "$redis_host" -p "$redis_port" ping &> /dev/null; then
            echo -e "${GREEN}✅ Redis connection successful${NC}"
        else
            echo -e "${RED}❌ Redis connection failed${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠️ redis-cli not available, skipping Redis validation${NC}"
    fi
}

validate_external_apis() {
    echo "🌐 Validating external API keys..."
    
    # Test Alchemy API
    if [ -n "$ALCHEMY_API_KEY" ]; then
        local response=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            "https://eth-mainnet.alchemyapi.io/v2/$ALCHEMY_API_KEY")
        
        if [ "$response" = "200" ]; then
            echo -e "${GREEN}✅ Alchemy API key is valid${NC}"
        else
            echo -e "${RED}❌ Alchemy API key validation failed (HTTP $response)${NC}"
        fi
    fi
    
    # Test Moralis API
    if [ -n "$MORALIS_API_KEY" ]; then
        local response=$(curl -s -o /dev/null -w "%{http_code}" \
            -H "X-API-Key: $MORALIS_API_KEY" \
            "https://api.moralis.com/api/v2/info")
        
        if [ "$response" = "200" ]; then
            echo -e "${GREEN}✅ Moralis API key is valid${NC}"
        else
            echo -e "${RED}❌ Moralis API key validation failed (HTTP $response)${NC}"
        fi
    fi
}

validate_security_settings() {
    echo "🔐 Validating security settings..."
    
    # Check JWT secret length
    if [ ${#JWT_SECRET} -lt 32 ]; then
        echo -e "${RED}❌ JWT_SECRET is too short (minimum 32 characters)${NC}"
        return 1
    else
        echo -e "${GREEN}✅ JWT_SECRET length is adequate${NC}"
    fi
    
    # Check CORS origins
    if [[ "$CORS_ORIGINS" == *"localhost"* ]] && [ "$NODE_ENV" = "production" ]; then
        echo -e "${YELLOW}⚠️ CORS_ORIGINS contains localhost in production${NC}"
    fi
    
    # Check SSL settings
    if [ "$NODE_ENV" = "production" ] && [ "$SSL_ENABLED" != "true" ]; then
        echo -e "${YELLOW}⚠️ SSL is not enabled in production${NC}"
    fi
}

# Main validation sequence
echo "Starting configuration validation for environment: $NODE_ENV"
echo "=================================================="

# Required environment variables
REQUIRED_VARS=(
    "NODE_ENV"
    "DATABASE_URL"
    "REDIS_URL"
    "JWT_SECRET"
    "ALCHEMY_API_KEY"
)

validation_failed=false

# Validate required variables
for var in "${REQUIRED_VARS[@]}"; do
    if ! validate_required_env "$var"; then
        validation_failed=true
    fi
done

# Validate connections and external services
if ! validate_database_connection; then
    validation_failed=true
fi

if ! validate_redis_connection; then
    validation_failed=true
fi

validate_external_apis
validate_security_settings

# Final result
echo "=================================================="
if [ "$validation_failed" = true ]; then
    echo -e "${RED}❌ Configuration validation failed${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Configuration validation passed${NC}"
    exit 0
fi
```

### Kubernetes Configuration Validation

```bash
#!/bin/bash
# =============================================================================
# KUBERNETES CONFIGURATION VALIDATION SCRIPT
# =============================================================================

set -e

echo "☸️ Validating Kubernetes Configuration..."

# Validate namespace
echo "📦 Checking namespace..."
if kubectl get namespace crypto-data &> /dev/null; then
    echo "✅ Namespace crypto-data exists"
else
    echo "❌ Namespace crypto-data does not exist"
    exit 1
fi

# Validate secrets
echo "🔐 Checking secrets..."
if kubectl get secret crypto-service-secrets -n crypto-data &> /dev/null; then
    echo "✅ Service secrets exist"
else
    echo "❌ Service secrets missing"
    exit 1
fi

# Validate configmaps
echo "⚙️ Checking configmaps..."
if kubectl get configmap crypto-service-config -n crypto-data &> /dev/null; then
    echo "✅ Service configmap exists"
else
    echo "❌ Service configmap missing"
    exit 1
fi

# Validate deployment
echo "🚀 Checking deployment..."
if kubectl get deployment crypto-service -n crypto-data &> /dev/null; then
    echo "✅ Deployment exists"
    
    # Check replicas
    READY_REPLICAS=$(kubectl get deployment crypto-service -n crypto-data -o jsonpath='{.status.readyReplicas}')
    DESIRED_REPLICAS=$(kubectl get deployment crypto-service -n crypto-data -o jsonpath='{.spec.replicas}')
    
    if [ "$READY_REPLICAS" = "$DESIRED_REPLICAS" ]; then
        echo "✅ All replicas are ready ($READY_REPLICAS/$DESIRED_REPLICAS)"
    else
        echo "⚠️ Not all replicas are ready ($READY_REPLICAS/$DESIRED_REPLICAS)"
    fi
else
    echo "❌ Deployment missing"
    exit 1
fi

# Validate service
echo "🌐 Checking service..."
if kubectl get service crypto-service -n crypto-data &> /dev/null; then
    echo "✅ Service exists"
else
    echo "❌ Service missing"
    exit 1
fi

# Validate ingress
echo "🚪 Checking ingress..."
if kubectl get ingress crypto-service-ingress -n crypto-data &> /dev/null; then
    echo "✅ Ingress exists"
else
    echo "❌ Ingress missing"
    exit 1
fi

echo "✅ Kubernetes configuration validation completed"
```

---

These configuration templates provide production-ready setups for various deployment scenarios, ensuring proper security, performance, and operational procedures across all environments.