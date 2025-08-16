# Monitoring and Alerting Runbooks

> Operational runbooks for monitoring, alerting, and incident response procedures

## 🎯 Overview

This document provides step-by-step runbooks for managing monitoring alerts, interpreting metrics, and responding to various operational scenarios for the SmartWalletFX Crypto Data Service.

## 📊 Alert Categories and Response Procedures

### 🔴 Critical Alerts (SEV-1)

#### Service Down
**Alert**: `CryptoServiceDown`
**Condition**: Service unreachable or health check failing for >1 minute
**Impact**: Complete service outage

**Immediate Response (0-5 minutes):**
```bash
# 1. Verify alert is accurate
curl -f https://api.smartwalletfx.com/health
kubectl get pods -n crypto-data -o wide

# 2. Check service status
kubectl describe deployment crypto-service -n crypto-data
kubectl logs -n crypto-data deployment/crypto-service --tail=50

# 3. Immediate actions
# If pods are failing, check for resource issues
kubectl top pods -n crypto-data
kubectl describe nodes

# If memory/CPU issues, scale immediately
kubectl scale deployment crypto-service --replicas=6 -n crypto-data

# If configuration issue, rollback to last known good
kubectl rollout undo deployment crypto-service -n crypto-data
```

**Escalation (5-15 minutes):**
```bash
# 1. Create incident in PagerDuty
curl -X POST https://api.pagerduty.com/incidents \
  -H "Authorization: Token token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "incident": {
      "type": "incident",
      "title": "Crypto Service Down - Complete Outage",
      "service": {
        "id": "CRYPTO_SERVICE_ID",
        "type": "service_reference"
      },
      "urgency": "high"
    }
  }'

# 2. Join incident channel
/slack join #incident-crypto-service-$(date +%Y%m%d-%H%M)

# 3. Status page update
curl -X POST https://api.statuspage.io/v1/pages/PAGE_ID/incidents \
  -H "Authorization: OAuth YOUR_TOKEN" \
  -d "incident[name]=Crypto Data Service Experiencing Issues" \
  -d "incident[status]=investigating"
```

#### High Error Rate
**Alert**: `HighErrorRate`
**Condition**: >5% error rate for >5 minutes
**Impact**: Significant user impact

**Investigation Steps:**
```bash
# 1. Identify error patterns
kubectl logs -n crypto-data deployment/crypto-service --since=10m | \
  grep -E "(ERROR|error)" | \
  awk '{print $1, $2, $3}' | sort | uniq -c | sort -nr

# 2. Check external API status
curl -I https://eth-mainnet.alchemyapi.io/v2/health
curl -I https://api.moralis.com/health

# 3. Database health check
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Check for rate limiting
kubectl logs -n crypto-data deployment/crypto-service --since=10m | \
  grep -i "rate.limit\|429\|quota"
```

**Mitigation Actions:**
```bash
# 1. Enable circuit breaker
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"CIRCUIT_BREAKER_ENABLED":"true"}}'

# 2. Switch to backup providers
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"PRIMARY_PROVIDER":"moralis","FAILOVER_ENABLED":"true"}}'

# 3. Restart service if needed
kubectl rollout restart deployment crypto-service -n crypto-data

# 4. Scale up if traffic spike
kubectl scale deployment crypto-service --replicas=8 -n crypto-data
```

#### Database Connection Issues
**Alert**: `DatabaseConnectionFailure`
**Condition**: Unable to connect to database for >30 seconds
**Impact**: Data operations failing

**Response Procedure:**
```bash
# 1. Check database pod status
kubectl get pods -n crypto-data | grep postgres
kubectl describe pod postgres-0 -n crypto-data

# 2. Check database logs
kubectl logs -n crypto-data postgres-0 --tail=100

# 3. Test connectivity from app
kubectl exec -n crypto-data deployment/crypto-service -- \
  pg_isready -h postgres -p 5432 -U crypto_user

# 4. Check connection pool
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/admin/db/pool-status

# 5. Emergency actions
# Restart database if needed (last resort)
kubectl delete pod postgres-0 -n crypto-data

# Enable read-only mode
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"READ_ONLY_MODE":"true"}}'
```

### 🟡 Warning Alerts (SEV-2)

#### High Response Time
**Alert**: `HighResponseTime`
**Condition**: P95 response time >500ms for >5 minutes
**Impact**: Performance degradation

**Investigation:**
```bash
# 1. Check current performance
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.performance'

# 2. Identify slow endpoints
kubectl logs -n crypto-data deployment/crypto-service --since=10m | \
  grep "duration" | \
  awk '{if($8>1000) print $4, $8}' | \
  sort | uniq -c | sort -nr

# 3. Database query analysis
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT query, calls, total_time, mean_time 
  FROM pg_stat_statements 
  WHERE mean_time > 100
  ORDER BY total_time DESC LIMIT 10;"

# 4. Cache performance check
kubectl exec -n crypto-data redis-0 -- \
  redis-cli info stats | grep -E "keyspace_hits|keyspace_misses"
```

**Optimization Actions:**
```bash
# 1. Enable aggressive caching
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"CACHE_TTL":"600","INTELLIGENT_CACHE":"true"}}'

# 2. Scale horizontally
kubectl scale deployment crypto-service --replicas=5 -n crypto-data

# 3. Clear cache if stale
kubectl exec -n crypto-data redis-0 -- redis-cli FLUSHDB

# 4. Enable request batching
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"BATCH_REQUESTS":"true","BATCH_SIZE":"50"}}'
```

#### High Memory Usage
**Alert**: `HighMemoryUsage`
**Condition**: Memory usage >85% for >10 minutes
**Impact**: Risk of OOM kills

**Response Steps:**
```bash
# 1. Check memory consumption
kubectl top pods -n crypto-data
kubectl exec -n crypto-data deployment/crypto-service -- \
  ps aux --sort=-%mem | head -10

# 2. Analyze heap usage
kubectl exec -n crypto-data deployment/crypto-service -- \
  node -e "console.log(JSON.stringify(process.memoryUsage(), null, 2))"

# 3. Force garbage collection
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -X POST http://localhost:3000/api/admin/gc

# 4. Scale up memory limits
kubectl patch deployment crypto-service -n crypto-data \
  --patch '{"spec":{"template":{"spec":{"containers":[{"name":"crypto-service","resources":{"limits":{"memory":"6Gi"}}}]}}}}'
```

#### High Cost Utilization
**Alert**: `HighCostUtilization`
**Condition**: Monthly budget utilization >85%
**Impact**: Cost overrun risk

**Cost Control Actions:**
```bash
# 1. Check current cost breakdown
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | jq '.data.costs'

# 2. Enable cost optimization
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"COST_OPTIMIZATION":"aggressive","PROVIDER_ROTATION":"true"}}'

# 3. Reduce request frequency
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"RATE_LIMIT_MAX":"500","CACHE_TTL":"900"}}'

# 4. Switch to cheaper providers
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"PRIMARY_PROVIDER":"quicknode","SECONDARY_PROVIDER":"moralis"}}'
```

### 🟢 Info Alerts (SEV-3)

#### Cache Miss Rate High
**Alert**: `LowCacheHitRate`
**Condition**: Cache hit rate <80% for >15 minutes
**Impact**: Increased latency and costs

**Optimization Steps:**
```bash
# 1. Analyze cache patterns
kubectl exec -n crypto-data redis-0 -- \
  redis-cli --scan --pattern "*" | head -20

# 2. Check cache size and memory
kubectl exec -n crypto-data redis-0 -- \
  redis-cli info memory

# 3. Warm popular caches
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -X POST http://localhost:3000/api/admin/cache/warm

# 4. Adjust cache TTL
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"CACHE_TTL":"1800","PREDICTIVE_CACHE":"true"}}'
```

## 📈 Metrics Interpretation Guide

### Application Metrics

#### HTTP Request Metrics
```promql
# Request rate per second
rate(crypto_data_http_requests_total[5m])

# Response time percentiles
histogram_quantile(0.95, rate(crypto_data_http_request_duration_seconds_bucket[5m]))

# Error rate
rate(crypto_data_http_requests_total{status_code=~"5.."}[5m]) / rate(crypto_data_http_requests_total[5m])
```

**Interpretation:**
- **Request Rate**: Normal: 10-50 rps, High: >100 rps, Critical: >200 rps
- **P95 Response Time**: Good: <200ms, Warning: >500ms, Critical: >1000ms
- **Error Rate**: Good: <0.1%, Warning: >0.5%, Critical: >1%

#### Database Metrics
```promql
# Query duration
histogram_quantile(0.95, rate(crypto_data_db_query_duration_seconds_bucket[5m]))

# Connection pool utilization
crypto_data_db_pool_active_connections / crypto_data_db_pool_max_connections

# Slow query count
rate(crypto_data_db_slow_queries_total[5m])
```

**Interpretation:**
- **Query Duration**: Good: <50ms, Warning: >100ms, Critical: >500ms
- **Pool Utilization**: Good: <70%, Warning: >80%, Critical: >90%
- **Slow Queries**: Good: 0, Warning: >5/min, Critical: >20/min

#### External API Metrics
```promql
# Provider response time
histogram_quantile(0.95, rate(crypto_data_provider_request_duration_seconds_bucket[5m]))

# Provider error rate
rate(crypto_data_provider_errors_total[5m]) / rate(crypto_data_provider_requests_total[5m])

# Cost accumulation
rate(crypto_data_provider_cost_usd_total[1h]) * 24
```

**Interpretation:**
- **Provider Response**: Good: <1s, Warning: >3s, Critical: >10s
- **Provider Error Rate**: Good: <1%, Warning: >5%, Critical: >10%
- **Daily Cost**: Budget-dependent, typically <$30/day

### Infrastructure Metrics

#### CPU and Memory
```promql
# CPU utilization
rate(process_cpu_seconds_total[5m]) * 100

# Memory utilization
process_resident_memory_bytes / process_virtual_memory_max_bytes * 100

# Heap usage
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes * 100
```

**Threshold Guidance:**
- **CPU**: Good: <60%, Warning: >75%, Critical: >90%
- **Memory**: Good: <70%, Warning: >85%, Critical: >95%
- **Heap**: Good: <80%, Warning: >90%, Critical: >95%

## 🔄 Routine Monitoring Tasks

### Daily Monitoring Checklist

#### Morning Checks (9:00 AM)
```bash
#!/bin/bash
# Daily morning monitoring routine

echo "🌅 Daily Morning Monitoring Check"
echo "==============================="

# 1. Service health overview
echo "1. Service Health:"
curl -s https://api.smartwalletfx.com/health | jq '.'

# 2. Overnight error summary
echo -e "\n2. Overnight Errors:"
kubectl logs -n crypto-data deployment/crypto-service --since=12h | \
  grep -i error | wc -l | xargs echo "Error count:"

# 3. Performance summary
echo -e "\n3. Performance Summary:"
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | \
  jq '.data.performance'

# 4. Cost tracking
echo -e "\n4. Cost Summary:"
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/stats | \
  jq '.data.costs'

# 5. Database health
echo -e "\n5. Database Health:"
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active';"

echo -e "\n✅ Morning check completed"
```

#### Evening Review (6:00 PM)
```bash
#!/bin/bash
# Daily evening monitoring review

echo "🌇 Daily Evening Monitoring Review"
echo "================================="

# 1. Peak hour performance analysis
echo "1. Peak Hour Analysis:"
kubectl logs -n crypto-data deployment/crypto-service --since=8h | \
  grep "duration" | \
  awk '{sum+=$8; count++} END {print "Average response time:", sum/count "ms"}'

# 2. Error analysis
echo -e "\n2. Error Analysis:"
kubectl logs -n crypto-data deployment/crypto-service --since=8h | \
  grep -i error | \
  awk '{print $5}' | sort | uniq -c | sort -nr | head -5

# 3. Resource utilization trend
echo -e "\n3. Resource Utilization:"
kubectl top pods -n crypto-data

# 4. Cache performance
echo -e "\n4. Cache Performance:"
kubectl exec -n crypto-data redis-0 -- \
  redis-cli info stats | grep -E "keyspace_hits|keyspace_misses"

# 5. External API performance
echo -e "\n5. External API Summary:"
kubectl logs -n crypto-data deployment/crypto-service --since=8h | \
  grep "provider.*duration" | \
  awk '{print $6, $8}' | sort | uniq -c | sort -nr

echo -e "\n✅ Evening review completed"
```

### Weekly Monitoring Tasks

#### Performance Trend Analysis
```bash
#!/bin/bash
# Weekly performance trend analysis

echo "📊 Weekly Performance Analysis"
echo "============================="

# 1. Response time trends
echo "1. Response Time Trends (7 days):"
kubectl exec -n monitoring prometheus-0 -- \
  promtool query instant \
  'avg_over_time(histogram_quantile(0.95, rate(crypto_data_http_request_duration_seconds_bucket[5m]))[7d:1h])'

# 2. Error rate trends
echo -e "\n2. Error Rate Trends:"
kubectl exec -n monitoring prometheus-0 -- \
  promtool query instant \
  'avg_over_time(rate(crypto_data_http_requests_total{status_code=~"5.."}[5m])[7d:1h])'

# 3. Cost efficiency analysis
echo -e "\n3. Weekly Cost Analysis:"
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -s http://localhost:3000/api/metrics/cost?period=7d

# 4. Database performance trends
echo -e "\n4. Database Performance:"
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT schemaname, tablename, n_tup_ins + n_tup_upd + n_tup_del as modifications
  FROM pg_stat_user_tables 
  ORDER BY modifications DESC 
  LIMIT 10;"

echo -e "\n✅ Weekly analysis completed"
```

## 🚨 Alert Escalation Matrix

### Escalation Levels

| Alert Severity | Initial Response | Escalation Time | Escalation Contact |
|----------------|------------------|-----------------|-------------------|
| **Critical (SEV-1)** | On-call Engineer | 15 minutes | Engineering Manager |
| **High (SEV-2)** | DevOps Team | 30 minutes | Senior Engineer |
| **Medium (SEV-3)** | Team Lead | 2 hours | Development Team |
| **Low (SEV-4)** | Next Business Day | 24 hours | Product Team |

### Escalation Procedures

#### Critical Alert Escalation
```bash
# Automatic escalation after 15 minutes
if [ "$ALERT_DURATION" -gt 900 ]; then
  # Page engineering manager
  curl -X POST https://api.pagerduty.com/incidents \
    -H "Authorization: Token token=YOUR_TOKEN" \
    -d '{
      "incident": {
        "title": "ESCALATION: '$ALERT_NAME'",
        "escalation_policy": {
          "id": "ENGINEERING_MANAGER_POLICY"
        }
      }
    }'
  
  # Notify leadership slack
  curl -X POST https://hooks.slack.com/services/LEADERSHIP_WEBHOOK \
    -d '{
      "text": "🚨 CRITICAL ALERT ESCALATION: '$ALERT_NAME'",
      "channel": "#leadership-alerts"
    }'
fi
```

### Communication Templates

#### Status Page Update
```bash
# Initial incident report
curl -X POST https://api.statuspage.io/v1/pages/PAGE_ID/incidents \
  -H "Authorization: OAuth YOUR_TOKEN" \
  -d "incident[name]=Crypto Data Service Performance Issues" \
  -d "incident[status]=investigating" \
  -d "incident[body]=We are investigating reports of increased response times. Updates to follow."

# Resolution update
curl -X PATCH https://api.statuspage.io/v1/pages/PAGE_ID/incidents/INCIDENT_ID \
  -H "Authorization: OAuth YOUR_TOKEN" \
  -d "incident[status]=resolved" \
  -d "incident[body]=The issue has been resolved. Service performance has returned to normal."
```

#### Internal Communication
```bash
# Slack incident notification
curl -X POST https://hooks.slack.com/services/TEAM_WEBHOOK \
  -d '{
    "text": "🔴 INCIDENT: '$ALERT_NAME'",
    "attachments": [
      {
        "color": "danger",
        "fields": [
          {"title": "Severity", "value": "'$SEVERITY'", "short": true},
          {"title": "Duration", "value": "'$DURATION'", "short": true},
          {"title": "Impact", "value": "'$IMPACT'", "short": false}
        ]
      }
    ]
  }'
```

## 📋 Runbook Maintenance

### Monthly Runbook Review
- [ ] Update alert thresholds based on performance trends
- [ ] Review and test escalation procedures
- [ ] Update contact information and on-call rotations
- [ ] Validate monitoring tool configurations
- [ ] Review and update automation scripts

### Quarterly Runbook Updates
- [ ] Comprehensive disaster recovery testing
- [ ] Update monitoring dashboards and alerts
- [ ] Review and optimize alert noise reduction
- [ ] Update runbook procedures based on incident learnings
- [ ] Team training on new procedures and tools

---

These runbooks provide comprehensive guidance for monitoring and responding to operational issues. Regular practice and updates ensure effective incident response and minimal service disruption.