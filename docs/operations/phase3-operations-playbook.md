# SmartWalletFX Phase 3 Operations Playbook

> **Comprehensive operations guide for monitoring, troubleshooting, and maintaining the Phase 3 production deployment**

## 🎯 Overview

This playbook provides detailed operational procedures for the SmartWalletFX Crypto Data Service Phase 3 production environment, including monitoring dashboards, troubleshooting guides, maintenance procedures, and incident response protocols.

## 📋 Table of Contents

1. [Monitoring & Alerting](#monitoring--alerting)
2. [Performance Metrics](#performance-metrics)
3. [Troubleshooting Procedures](#troubleshooting-procedures)
4. [Maintenance Tasks](#maintenance-tasks)
5. [Incident Response](#incident-response)
6. [Capacity Planning](#capacity-planning)
7. [Security Operations](#security-operations)
8. [Cost Management](#cost-management)

## 📊 Monitoring & Alerting

### Primary Dashboards

#### 1. Service Health Dashboard
**URL**: `https://grafana.smartwalletfx.com/d/crypto-data-health`

**Key Metrics**:
- Service uptime and availability
- Pod health and restarts
- Memory and CPU utilization
- Database connections
- Redis cluster status

#### 2. Performance Dashboard
**URL**: `https://grafana.smartwalletfx.com/d/crypto-data-performance`

**Key Metrics**:
- Response time percentiles (p50, p95, p99)
- Request throughput (RPS)
- Error rates by endpoint
- Cache hit rates
- Provider latency

#### 3. Cost Optimization Dashboard
**URL**: `https://grafana.smartwalletfx.com/d/crypto-data-costs`

**Key Metrics**:
- API costs per provider
- Cost per request trends
- Budget utilization
- Request deduplication savings
- Provider rotation effectiveness

### Alert Thresholds

#### Critical Alerts (PagerDuty)
```yaml
Critical Alerts:
  - name: "Service Down"
    condition: "http_requests_total == 0 for 3 minutes"
    severity: "critical"
    
  - name: "High Error Rate"
    condition: "error_rate > 5% for 5 minutes"
    severity: "critical"
    
  - name: "Response Time Degradation"
    condition: "p95_response_time > 2000ms for 5 minutes"
    severity: "critical"
    
  - name: "Database Connection Issues"
    condition: "db_connections_active > 90% for 3 minutes"
    severity: "critical"
```

#### Warning Alerts (Slack)
```yaml
Warning Alerts:
  - name: "Memory Usage High"
    condition: "memory_usage > 85% for 10 minutes"
    severity: "warning"
    
  - name: "Cache Hit Rate Low"
    condition: "cache_hit_rate < 80% for 15 minutes"
    severity: "warning"
    
  - name: "Provider Failures"
    condition: "provider_error_rate > 10% for 10 minutes"
    severity: "warning"
```

## 📋 Performance Metrics

### SLA Targets

| Metric | Target | Measurement Period |
|--------|--------|-----------------|
| Availability | 99.9% | Monthly |
| Response Time (p95) | < 200ms | Daily |
| Error Rate | < 0.1% | Daily |
| Cache Hit Rate | > 90% | Daily |
| Cost per Request | < $0.001 | Monthly |

### Performance Baselines

```yaml
Baseline Metrics (Phase 3):
  throughput:
    normal: "1000-2000 RPS"
    peak: "5000+ RPS"
    
  response_times:
    p50: "< 50ms"
    p95: "< 200ms"
    p99: "< 500ms"
    
  resource_usage:
    cpu: "< 70%"
    memory: "< 80%"
    
  cache_performance:
    l1_hit_rate: "> 95%"
    l2_hit_rate: "> 85%"
    l3_hit_rate: "> 75%"
```

## 🔧 Troubleshooting Procedures

### High Response Time Investigation

#### Step 1: Check Service Status
```bash
# Check pod status
kubectl get pods -n smartwalletfx-prod

# Check pod logs for errors
kubectl logs -f deployment/crypto-data-api -n smartwalletfx-prod

# Check resource usage
kubectl top pods -n smartwalletfx-prod
```

#### Step 2: Database Performance
```sql
-- Check slow queries
SELECT query, mean_time, calls, total_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check connection count
SELECT count(*) FROM pg_stat_activity;

-- Check locks
SELECT * FROM pg_locks WHERE NOT granted;
```

#### Step 3: Cache Analysis
```bash
# Redis cluster info
redis-cli cluster info

# Check cache hit rates
redis-cli info stats | grep hit

# Monitor cache operations
redis-cli monitor
```

#### Step 4: Provider Health
```bash
# Test provider connectivity
curl -f "$ALCHEMY_ENDPOINT/health"
curl -f "$HELIUS_ENDPOINT/health"

# Check provider response times
curl -w "@curl-format.txt" -s "$PROVIDER_ENDPOINT/api/test"
```

### Memory Leak Investigation

#### Step 1: Memory Analysis
```bash
# Monitor memory usage over time
kubectl top pods -n smartwalletfx-prod --sort-by=memory

# Get detailed memory metrics
kubectl exec -it <pod-name> -- node --inspect-brk=0.0.0.0:9229 app.js
```

#### Step 2: Heap Dump Analysis
```bash
# Generate heap dump
kubectl exec -it <pod-name> -- kill -USR2 <node-pid>

# Download heap dump
kubectl cp <pod-name>:/app/heapdump.XXX ./heapdump.XXX

# Analyze with tools
node --inspect-brk heapdump-analyzer.js heapdump.XXX
```

### Database Connection Pool Issues

#### Symptoms
- "Connection pool exhausted" errors
- High database connection count
- Slow query performance

#### Resolution Steps
```bash
# Check current connections
kubectl exec -it <pod-name> -- \
  psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Kill long-running queries
kubectl exec -it <pod-name> -- \
  psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 minutes';"

# Restart pods if needed
kubectl rollout restart deployment/crypto-data-api -n smartwalletfx-prod
```

## 🔄 Maintenance Tasks

### Daily Maintenance

#### Morning Health Check (9:00 AM UTC)
```bash
#!/bin/bash
# daily-health-check.sh

echo "=== Daily Health Check $(date) ==="

# Check service health
curl -f https://api.smartwalletfx.com/health/detailed

# Check key metrics
echo "\n=== Key Metrics ==="
echo "Response time p95: $(prometheus-query 'histogram_quantile(0.95, http_request_duration_seconds_bucket)')"
echo "Error rate: $(prometheus-query 'rate(http_requests_total{status=~"5.*"}[5m])')"
echo "Cache hit rate: $(prometheus-query 'cache_hit_rate')"

# Check database performance
echo "\n=== Database Performance ==="
psql $DATABASE_URL -c "SELECT schemaname,tablename,n_tup_ins,n_tup_upd,n_tup_del FROM pg_stat_user_tables ORDER BY n_tup_ins DESC LIMIT 5;"

# Check cost trends
echo "\n=== Cost Analysis ==="
echo "Daily API cost: $(prometheus-query 'sum(api_cost_usd_total)')"
echo "Cost per request: $(prometheus-query 'rate(api_cost_usd_total[24h]) / rate(http_requests_total[24h])')"
```

### Weekly Maintenance

#### Performance Analysis (Sundays 2:00 AM UTC)
```bash
#!/bin/bash
# weekly-performance-analysis.sh

echo "=== Weekly Performance Report $(date) ==="

# Generate performance report
npm run performance:report:weekly

# Analyze slow queries
psql $DATABASE_URL -f scripts/analyze-slow-queries.sql

# Update cache warming patterns
npm run cache:analyze-patterns

# Cost optimization review
npm run cost:optimization-review

# Security scan
npm run security:scan
```

### Monthly Maintenance

#### Capacity Planning Review
```bash
#!/bin/bash
# monthly-capacity-review.sh

# Generate capacity report
npm run capacity:report

# Review and update auto-scaling policies
kubectl get hpa -n smartwalletfx-prod -o yaml > current-hpa.yaml

# Database maintenance
psql $DATABASE_URL -c "VACUUM ANALYZE;"
psql $DATABASE_URL -c "REINDEX DATABASE smartwalletfx;"

# Update documentation
git add docs/ && git commit -m "docs: update monthly capacity review"
```

## 🚑 Incident Response

### Incident Classification

#### Severity Levels

**Severity 1 (Critical)**
- Service completely down
- Data corruption
- Security breach
- Response: Immediate (< 15 minutes)

**Severity 2 (High)**
- Significant performance degradation
- Partial service outage
- Provider failures affecting > 50% requests
- Response: Within 1 hour

**Severity 3 (Medium)**
- Minor performance issues
- Single provider failure
- Non-critical feature unavailable
- Response: Within 4 hours

**Severity 4 (Low)**
- Cosmetic issues
- Documentation updates needed
- Feature requests
- Response: Within 24 hours

### Incident Response Procedure

#### 1. Initial Response (0-15 minutes)
```bash
# Acknowledge incident
echo "Incident acknowledged by $(whoami) at $(date)" >> incident.log

# Assess severity
curl -s https://api.smartwalletfx.com/health | jq '.status'

# Check monitoring dashboards
open https://grafana.smartwalletfx.com/d/crypto-data-health

# Notify stakeholders
slack-notify "#incidents" "Investigating incident: [brief description]"
```

#### 2. Investigation (15-60 minutes)
```bash
# Collect logs
kubectl logs --since=1h -l app=crypto-data-api > incident-logs.txt

# Check recent deployments
kubectl rollout history deployment/crypto-data-api -n smartwalletfx-prod

# Review metrics
prometheus-query 'up{job="crypto-data-api"}'

# Test external dependencies
bash scripts/test-providers.sh
```

#### 3. Resolution
```bash
# Apply fix (example: rollback)
kubectl rollout undo deployment/crypto-data-api -n smartwalletfx-prod

# Verify resolution
curl -f https://api.smartwalletfx.com/health

# Update incident status
echo "Incident resolved at $(date)" >> incident.log
slack-notify "#incidents" "Incident resolved ✅"
```

### Runbook: Database Connection Issues

#### Symptoms
- "Connection pool exhausted" errors
- High connection count alerts
- Slow database responses

#### Quick Fix
```bash
# Emergency: Kill long-running connections
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '10 minutes';"

# Scale up connection pool temporarily
kubectl patch deployment crypto-data-api -p '{"spec":{"template":{"spec":{"containers":[{"name":"app","env":[{"name":"DB_POOL_SIZE","value":"50"}]}]}}}}'
```

#### Long-term Fix
```bash
# Analyze connection patterns
psql $DATABASE_URL -f scripts/analyze-connections.sql

# Optimize queries
npm run db:optimize

# Update connection pool configuration
vim config/database.ts
```

## 📈 Capacity Planning

### Resource Scaling Triggers

#### CPU-based Scaling
```yaml
HPA Configuration:
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
  
Scaling Events:
  - CPU > 70% for 5 minutes → Scale up
  - CPU < 30% for 10 minutes → Scale down
```

#### Memory-based Scaling
```yaml
Memory Limits:
  requests: 2Gi
  limits: 4Gi
  
Alert Thresholds:
  - Memory > 85% → Warning
  - Memory > 95% → Critical
```

#### Custom Metrics Scaling
```yaml
Custom Metrics:
  - metric: "request_queue_length"
    target: 100
    
  - metric: "cache_miss_rate"
    target: 20%
    
  - metric: "provider_error_rate"
    target: 5%
```

### Cost Optimization Strategies

#### Provider Cost Management
```bash
# Daily cost analysis
npm run cost:analyze:daily

# Optimize provider routing
npm run cost:optimize:routing

# Update rate limits based on cost
npm run cost:update:limits
```

## 🔒 Security Operations

### Security Monitoring

#### API Key Management
```bash
# Monitor API key usage
prometheus-query 'rate(api_requests_total[1h]) by (api_key_id)'

# Check for suspicious patterns
grep "rate_limit_exceeded" /var/log/crypto-data/*.log | tail -100

# Rotate compromised keys
kubectl patch secret api-keys -p '{"data":{"COMPROMISED_KEY":null}}'
```

#### Security Scanning
```bash
# Container vulnerability scan
trivy image smartwalletfx/crypto-data:latest

# Dependency audit
npm audit --audit-level=high

# Network policy validation
kubectl auth can-i --list --as=system:serviceaccount:smartwalletfx-prod:crypto-data-api
```

### Incident Response: Security Breach

#### Immediate Actions (0-15 minutes)
```bash
# Isolate affected components
kubectl patch deployment crypto-data-api -p '{"spec":{"replicas":0}}'

# Block suspicious IPs
kubectl apply -f emergency-network-policy.yaml

# Notify security team
slack-notify "#security-incidents" "SECURITY INCIDENT: [description]"
```

#### Investigation (15-60 minutes)
```bash
# Collect security logs
kubectl logs --since=24h -l app=crypto-data-api | grep -i "attack\|breach\|unauthorized"

# Analyze access patterns
psql $DATABASE_URL -f scripts/security-audit.sql

# Check API key compromises
grep "UNAUTHORIZED" /var/log/crypto-data/api.log
```

## 💰 Cost Management

### Cost Monitoring

#### Daily Cost Tracking
```bash
# Check daily API costs
prometheus-query 'sum(rate(api_cost_usd_total[24h]))'

# Provider cost breakdown
prometheus-query 'sum by (provider) (rate(api_cost_usd_total[24h]))'

# Cost per endpoint
prometheus-query 'sum by (endpoint) (rate(api_cost_usd_total[24h])) / sum by (endpoint) (rate(http_requests_total[24h]))'
```

#### Budget Alerts
```yaml
Budget Alerts:
  - name: "Daily Budget 80%"
    condition: "daily_cost > daily_budget * 0.8"
    action: "Enable aggressive caching"
    
  - name: "Monthly Budget 90%"
    condition: "monthly_cost > monthly_budget * 0.9"
    action: "Reduce provider calls"
    
  - name: "Budget Exceeded"
    condition: "monthly_cost > monthly_budget"
    action: "Emergency cost reduction"
```

### Cost Optimization Actions

#### Emergency Cost Reduction
```bash
# Enable maximum caching
kubectl patch configmap crypto-data-config -p '{"data":{"CACHE_TTL":"3600"}}'

# Reduce provider call frequency
kubectl patch configmap crypto-data-config -p '{"data":{"PROVIDER_BATCH_SIZE":"100"}}'

# Enable request deduplication
kubectl patch configmap crypto-data-config -p '{"data":{"ENABLE_DEDUPLICATION":"true"}}'
```

## 📞 On-Call Procedures

### Escalation Matrix

| Time | Contact | Method |
|------|---------|--------|
| 0-15 min | Primary On-Call | PagerDuty + Phone |
| 15-30 min | Secondary On-Call | PagerDuty + Phone |
| 30-60 min | Team Lead | Phone + Slack |
| 60+ min | Engineering Manager | Phone + Slack |
| 120+ min | CTO | Phone |

### On-Call Toolkit

#### Essential Commands
```bash
# Quick health check
alias health-check="curl -s https://api.smartwalletfx.com/health | jq"

# Pod status
alias pod-status="kubectl get pods -n smartwalletfx-prod"

# Recent logs
alias recent-logs="kubectl logs --since=10m -l app=crypto-data-api"

# Emergency rollback
alias emergency-rollback="kubectl rollout undo deployment/crypto-data-api -n smartwalletfx-prod"
```

#### Emergency Contacts
```yaml
Contacts:
  Primary On-Call: "+1-555-0123"
  Secondary On-Call: "+1-555-0124"
  Team Lead: "+1-555-0125"
  Database Expert: "+1-555-0126"
  Security Lead: "+1-555-0127"
  
Escalation Slack:
  Channel: "#crypto-data-incidents"
  Mention: "@on-call-team"
```

---

**Last Updated**: Phase 3 Release
**Version**: 3.0.0
**Maintained By**: DevOps Team

*For emergency support: +1-555-0123 or #crypto-data-incidents*