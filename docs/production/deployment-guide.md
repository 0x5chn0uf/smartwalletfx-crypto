# Production Deployment Guide

> Complete guide for deploying SmartWalletFX Crypto Data Service to production environments

## 🎯 Overview

This guide covers production deployment strategies, configuration, monitoring setup, and operational procedures for the SmartWalletFX Crypto Data Service.

## 📋 Pre-Deployment Checklist

### Environment Requirements

- [ ] **Node.js**: Version 20+ LTS
- [ ] **PostgreSQL**: Version 15+ with connection pooling
- [ ] **Redis**: Version 7+ with persistence enabled
- [ ] **Load Balancer**: nginx, HAProxy, or cloud ALB
- [ ] **Monitoring**: Prometheus + Grafana stack
- [ ] **SSL/TLS**: Valid certificates for HTTPS

### Security Requirements

- [ ] **API Keys**: Secure storage (AWS Secrets Manager, HashiCorp Vault)
- [ ] **Environment Variables**: Encrypted and source-controlled
- [ ] **Network Security**: VPC, security groups, firewalls configured
- [ ] **Access Control**: RBAC, service accounts, audit logging
- [ ] **Compliance**: SOC 2, GDPR, or other relevant standards

### Performance Requirements

- [ ] **CPU**: Minimum 4 cores (8 cores recommended)
- [ ] **Memory**: Minimum 8GB RAM (16GB recommended)
- [ ] **Storage**: SSD with IOPS 3000+ for database
- [ ] **Network**: 10Gbps bandwidth for high-throughput scenarios
- [ ] **CDN**: CloudFlare, CloudFront for static assets

## 🚀 Deployment Strategies

### 1. Docker Deployment

#### Production Dockerfile
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:20-alpine AS production

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S crypto-service -u 1001

WORKDIR /app

# Copy built application
COPY --from=builder --chown=crypto-service:nodejs /app/dist ./dist
COPY --from=builder --chown=crypto-service:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=crypto-service:nodejs /app/package.json ./package.json

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

USER crypto-service

EXPOSE 3000

CMD ["npm", "start"]
```

#### Docker Compose Production
```yaml
version: '3.8'

services:
  crypto-service:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: crypto_data
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - crypto-service
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### 2. Kubernetes Deployment

#### Namespace and Resources
```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: crypto-data
  labels:
    name: crypto-data
    monitoring: enabled
```

#### ConfigMap for Configuration
```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: crypto-service-config
  namespace: crypto-data
data:
  NODE_ENV: "production"
  PORT: "3000"
  LOG_LEVEL: "info"
  CORS_ORIGINS: "https://app.smartwalletfx.com"
  RATE_LIMIT_MAX: "1000"
  RATE_LIMIT_WINDOW: "15"
```

#### Secret Management
```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: crypto-service-secrets
  namespace: crypto-data
type: Opaque
data:
  DATABASE_URL: <base64-encoded-database-url>
  REDIS_URL: <base64-encoded-redis-url>
  ALCHEMY_API_KEY: <base64-encoded-api-key>
  JWT_SECRET: <base64-encoded-jwt-secret>
```

#### Deployment Configuration
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-service
  namespace: crypto-data
  labels:
    app: crypto-service
    version: v3.0.0
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
    spec:
      serviceAccountName: crypto-service
      containers:
      - name: crypto-service
        image: smartwalletfx/crypto-service:3.0.0
        ports:
        - containerPort: 3000
          name: http
        envFrom:
        - configMapRef:
            name: crypto-service-config
        - secretRef:
            name: crypto-service-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        securityContext:
          runAsNonRoot: true
          runAsUser: 1001
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
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
```

#### Service and Ingress
```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: crypto-service
  namespace: crypto-data
  labels:
    app: crypto-service
spec:
  selector:
    app: crypto-service
  ports:
  - port: 80
    targetPort: 3000
    name: http
  type: ClusterIP

---
# ingress.yaml
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
```

#### Horizontal Pod Autoscaler
```yaml
# hpa.yaml
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
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
```

### 3. AWS ECS Deployment

#### Task Definition
```json
{
  "family": "crypto-service",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::account:role/crypto-service-task-role",
  "containerDefinitions": [
    {
      "name": "crypto-service",
      "image": "smartwalletfx/crypto-service:3.0.0",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "/crypto-service/prod/database-url"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "/crypto-service/prod/redis-url"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -f http://localhost:3000/health || exit 1"
        ],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/crypto-service",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

## 🔧 Configuration Management

### Environment Variables

#### Required Configuration
```bash
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:pass@host:5432/crypto_data
DATABASE_POOL_SIZE=20
DATABASE_CONNECTION_TIMEOUT=60000
DATABASE_IDLE_TIMEOUT=300000

# Redis
REDIS_URL=redis://host:6379
REDIS_MAX_RETRIES=3
REDIS_RETRY_DELAY=1000

# Security
JWT_SECRET=your-256-bit-secret
CORS_ORIGINS=https://app.smartwalletfx.com,https://admin.smartwalletfx.com
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=15

# External APIs
ALCHEMY_API_KEY=your-alchemy-key
MORALIS_API_KEY=your-moralis-key
HELIUS_API_KEY=your-helius-key

# Monitoring
SENTRY_DSN=your-sentry-dsn
PROMETHEUS_ENABLED=true
METRICS_PREFIX=crypto_data

# Performance
WORKER_CONCURRENCY=4
BATCH_SIZE=100
CACHE_TTL=300
```

#### Optional Configuration
```bash
# Advanced Caching
INTELLIGENT_CACHE_ENABLED=true
PREDICTIVE_CACHE_ENABLED=true
CACHE_WARMING_INTERVAL=3600000

# Cost Optimization
COST_TRACKING_ENABLED=true
MONTHLY_BUDGET=1000
ALERT_THRESHOLD=800
PROVIDER_ROTATION_ENABLED=true

# Performance Tuning
CONCURRENCY_ENABLED=true
CHAIN_MANAGER_CONCURRENCY=10
REQUEST_DEDUPLICATION=true
BATCH_AGGREGATION=true

# Monitoring
DETAILED_METRICS=true
CUSTOM_METRICS_ENABLED=true
ERROR_TRACKING_ENABLED=true
PERFORMANCE_PROFILING=false
```

### Configuration Validation

Create a production readiness checker:

```typescript
// scripts/production-readiness-check.ts
import { z } from 'zod';
import { logger } from '../src/utils/logger';

const ProductionConfigSchema = z.object({
  NODE_ENV: z.literal('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ALCHEMY_API_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1),
  // Add all required fields
});

export async function validateProductionConfig(): Promise<boolean> {
  try {
    const config = ProductionConfigSchema.parse(process.env);
    logger.info('✅ Production configuration validation passed');
    return true;
  } catch (error) {
    logger.error('❌ Production configuration validation failed:', error);
    return false;
  }
}

// Run validation
if (require.main === module) {
  validateProductionConfig().then(valid => {
    process.exit(valid ? 0 : 1);
  });
}
```

## 🔐 Security Configuration

### SSL/TLS Setup

#### Nginx Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name api.smartwalletfx.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_session_cache shared:le_nginx_SSL:10m;
    ssl_session_timeout 1440m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    location / {
        proxy_pass http://crypto-service:3000;
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
    }

    # Health check bypass
    location /health {
        proxy_pass http://crypto-service:3000/health;
        access_log off;
    }
}
```

### API Security

#### Rate Limiting Configuration
```typescript
// Enhanced rate limiting for production
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL
});

// Different limits for different endpoint types
export const createRateLimiters = () => ({
  general: rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:general:'
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // requests per window
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later'
      }
    },
    standardHeaders: true,
    legacyHeaders: false
  }),

  expensive: rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:expensive:'
    }),
    windowMs: 60 * 1000, // 1 minute
    max: 20, // requests per minute for expensive operations
    keyGenerator: (req) => `${req.ip}:${req.headers['x-api-key']}`,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many expensive operations, please try again later'
      }
    }
  }),

  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 failed auth attempts per window
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `auth:${req.ip}`,
    message: {
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts'
      }
    }
  })
});
```

## 📊 Monitoring Setup

### Prometheus Configuration

#### prometheus.yml
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "crypto-data-alerts.yml"

scrape_configs:
  - job_name: 'crypto-service'
    static_configs:
      - targets: ['crypto-service:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
    scrape_timeout: 10s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

#### Alert Rules
```yaml
# crypto-data-alerts.yml
groups:
- name: crypto-data-service
  rules:
  - alert: HighErrorRate
    expr: rate(crypto_data_http_requests_total{status_code=~"5.."}[5m]) > 0.1
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} errors per second"

  - alert: HighResponseTime
    expr: histogram_quantile(0.95, rate(crypto_data_http_request_duration_seconds_bucket[5m])) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High response time detected"
      description: "95th percentile response time is {{ $value }}s"

  - alert: HighMemoryUsage
    expr: (process_resident_memory_bytes / 1024 / 1024) > 3000
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage"
      description: "Memory usage is {{ $value }}MB"

  - alert: DatabaseConnectionFailure
    expr: up{job="postgres"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Database connection failure"
      description: "PostgreSQL database is unreachable"

  - alert: RedisConnectionFailure
    expr: up{job="redis"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Redis connection failure"
      description: "Redis cache is unreachable"

  - alert: HighCostUtilization
    expr: crypto_data_provider_budget_utilization_ratio > 0.9
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High cost utilization"
      description: "Provider {{ $labels.provider }} is at {{ $value | humanizePercentage }} budget utilization"
```

### Grafana Dashboard

Deploy the comprehensive monitoring dashboard:

```bash
# Import the Phase 3 production dashboard
kubectl create configmap grafana-dashboard-crypto-service \
  --from-file=monitoring/grafana-dashboard-production.json \
  -n monitoring

# Label for auto-discovery
kubectl label configmap grafana-dashboard-crypto-service \
  grafana_dashboard=1 \
  -n monitoring
```

## 🚀 Deployment Scripts

### Blue-Green Deployment

```bash
#!/bin/bash
# scripts/blue-green-deploy.sh

set -e

NAMESPACE="crypto-data"
NEW_VERSION=$1
CURRENT_VERSION=$(kubectl get deployment crypto-service -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[0].image}' | cut -d':' -f2)

echo "🚀 Starting blue-green deployment"
echo "Current version: $CURRENT_VERSION"
echo "New version: $NEW_VERSION"

# Create new deployment (green)
echo "📦 Creating green deployment..."
kubectl patch deployment crypto-service -n $NAMESPACE -p \
  '{"spec":{"template":{"spec":{"containers":[{"name":"crypto-service","image":"smartwalletfx/crypto-service:'$NEW_VERSION'"}]}}}}'

# Wait for rollout
echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment crypto-service -n $NAMESPACE --timeout=600s

# Health check
echo "🏥 Performing health checks..."
for i in {1..30}; do
  if kubectl exec -n $NAMESPACE deployment/crypto-service -- curl -f http://localhost:3000/health; then
    echo "✅ Health check passed"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Health check failed, rolling back..."
    kubectl rollout undo deployment crypto-service -n $NAMESPACE
    exit 1
  fi
  sleep 10
done

# Traffic validation
echo "🔍 Validating traffic..."
EXTERNAL_URL="https://api.smartwalletfx.com"
for endpoint in "/health" "/api/protocols"; do
  if ! curl -f "$EXTERNAL_URL$endpoint" > /dev/null; then
    echo "❌ External validation failed for $endpoint, rolling back..."
    kubectl rollout undo deployment crypto-service -n $NAMESPACE
    exit 1
  fi
done

echo "🎉 Blue-green deployment completed successfully!"
echo "New version $NEW_VERSION is now live"
```

### Canary Deployment

```bash
#!/bin/bash
# scripts/canary-deploy.sh

set -e

NAMESPACE="crypto-data"
NEW_VERSION=$1
CANARY_PERCENTAGE=${2:-10}

echo "🕊️ Starting canary deployment"
echo "New version: $NEW_VERSION"
echo "Canary percentage: $CANARY_PERCENTAGE%"

# Create canary deployment
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-service-canary
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: crypto-service
      version: canary
  template:
    metadata:
      labels:
        app: crypto-service
        version: canary
    spec:
      containers:
      - name: crypto-service
        image: smartwalletfx/crypto-service:$NEW_VERSION
        # ... same config as main deployment
EOF

# Update service to include canary
kubectl patch service crypto-service -n $NAMESPACE -p \
  '{"spec":{"selector":{"app":"crypto-service"}}}'

# Monitor metrics for 10 minutes
echo "📊 Monitoring canary metrics..."
for i in {1..60}; do
  ERROR_RATE=$(kubectl exec -n monitoring deployment/prometheus -- \
    promtool query instant \
    'rate(crypto_data_http_requests_total{status_code=~"5..",version="canary"}[5m])' \
    | grep -o '[0-9.]*' | head -1)
  
  if (( $(echo "$ERROR_RATE > 0.05" | bc -l) )); then
    echo "❌ High error rate detected in canary: $ERROR_RATE"
    kubectl delete deployment crypto-service-canary -n $NAMESPACE
    exit 1
  fi
  
  sleep 10
done

echo "✅ Canary validation successful, proceeding with full deployment"

# Replace main deployment
kubectl patch deployment crypto-service -n $NAMESPACE -p \
  '{"spec":{"template":{"spec":{"containers":[{"name":"crypto-service","image":"smartwalletfx/crypto-service:'$NEW_VERSION'"}]}}}}'

# Cleanup canary
kubectl delete deployment crypto-service-canary -n $NAMESPACE

echo "🎉 Canary deployment completed successfully!"
```

## 🔄 Rollback Procedures

### Quick Rollback

```bash
#!/bin/bash
# scripts/emergency-rollback.sh

NAMESPACE="crypto-data"
REASON=${1:-"Emergency rollback"}

echo "🚨 EMERGENCY ROLLBACK INITIATED"
echo "Reason: $REASON"

# Immediate rollback
kubectl rollout undo deployment crypto-service -n $NAMESPACE

# Wait for rollback
kubectl rollout status deployment crypto-service -n $NAMESPACE --timeout=300s

# Verify health
kubectl exec -n $NAMESPACE deployment/crypto-service -- curl -f http://localhost:3000/health

echo "✅ Emergency rollback completed"
echo "📋 Please investigate the issue and update incident documentation"
```

## 📈 Performance Optimization

### Database Optimization

```sql
-- Production database optimizations
-- Connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET default_statistics_target = 500;

-- Indexes for performance
CREATE INDEX CONCURRENTLY idx_portfolio_address_updated 
ON portfolio_data(address, last_updated DESC);

CREATE INDEX CONCURRENTLY idx_defi_positions_address_protocol 
ON defi_positions(address, protocol, chain_id);

CREATE INDEX CONCURRENTLY idx_nft_collections_address_chain 
ON nft_collections(address, chain_id, created_at DESC);

-- Partitioning for large tables
CREATE TABLE portfolio_data_partitioned (
  LIKE portfolio_data INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE portfolio_data_2024_q1 
PARTITION OF portfolio_data_partitioned
FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');
```

### Redis Optimization

```redis
# Redis production configuration
maxmemory 8gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

### Node.js Optimization

```javascript
// Production PM2 configuration
module.exports = {
  apps: [{
    name: 'crypto-service',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '2G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=2048'
    },
    node_args: [
      '--max-old-space-size=2048',
      '--optimize-for-size'
    ]
  }]
};
```

## 📝 Maintenance Procedures

### Regular Maintenance Tasks

```bash
#!/bin/bash
# scripts/maintenance.sh

echo "🔧 Starting maintenance tasks..."

# Database maintenance
kubectl exec -n crypto-data postgres-0 -- psql -U crypto_user -d crypto_data -c "
  VACUUM ANALYZE;
  REINDEX DATABASE crypto_data;
"

# Redis maintenance
kubectl exec -n crypto-data redis-0 -- redis-cli BGREWRITEAOF

# Log rotation
kubectl exec -n crypto-data deployment/crypto-service -- \
  find /app/logs -name "*.log" -type f -mtime +7 -delete

# Clear old metrics data
kubectl exec -n monitoring prometheus-0 -- \
  find /prometheus/data -name "*.tmp" -delete

echo "✅ Maintenance tasks completed"
```

### Backup Procedures

```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
S3_BUCKET="smartwalletfx-backups"

echo "💾 Starting backup process..."

# Database backup
kubectl exec -n crypto-data postgres-0 -- \
  pg_dump -U crypto_user crypto_data | \
  gzip > "db_backup_${BACKUP_DATE}.sql.gz"

# Upload to S3
aws s3 cp "db_backup_${BACKUP_DATE}.sql.gz" \
  "s3://${S3_BUCKET}/database/"

# Redis backup
kubectl exec -n crypto-data redis-0 -- \
  redis-cli BGSAVE

# Configuration backup
kubectl get configmap,secret -n crypto-data -o yaml > \
  "config_backup_${BACKUP_DATE}.yaml"

aws s3 cp "config_backup_${BACKUP_DATE}.yaml" \
  "s3://${S3_BUCKET}/config/"

echo "✅ Backup completed: ${BACKUP_DATE}"
```

## 🚨 Incident Response

### Emergency Contacts

```yaml
# Emergency contact information
primary_oncall:
  name: "DevOps Team"
  phone: "+1-555-0123"
  email: "devops@smartwalletfx.com"
  slack: "#crypto-service-alerts"

secondary_oncall:
  name: "Engineering Manager"
  phone: "+1-555-0124"
  email: "engineering@smartwalletfx.com"

escalation:
  name: "CTO"
  phone: "+1-555-0125"
  email: "cto@smartwalletfx.com"
```

### Incident Response Playbook

1. **Immediate Response** (0-5 minutes)
   - Acknowledge the alert
   - Assess impact and severity
   - Initiate incident channel
   - Consider immediate rollback if recent deployment

2. **Investigation** (5-30 minutes)
   - Check monitoring dashboards
   - Review recent changes
   - Examine error logs
   - Test service endpoints

3. **Mitigation** (30-60 minutes)
   - Implement temporary fixes
   - Scale resources if needed
   - Rollback if necessary
   - Communicate status updates

4. **Resolution** (1-4 hours)
   - Implement permanent fix
   - Verify full functionality
   - Update monitoring/alerts
   - Document lessons learned

## 📊 Success Metrics

Track these KPIs post-deployment:

- **Availability**: 99.95% uptime SLA
- **Performance**: <200ms average response time
- **Error Rate**: <0.1% 5xx errors
- **Cost Efficiency**: Stay within budget targets
- **User Satisfaction**: Monitor via NPS scores

---

This deployment guide provides a comprehensive approach to production deployment with focus on reliability, security, and operational excellence. Regular reviews and updates ensure continued optimization and incident prevention.