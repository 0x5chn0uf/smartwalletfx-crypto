# Production Configuration Templates

> **Production-ready configuration templates for SmartWalletFX Crypto Data Service Phase 3**

## 🎯 Overview

This document provides comprehensive configuration templates for deploying the SmartWalletFX Crypto Data Service in production environments. All templates are optimized for Phase 3 performance, security, and monitoring requirements.

## 📋 Configuration Files

### Environment Configuration

#### Production Environment Variables
```bash
# .env.production
# ======================
# SmartWalletFX Crypto Data Service - Production Configuration
# Phase 3 Release
# ======================

# Application Settings
NODE_ENV=production
PORT=3000
APP_VERSION=3.0.0
SERVICE_NAME=crypto-data-api

# Node.js Optimization
NODE_OPTIONS="--max-old-space-size=3584 --optimize-for-size --enable-source-maps"
UV_THREADPOOL_SIZE=128

# Security
API_KEY_HEADER=X-API-Key
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SESSION_SECRET=${SESSION_SECRET}

# Database Configuration
DATABASE_URL=${DATABASE_URL}
DB_POOL_MIN=10
DB_POOL_MAX=50
DB_ACQUIRE_TIMEOUT=30000
DB_IDLE_TIMEOUT=600000
DB_STATEMENT_TIMEOUT=30000
DB_QUERY_TIMEOUT=15000
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

# Redis Configuration
REDIS_URL=${REDIS_URL}
REDIS_CLUSTER_MODE=true
REDIS_POOL_SIZE=50
REDIS_CONNECT_TIMEOUT=5000
REDIS_COMMAND_TIMEOUT=3000
REDIS_RETRY_ATTEMPTS=3
REDIS_PASSWORD=${REDIS_PASSWORD}

# Cache Configuration
L1_CACHE_SIZE=256
L1_CACHE_TTL=300
L2_CACHE_SIZE=2048
L2_CACHE_TTL=3600
L3_CACHE_TTL=86400
CACHE_WARM_ENABLED=true
CACHE_WARM_INTERVAL=600
CACHE_COMPRESSION=true

# Performance Settings
MAX_CONCURRENT_REQUESTS=1000
REQUEST_TIMEOUT=30000
GRACEFUL_SHUTDOWN_TIMEOUT=15000
WORKER_THREADS_COUNT=8
WORKER_QUEUE_SIZE=10000
WORKER_BATCH_SIZE=50

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=1000
RATE_LIMIT_REDIS_PREFIX=rl:
RATE_LIMIT_SKIP_ON_ERROR=false

# API Provider Configuration
ALCHEMY_API_KEY=${ALCHEMY_API_KEY}
HELIUS_API_KEY=${HELIUS_API_KEY}
QUICKNODE_API_KEY=${QUICKNODE_API_KEY}
MORALIS_API_KEY=${MORALIS_API_KEY}

# Provider Settings
PROVIDER_TIMEOUT=15000
PROVIDER_RETRY_ATTEMPTS=3
PROVIDER_BATCH_SIZE=50
PROVIDER_RATE_LIMIT=1000
PROVIDER_CIRCUIT_BREAKER_THRESHOLD=50
PROVIDER_CIRCUIT_BREAKER_TIMEOUT=30000

# Cost Optimization
COST_TRACKING_ENABLED=true
COST_OPTIMIZATION_ENABLED=true
MONTHLY_BUDGET_USD=10000
DAILY_BUDGET_USD=333
COST_ALERT_THRESHOLD=0.8
REQUEST_DEDUPLICATION_ENABLED=true
REQUEST_DEDUPLICATION_WINDOW=5000

# Monitoring & Observability
METRICS_ENABLED=true
METRICS_PORT=9090
METRICS_PATH=/metrics
LOG_LEVEL=info
LOG_FORMAT=json
TRACING_ENABLED=true
TRACING_SAMPLE_RATE=0.1
HEALTH_CHECK_ENABLED=true

# Security Headers
HELMET_ENABLED=true
CSP_ENABLED=true
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true

# CORS Configuration
CORS_ENABLED=true
CORS_ORIGIN=https://app.smartwalletfx.com,https://dashboard.smartwalletfx.com
CORS_CREDENTIALS=true
CORS_MAX_AGE=86400

# Feature Flags
ENABLE_PORTFOLIO_AGGREGATION=true
ENABLE_DEFI_POSITIONS=true
ENABLE_NFT_COLLECTIONS=true
ENABLE_SOLANA_SUPPORT=true
ENABLE_PRICE_FEEDS=true
ENABLE_ANALYTICS=true
ENABLE_ADMIN_ENDPOINTS=false

# Development & Debug (Production: false)
DEBUG_ENABLED=false
PROFILING_ENABLED=false
VERBOSE_LOGGING=false
API_DOCS_ENABLED=false
```

### Kubernetes Configuration

#### Production Deployment
```yaml
# k8s/production/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: crypto-data-api
  namespace: smartwalletfx-prod
  labels:
    app: crypto-data-api
    version: "3.0.0"
    environment: production
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 2
  selector:
    matchLabels:
      app: crypto-data-api
  template:
    metadata:
      labels:
        app: crypto-data-api
        version: "3.0.0"
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: crypto-data-service-account
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        fsGroup: 1001
      containers:
      - name: app
        image: smartwalletfx/crypto-data:3.0.0
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
          protocol: TCP
        - containerPort: 9090
          name: metrics
          protocol: TCP
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: DATABASE_URL
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: REDIS_URL
        envFrom:
        - configMapRef:
            name: crypto-data-config
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
            ephemeral-storage: "2Gi"
          limits:
            memory: "4Gi"
            cpu: "2000m"
            ephemeral-storage: "4Gi"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          runAsNonRoot: true
          runAsUser: 1001
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
      terminationGracePeriodSeconds: 30
```

### Service Configuration
```yaml
# k8s/production/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: crypto-data-service
  namespace: smartwalletfx-prod
  labels:
    app: crypto-data-api
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  - port: 9090
    targetPort: 9090
    protocol: TCP
    name: metrics
  selector:
    app: crypto-data-api
```

### HPA Configuration
```yaml
# k8s/production/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: crypto-data-hpa
  namespace: smartwalletfx-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: crypto-data-api
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

---

**Last Updated**: Phase 3 Release  
**Version**: 3.0.0  
**Maintained By**: DevOps Team

*For configuration support, contact: devops@smartwalletfx.com*