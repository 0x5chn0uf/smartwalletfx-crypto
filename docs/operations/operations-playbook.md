# Operations Playbook

> Complete operational guide for managing SmartWalletFX Crypto Data Service in production

## 🎯 Overview

This playbook provides comprehensive procedures for monitoring, troubleshooting, maintenance, and incident response for the SmartWalletFX Crypto Data Service. It serves as the definitive operational reference for DevOps and SRE teams.

## 📊 Monitoring and Alerting

### Core Metrics Dashboard

Access the primary monitoring dashboard at: `https://monitoring.smartwalletfx.com/grafana/d/crypto-service`

#### Key Performance Indicators (KPIs)

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| **Availability** | 99.95% | <99.9% | <99.5% |
| **Response Time (P95)** | <200ms | >500ms | >1000ms |
| **Error Rate** | <0.1% | >0.5% | >1% |
| **Memory Usage** | <80% | >85% | >95% |
| **CPU Usage** | <70% | >80% | >90% |
| **Database Connections** | <80% of pool | >90% | >95% |
| **Cache Hit Rate** | >85% | <80% | <70% |
| **Monthly API Cost** | <$800 | >$850 | >$900 |

### Alert Channels

```yaml
# Alerting configuration
channels:
  critical:
    - slack: "#crypto-service-critical"
    - pagerduty: "crypto-service-oncall"
    - email: "oncall@smartwalletfx.com"
    - sms: "+1-555-ONCALL"
  
  warning:
    - slack: "#crypto-service-alerts"
    - email: "devops@smartwalletfx.com"
  
  info:
    - slack: "#crypto-service-info"
```

### Monitoring Checklist

#### Daily Monitoring (Automated)
- [ ] Service health status (every 5 minutes)
- [ ] Response time trends (every 15 minutes)
- [ ] Error rate monitoring (every 5 minutes)
- [ ] Resource utilization (every 5 minutes)
- [ ] Cost tracking and budget alerts (hourly)

#### Weekly Monitoring (Manual)
- [ ] Review Grafana dashboards for trends
- [ ] Analyze cost optimization opportunities
- [ ] Check for security vulnerabilities
- [ ] Review log analysis reports
- [ ] Validate backup integrity

#### Monthly Monitoring (Strategic)
- [ ] Performance benchmark analysis
- [ ] Capacity planning review
- [ ] Cost optimization assessment
- [ ] Security audit and compliance check
- [ ] Disaster recovery testing

## 🚨 Incident Response Procedures

### Severity Levels

#### SEV-1 (Critical)
- **Definition**: Complete service outage or severe degradation affecting >50% of users
- **Response Time**: 5 minutes
- **Escalation**: Immediate PagerDuty alert to on-call engineer
- **Communication**: Status page update within 15 minutes

#### SEV-2 (High)
- **Definition**: Significant functionality degradation affecting 10-50% of users
- **Response Time**: 15 minutes
- **Escalation**: Slack notification to dev team
- **Communication**: Internal notification, status page if user-facing

#### SEV-3 (Medium)
- **Definition**: Minor issues with workarounds available
- **Response Time**: 1 hour
- **Escalation**: Standard ticket queue
- **Communication**: Internal team notification

#### SEV-4 (Low)
- **Definition**: Cosmetic issues, enhancement requests
- **Response Time**: Next business day
- **Escalation**: Standard ticket queue
- **Communication**: Internal tracking only

### Incident Response Workflow

#### Phase 1: Detection and Initial Response (0-5 minutes)
```bash
# 1. Acknowledge the alert
curl -X POST "https://api.pagerduty.com/incidents/{id}/acknowledge" \
  -H "Authorization: Token token=YOUR_TOKEN"

# 2. Join incident channel
/slack join #incident-crypto-service-$(date +%Y%m%d-%H%M)

# 3. Quick health check
kubectl get pods -n crypto-data -o wide
curl -s https://api.smartwalletfx.com/health | jq '.'

# 4. Check recent deployments
kubectl rollout history deployment crypto-service -n crypto-data
```

#### Phase 2: Assessment and Triage (5-15 minutes)
```bash
# 1. Check monitoring dashboards
echo "Review: https://monitoring.smartwalletfx.com/grafana/d/crypto-service"

# 2. Examine logs for errors
kubectl logs -n crypto-data deployment/crypto-service --since=10m | grep -i error

# 3. Check external dependencies
kubectl get pods -n crypto-data | grep -E "(postgres|redis)"
curl -s https://api.alchemy.com/health

# 4. Assess user impact
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.performance'
```

#### Phase 3: Immediate Mitigation (15-30 minutes)
```bash
# Option A: Scale resources
kubectl scale deployment crypto-service --replicas=6 -n crypto-data

# Option B: Emergency rollback (if recent deployment)
kubectl rollout undo deployment crypto-service -n crypto-data

# Option C: Restart service (last resort)
kubectl rollout restart deployment crypto-service -n crypto-data

# Option D: Circuit breaker activation
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"CIRCUIT_BREAKER_ENABLED":"true"}}'
```

#### Phase 4: Root Cause Analysis (30+ minutes)
```bash
# 1. Deep log analysis
kubectl logs -n crypto-data deployment/crypto-service --previous --since=1h > incident-logs.txt

# 2. Performance profiling
kubectl exec -n crypto-data deployment/crypto-service -- \
  node --prof --prof-process profile.txt

# 3. Database analysis
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT query, calls, total_time, mean_time 
  FROM pg_stat_statements 
  ORDER BY total_time DESC LIMIT 10;"

# 4. External API analysis
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.costs'
```

### Common Incident Scenarios

#### High Response Time
**Symptoms**: P95 response time >1000ms
**Likely Causes**: Database slowness, external API latency, memory pressure
**Initial Actions**:
```bash
# 1. Check database performance
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"

# 2. Check external API latency
kubectl logs -n crypto-data deployment/crypto-service | grep "provider.*duration" | tail -20

# 3. Scale horizontally
kubectl scale deployment crypto-service --replicas=6 -n crypto-data

# 4. Enable request throttling
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"RATE_LIMIT_MAX":"500"}}'
```

#### High Error Rate
**Symptoms**: Error rate >1%
**Likely Causes**: External API failures, database connection exhaustion, authentication issues
**Initial Actions**:
```bash
# 1. Identify error patterns
kubectl logs -n crypto-data deployment/crypto-service | grep -i error | tail -50

# 2. Check external API status
curl -s https://api.alchemy.com/health
curl -s https://api.moralis.com/health

# 3. Validate database connections
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Enable circuit breaker for failing providers
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"CIRCUIT_BREAKER_ENABLED":"true","PROVIDER_FAILOVER":"true"}}'
```

#### Memory Issues
**Symptoms**: Memory usage >95%, OOMKilled pods
**Likely Causes**: Memory leaks, large dataset processing, insufficient limits
**Initial Actions**:
```bash
# 1. Increase memory limits
kubectl patch deployment crypto-service -n crypto-data \
  --patch '{"spec":{"template":{"spec":{"containers":[{"name":"crypto-service","resources":{"limits":{"memory":"8Gi"}}}]}}}}'

# 2. Restart affected pods
kubectl delete pods -n crypto-data -l app=crypto-service

# 3. Enable memory profiling
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"NODE_OPTIONS":"--max-old-space-size=6144 --inspect"}}'

# 4. Clear cache to free memory
kubectl exec -n crypto-data redis-0 -- redis-cli FLUSHDB
```

#### Database Issues
**Symptoms**: Connection timeouts, slow queries, high CPU on database
**Likely Causes**: Connection pool exhaustion, missing indexes, lock contention
**Initial Actions**:
```bash
# 1. Check active connections
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# 2. Identify slow queries
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT query, total_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 5;"

# 3. Check for locks
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT * FROM pg_locks WHERE NOT granted;"

# 4. Emergency read replica promotion (if available)
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"DATABASE_READ_REPLICA_ENABLED":"true"}}'
```

## 🔧 Maintenance Procedures

### Routine Maintenance

#### Daily Tasks (Automated)
```bash
#!/bin/bash
# scripts/daily-maintenance.sh

echo "🌅 Starting daily maintenance tasks..."

# 1. Log rotation
kubectl exec -n crypto-data deployment/crypto-service -- \
  find /app/logs -name "*.log" -type f -mtime +7 -exec gzip {} \;

# 2. Metrics cleanup
kubectl exec -n monitoring prometheus-0 -- \
  find /prometheus/data -name "*.tmp" -mtime +1 -delete

# 3. Cache optimization
kubectl exec -n crypto-data redis-0 -- redis-cli MEMORY PURGE

# 4. Health check validation
curl -f https://api.smartwalletfx.com/health || echo "❌ Health check failed"

echo "✅ Daily maintenance completed"
```

#### Weekly Tasks (Semi-automated)
```bash
#!/bin/bash
# scripts/weekly-maintenance.sh

echo "📅 Starting weekly maintenance tasks..."

# 1. Database maintenance
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "VACUUM ANALYZE; REINDEX DATABASE crypto_data;"

# 2. Performance analysis
kubectl exec -n crypto-data deployment/crypto-service -- \
  npm run benchmark > weekly-benchmark-$(date +%Y%m%d).txt

# 3. Security scan
kubectl exec -n crypto-data deployment/crypto-service -- \
  npm audit --audit-level=high

# 4. Log analysis
kubectl logs -n crypto-data deployment/crypto-service --since=168h | \
  grep -i error | sort | uniq -c | sort -nr > weekly-error-summary.txt

# 5. Cost analysis
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.costs' > weekly-cost-report.json

echo "✅ Weekly maintenance completed"
```

#### Monthly Tasks (Manual)
```bash
#!/bin/bash
# scripts/monthly-maintenance.sh

echo "📊 Starting monthly maintenance tasks..."

# 1. Capacity planning analysis
kubectl top nodes
kubectl top pods -n crypto-data

# 2. Security update check
kubectl get pods -n crypto-data -o jsonpath='{.items[*].spec.containers[*].image}' | \
  xargs -n1 echo | sort | uniq

# 3. Backup verification
aws s3 ls s3://smartwalletfx-backups/database/ | tail -5
aws s3 cp s3://smartwalletfx-backups/database/latest.sql.gz test-restore.sql.gz

# 4. Disaster recovery test
echo "⚠️  Schedule DR test for next maintenance window"

# 5. Performance baseline update
kubectl exec -n crypto-data deployment/crypto-service -- \
  npm run load-test > monthly-performance-baseline-$(date +%Y%m).txt

echo "✅ Monthly maintenance completed"
```

### Emergency Maintenance

#### Service Restart
```bash
#!/bin/bash
# Emergency service restart procedure

echo "🚨 Emergency restart initiated"

# 1. Pre-restart health check
kubectl get pods -n crypto-data
curl -s https://api.smartwalletfx.com/health

# 2. Gradual restart (rolling update)
kubectl rollout restart deployment crypto-service -n crypto-data

# 3. Monitor restart progress
kubectl rollout status deployment crypto-service -n crypto-data --timeout=300s

# 4. Post-restart validation
sleep 30
kubectl get pods -n crypto-data
curl -s https://api.smartwalletfx.com/health

echo "✅ Emergency restart completed"
```

#### Database Emergency Procedures
```bash
#!/bin/bash
# Database emergency procedures

echo "🗄️ Database emergency procedures"

# 1. Connection limit increase
kubectl exec -n crypto-data postgres-0 -- \
  psql -U postgres -c "ALTER SYSTEM SET max_connections = 300;"

# 2. Kill long-running queries
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT pg_terminate_backend(pid) 
  FROM pg_stat_activity 
  WHERE state = 'active' AND query_start < now() - interval '5 minutes';"

# 3. Emergency vacuum
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "VACUUM FULL;"

# 4. Restart database (last resort)
kubectl delete pod postgres-0 -n crypto-data

echo "✅ Database emergency procedures completed"
```

## 📈 Performance Monitoring

### Performance Baselines

| Operation | Baseline | Target | Alert Threshold |
|-----------|----------|--------|-----------------|
| Portfolio Retrieval | 150ms | <200ms | >500ms |
| DeFi Position Fetch | 300ms | <400ms | >800ms |
| NFT Collection Load | 250ms | <300ms | >600ms |
| Health Check | 5ms | <10ms | >50ms |
| Database Query (avg) | 20ms | <50ms | >100ms |
| Cache Access | 2ms | <5ms | >20ms |

### Performance Analysis Tools

#### Load Testing
```bash
# Standard load test
npm run load-test

# Stress test
npm run load-test:stress

# Memory leak test
npm run load-test:memory

# Spike test
npm run load-test:spike
```

#### Performance Profiling
```bash
# CPU profiling
kubectl exec -n crypto-data deployment/crypto-service -- \
  node --prof --prof-process /app/profile.txt

# Memory profiling
kubectl exec -n crypto-data deployment/crypto-service -- \
  node --inspect --max-old-space-size=4096 /app/dist/index.js

# Heap snapshot analysis
kubectl exec -n crypto-data deployment/crypto-service -- \
  node -e "require('v8').writeHeapSnapshot('./heap-$(date +%s).heapsnapshot')"
```

### Cost Monitoring

#### Cost Tracking Dashboard
```bash
# Real-time cost monitoring
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.costs'

# Daily cost breakdown
kubectl logs -n crypto-data deployment/crypto-service | \
  grep "provider.*cost" | \
  awk '{print $1, $5, $8}' | \
  sort | uniq -c

# Monthly cost projection
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | \
  jq '.data.costs.monthlyProjection'
```

#### Cost Optimization Actions
```bash
# Enable intelligent caching
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"INTELLIGENT_CACHE_ENABLED":"true"}}'

# Activate provider rotation
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"PROVIDER_ROTATION_ENABLED":"true"}}'

# Enable request deduplication
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"REQUEST_DEDUPLICATION":"true"}}'
```

## 🔍 Troubleshooting Guide

### Log Analysis

#### Error Pattern Analysis
```bash
# Most common errors
kubectl logs -n crypto-data deployment/crypto-service --since=24h | \
  grep -i error | \
  awk '{print $5}' | \
  sort | uniq -c | sort -nr | head -10

# Provider-specific errors
kubectl logs -n crypto-data deployment/crypto-service --since=24h | \
  grep "provider.*error" | \
  jq -r '.provider + ": " + .error' | \
  sort | uniq -c | sort -nr

# Performance bottlenecks
kubectl logs -n crypto-data deployment/crypto-service --since=24h | \
  grep "duration" | \
  awk '{if($8>1000) print}' | \
  head -20
```

#### Debug Mode Activation
```bash
# Enable debug logging
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"LOG_LEVEL":"debug","DEBUG_MODE":"true"}}'

# Restart to apply changes
kubectl rollout restart deployment crypto-service -n crypto-data

# Monitor debug output
kubectl logs -n crypto-data deployment/crypto-service -f | grep DEBUG
```

### Network Troubleshooting

#### Connectivity Tests
```bash
# Test external APIs
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -v https://api.alchemy.com/v2/health

# Test database connectivity
kubectl exec -n crypto-data deployment/crypto-service -- \
  pg_isready -h postgres -p 5432 -U crypto_user

# Test Redis connectivity
kubectl exec -n crypto-data deployment/crypto-service -- \
  redis-cli -h redis ping

# Test internal service mesh
kubectl exec -n crypto-data deployment/crypto-service -- \
  nslookup crypto-service.crypto-data.svc.cluster.local
```

#### DNS Resolution
```bash
# Check DNS resolution
kubectl exec -n crypto-data deployment/crypto-service -- \
  nslookup api.alchemy.com

# Flush DNS cache
kubectl exec -n crypto-data deployment/crypto-service -- \
  systemctl flush-dns || echo "DNS flush not available"
```

### Resource Troubleshooting

#### Memory Analysis
```bash
# Memory usage by process
kubectl exec -n crypto-data deployment/crypto-service -- \
  ps aux --sort=-%mem | head -10

# Heap usage analysis
kubectl exec -n crypto-data deployment/crypto-service -- \
  node -e "console.log(process.memoryUsage())"

# Garbage collection analysis
kubectl logs -n crypto-data deployment/crypto-service | \
  grep "gc" | tail -20
```

#### CPU Analysis
```bash
# CPU usage by process
kubectl exec -n crypto-data deployment/crypto-service -- \
  ps aux --sort=-%cpu | head -10

# Load average
kubectl exec -n crypto-data deployment/crypto-service -- \
  uptime

# CPU profiling snapshot
kubectl exec -n crypto-data deployment/crypto-service -- \
  node --prof-process --preprocess -j profile.txt > cpu-profile.json
```

### Database Troubleshooting

#### Connection Issues
```bash
# Active connections
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT count(*), state, client_addr 
  FROM pg_stat_activity 
  GROUP BY state, client_addr;"

# Connection pool status
kubectl logs -n crypto-data deployment/crypto-service | \
  grep "pool" | tail -10

# Reset connection pool
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -X POST http://localhost:3000/api/admin/pool/reset
```

#### Query Performance
```bash
# Slow query analysis
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT query, calls, total_time, mean_time, rows
  FROM pg_stat_statements 
  WHERE mean_time > 100
  ORDER BY total_time DESC 
  LIMIT 10;"

# Lock analysis
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT pid, mode, locktype, relation::regclass
  FROM pg_locks 
  WHERE NOT granted;"

# Index usage analysis
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
  FROM pg_stat_user_indexes 
  ORDER BY idx_tup_read DESC;"
```

### Cache Troubleshooting

#### Redis Analysis
```bash
# Redis memory usage
kubectl exec -n crypto-data redis-0 -- \
  redis-cli info memory

# Cache hit rate
kubectl exec -n crypto-data redis-0 -- \
  redis-cli info stats | grep -E "keyspace_hits|keyspace_misses"

# Key distribution
kubectl exec -n crypto-data redis-0 -- \
  redis-cli --scan --pattern "*" | head -20

# Clear problematic keys
kubectl exec -n crypto-data redis-0 -- \
  redis-cli del $(redis-cli --scan --pattern "problematic:*")
```

## 📋 Runbooks

### Daily Operations Checklist

#### Morning Checks (9:00 AM)
- [ ] Review overnight alerts and incidents
- [ ] Check service availability dashboard
- [ ] Validate backup completion status
- [ ] Review cost utilization trends
- [ ] Check for security alerts

#### Afternoon Checks (2:00 PM)
- [ ] Monitor peak traffic performance
- [ ] Review error rate trends
- [ ] Check external API status
- [ ] Validate cache performance

#### Evening Checks (6:00 PM)
- [ ] Review daily performance metrics
- [ ] Check resource utilization trends
- [ ] Prepare for overnight processing
- [ ] Update on-call documentation

### Weekly Operations Checklist

#### Monday: Performance Review
- [ ] Analyze weekend traffic patterns
- [ ] Review performance baselines
- [ ] Check for performance regressions
- [ ] Update capacity planning models

#### Wednesday: Security and Compliance
- [ ] Review security alerts
- [ ] Check for software updates
- [ ] Validate backup integrity
- [ ] Review access logs

#### Friday: Maintenance and Planning
- [ ] Execute weekly maintenance tasks
- [ ] Review upcoming changes
- [ ] Update documentation
- [ ] Plan weekend maintenance windows

### Monthly Operations Checklist

#### First Week: Strategic Review
- [ ] Monthly performance analysis
- [ ] Cost optimization review
- [ ] Capacity planning update
- [ ] Service level objective review

#### Second Week: Security Audit
- [ ] Comprehensive security scan
- [ ] Access review and cleanup
- [ ] Compliance validation
- [ ] Incident response plan review

#### Third Week: Disaster Recovery
- [ ] DR plan testing
- [ ] Backup restoration test
- [ ] Failover procedure validation
- [ ] Recovery time objective validation

#### Fourth Week: Documentation and Training
- [ ] Update operational documentation
- [ ] Review and update runbooks
- [ ] Team training sessions
- [ ] Knowledge sharing sessions

---

This operations playbook provides comprehensive guidance for managing the SmartWalletFX Crypto Data Service in production. Regular reviews and updates ensure continued operational excellence and incident prevention.