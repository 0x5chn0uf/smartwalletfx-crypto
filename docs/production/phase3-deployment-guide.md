# SmartWalletFX Phase 3 Production Deployment Guide

> **Complete deployment guide for SmartWalletFX Crypto Data Service Phase 3 production release**

## 🎯 Overview

This guide provides comprehensive step-by-step instructions for deploying the SmartWalletFX Crypto Data Service to production with all Phase 3 enhancements including security fixes, performance optimizations, and build improvements.

## 📋 Prerequisites

### Infrastructure Requirements

- **Kubernetes Cluster**: v1.25+ with RBAC enabled
- **PostgreSQL**: v15+ with read replicas
- **Redis Cluster**: v7+ with sentinel/cluster mode
- **Load Balancer**: Nginx/HAProxy or cloud provider LB
- **Monitoring**: Prometheus + Grafana stack
- **Secrets Management**: Kubernetes secrets or external vault

### Performance Specifications

```yaml
Production Sizing:
  API Pods: 3-6 replicas
  CPU: 2-4 cores per pod
  Memory: 4-8GB per pod
  Storage: 100GB+ SSD
  Network: 10Gbps+
```

### Security Requirements

- TLS 1.3 certificates
- API rate limiting (1000 req/min default)
- Network policies configured
- RBAC permissions restricted
- Secrets encrypted at rest

## 🚀 Deployment Steps

### Step 1: Environment Preparation

#### 1.1 Create Namespace
```bash
kubectl create namespace smartwalletfx-prod
kubectl label namespace smartwalletfx-prod environment=production
```

#### 1.2 Configure Secrets
```bash
# Database credentials
kubectl create secret generic db-credentials \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/smartwalletfx" \
  --namespace=smartwalletfx-prod

# Redis credentials
kubectl create secret generic redis-credentials \
  --from-literal=REDIS_URL="redis://user:pass@redis-cluster:6379" \
  --namespace=smartwalletfx-prod

# API keys for blockchain providers
kubectl create secret generic api-keys \
  --from-literal=ALCHEMY_API_KEY="your-alchemy-key" \
  --from-literal=HELIUS_API_KEY="your-helius-key" \
  --from-literal=QUICKNODE_API_KEY="your-quicknode-key" \
  --namespace=smartwalletfx-prod
```

#### 1.3 Deploy Configuration
```bash
# Apply ConfigMap
kubectl apply -f k8s/configmap-prod.yaml

# Apply NetworkPolicies
kubectl apply -f k8s/network-policies.yaml
```

### Step 2: Database Setup

#### 2.1 Database Migration
```bash
# Run database migrations
kubectl run migration-job \
  --image=smartwalletfx/crypto-data:latest \
  --restart=Never \
  --env="NODE_ENV=production" \
  --command -- npm run db:migrate

# Verify migration
kubectl logs migration-job
```

#### 2.2 Database Initialization
```bash
# Seed initial data
kubectl run seed-job \
  --image=smartwalletfx/crypto-data:latest \
  --restart=Never \
  --env="NODE_ENV=production" \
  --command -- npm run db:seed:prod
```

### Step 3: Application Deployment

#### 3.1 Deploy Core Application
```bash
# Deploy the main application
kubectl apply -f k8s/deployment-prod.yaml

# Verify deployment
kubectl get pods -n smartwalletfx-prod
kubectl logs -f deployment/crypto-data-api -n smartwalletfx-prod
```

#### 3.2 Deploy Services
```bash
# Deploy service definitions
kubectl apply -f k8s/service-prod.yaml

# Deploy ingress
kubectl apply -f k8s/ingress-prod.yaml
```

#### 3.3 Configure Auto-scaling
```bash
# Deploy HPA
kubectl apply -f k8s/hpa-prod.yaml

# Verify HPA
kubectl get hpa -n smartwalletfx-prod
```

### Step 4: Monitoring Setup

#### 4.1 Deploy Prometheus Monitoring
```bash
# Apply ServiceMonitor
kubectl apply -f monitoring/service-monitor.yaml

# Deploy custom alerts
kubectl apply -f monitoring/alerts.yml
```

#### 4.2 Import Grafana Dashboards
```bash
# Import the main dashboard
curl -X POST \
  http://grafana.monitoring.svc.cluster.local:3000/api/dashboards/db \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H "Content-Type: application/json" \
  -d @monitoring/crypto-data-dashboard.json
```

### Step 5: Load Balancer Configuration

#### 5.1 Configure SSL Termination
```yaml
# ingress-tls.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: crypto-data-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - api.smartwalletfx.com
    secretName: crypto-data-tls
  rules:
  - host: api.smartwalletfx.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: crypto-data-service
            port:
              number: 3000
```

#### 5.2 Configure Rate Limiting
```yaml
# Rate limiting annotations
nginx.ingress.kubernetes.io/rate-limit: "1000"
nginx.ingress.kubernetes.io/rate-limit-window: "1m"
nginx.ingress.kubernetes.io/rate-limit-status-code: "429"
```

### Step 6: Health Checks & Readiness

#### 6.1 Verify Health Endpoints
```bash
# Test health endpoint
curl -f https://api.smartwalletfx.com/health

# Test readiness
curl -f https://api.smartwalletfx.com/health/ready

# Test liveness
curl -f https://api.smartwalletfx.com/health/live
```

#### 6.2 Run Smoke Tests
```bash
# Run production smoke tests
npm run test:smoke:prod

# Run load test
npm run test:load:prod
```

## 🔧 Post-Deployment Configuration

### Cache Warming
```bash
# Warm up critical caches
curl -X POST https://api.smartwalletfx.com/admin/cache/warm \
  -H "X-API-Key: $ADMIN_API_KEY"
```

### Provider Configuration
```bash
# Test all providers
curl https://api.smartwalletfx.com/admin/providers/test \
  -H "X-API-Key: $ADMIN_API_KEY"
```

## 📊 Monitoring & Validation

### Key Metrics to Monitor

- **Response Time**: p95 < 200ms
- **Error Rate**: < 0.1%
- **Throughput**: 1000+ RPS
- **Cache Hit Rate**: > 90%
- **Cost per Request**: < $0.001

### Alert Thresholds

```yaml
Critical Alerts:
  - Response time > 1s for 5 minutes
  - Error rate > 1% for 2 minutes
  - Pod restarts > 3 in 10 minutes
  - Memory usage > 90% for 5 minutes
  - Disk usage > 85%
```

## 🔄 Rollback Procedures

### Quick Rollback
```bash
# Rollback to previous version
kubectl rollout undo deployment/crypto-data-api -n smartwalletfx-prod

# Check rollback status
kubectl rollout status deployment/crypto-data-api -n smartwalletfx-prod
```

### Database Rollback
```bash
# Rollback database migrations if needed
kubectl run rollback-job \
  --image=smartwalletfx/crypto-data:previous \
  --restart=Never \
  --command -- npm run db:rollback
```

## 🛡️ Security Checklist

- [ ] TLS 1.3 enabled
- [ ] API rate limiting configured
- [ ] Network policies applied
- [ ] RBAC permissions minimal
- [ ] Secrets encrypted
- [ ] Container images scanned
- [ ] Vulnerability assessments passed
- [ ] Audit logging enabled

## 📋 Deployment Validation

### Functional Tests
```bash
# Portfolio aggregation
curl "https://api.smartwalletfx.com/portfolio/0x742d35Cc6634C0532925a3b8D3Ac2C0000" \
  -H "X-API-Key: $API_KEY"

# DeFi positions
curl "https://api.smartwalletfx.com/defi/positions/0x742d35Cc6634C0532925a3b8D3Ac2C0000" \
  -H "X-API-Key: $API_KEY"

# Multi-chain support
curl "https://api.smartwalletfx.com/portfolio/0x742d35Cc6634C0532925a3b8D3Ac2C0000?chains=ethereum,polygon,arbitrum" \
  -H "X-API-Key: $API_KEY"
```

### Performance Tests
```bash
# Run comprehensive load tests
npm run test:load:comprehensive

# Memory leak detection
npm run test:memory:production

# Stress testing
npm run test:stress:production
```

## 🎯 Success Criteria

- [ ] All health checks passing
- [ ] Metrics within acceptable ranges
- [ ] Zero critical alerts
- [ ] Smoke tests passing
- [ ] Load tests meeting SLA
- [ ] Security scans clean
- [ ] Documentation complete

## 📞 Support & Escalation

### On-Call Contacts
- **Primary**: DevOps Team (+1-555-0123)
- **Secondary**: Backend Team (+1-555-0124)
- **Escalation**: CTO (+1-555-0125)

### Emergency Procedures
1. Check Grafana dashboards
2. Review application logs
3. Verify infrastructure status
4. Follow incident response playbook
5. Engage appropriate teams

---

**Deployment Date**: Phase 3 Release
**Version**: 3.0.0
**Status**: Production Ready ✅

*For technical support, contact: devops@smartwalletfx.com*