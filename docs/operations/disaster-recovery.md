# Disaster Recovery Plan

> Comprehensive disaster recovery procedures for SmartWalletFX Crypto Data Service

## 🎯 Overview

This document outlines comprehensive disaster recovery (DR) procedures to ensure business continuity in the event of system failures, data corruption, security incidents, or natural disasters affecting the SmartWalletFX Crypto Data Service.

## 📊 Recovery Objectives

### Recovery Time Objective (RTO)
- **Critical Service**: 15 minutes
- **Database Recovery**: 30 minutes
- **Full System Recovery**: 2 hours
- **Cross-Region Failover**: 1 hour

### Recovery Point Objective (RPO)
- **Database**: 5 minutes (maximum data loss)
- **Configuration**: 0 minutes (immediate backup)
- **Logs and Metrics**: 15 minutes
- **Cache Data**: Acceptable loss (can be rebuilt)

### Service Level Objectives
- **Availability**: 99.95% (4.38 hours downtime/year)
- **Data Integrity**: 99.999%
- **Security Incident Response**: <1 hour
- **Communication**: <15 minutes for critical incidents

## 🏗️ Infrastructure Architecture for DR

### Multi-Region Setup

```
Primary Region (us-east-1)          Secondary Region (us-west-2)
┌─────────────────────────┐        ┌─────────────────────────┐
│   Production Cluster    │        │    DR Cluster (Warm)   │
│   ├── App Servers (3)   │◄──────►│   ├── App Servers (1)  │
│   ├── Database (RW)     │   Repl  │   ├── Database (RO)    │
│   ├── Redis Cluster     │◄──────►│   ├── Redis Standby    │
│   ├── Load Balancer     │        │   ├── Load Balancer    │
│   └── Monitoring Stack  │        │   └── Monitoring       │
└─────────────────────────┘        └─────────────────────────┘
           │                                    │
           ▼                                    ▼
┌─────────────────────────┐        ┌─────────────────────────┐
│     Backup Storage      │        │     Backup Storage     │
│   ├── Database Backups │◄──────►│   ├── Database Backups │
│   ├── Config Backups   │   Sync  │   ├── Config Backups  │
│   ├── Log Archives     │◄──────►│   ├── Log Archives    │
│   └── Metrics Data     │        │   └── Metrics Data    │
└─────────────────────────┘        └─────────────────────────┘
```

### Backup Strategy

#### Database Backups
```bash
# Automated backup schedule
# Full backup: Daily at 2:00 AM UTC
# Incremental backup: Every 4 hours
# Transaction log backup: Every 5 minutes

# Full backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="crypto_data_full_${DATE}"

# Create backup with compression
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --verbose \
  --file="/backups/${BACKUP_NAME}.dump"

# Upload to S3 with encryption
aws s3 cp "/backups/${BACKUP_NAME}.dump" \
  "s3://smartwalletfx-dr-backups/database/full/" \
  --storage-class STANDARD_IA \
  --server-side-encryption AES256

# Create cross-region copy
aws s3 cp \
  "s3://smartwalletfx-dr-backups/database/full/${BACKUP_NAME}.dump" \
  "s3://smartwalletfx-dr-backups-west/database/full/" \
  --source-region us-east-1 \
  --region us-west-2

# Verify backup integrity
pg_restore --list "/backups/${BACKUP_NAME}.dump" > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ Backup integrity verified"
else
  echo "❌ Backup integrity check failed"
  exit 1
fi
```

#### Application and Configuration Backups
```bash
# Configuration backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)

# Backup Kubernetes configurations
kubectl get all,configmap,secret,ingress,pv,pvc \
  -n crypto-data -o yaml > "k8s_backup_${DATE}.yaml"

# Backup environment configurations
tar -czf "config_backup_${DATE}.tar.gz" \
  .env.production \
  docker-compose.yml \
  k8s/ \
  monitoring/ \
  nginx/

# Upload to S3
aws s3 cp "config_backup_${DATE}.tar.gz" \
  "s3://smartwalletfx-dr-backups/config/" \
  --server-side-encryption AES256

# Cross-region replication (automatic via S3 CRR)
```

#### Monitoring Data Backups
```bash
# Prometheus and Grafana backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)

# Backup Prometheus data (selective - last 7 days)
kubectl exec -n monitoring prometheus-0 -- \
  tar -czf "/tmp/prometheus_${DATE}.tar.gz" \
  --newer-mtime="7 days ago" \
  /prometheus/data

# Copy from pod
kubectl cp monitoring/prometheus-0:/tmp/prometheus_${DATE}.tar.gz \
  ./prometheus_${DATE}.tar.gz

# Backup Grafana dashboards and datasources
kubectl get configmap -n monitoring -o yaml \
  > "grafana_config_${DATE}.yaml"

# Upload to S3
aws s3 cp "prometheus_${DATE}.tar.gz" \
  "s3://smartwalletfx-dr-backups/monitoring/"
aws s3 cp "grafana_config_${DATE}.yaml" \
  "s3://smartwalletfx-dr-backups/monitoring/"
```

## 🚨 Disaster Scenarios and Response Procedures

### Scenario 1: Application Server Failure

#### Detection
```bash
# Automated detection via health checks
# Alert triggers when >50% of pods are failing

# Manual verification
kubectl get pods -n crypto-data
kubectl describe pods -n crypto-data
kubectl logs -n crypto-data deployment/crypto-service --tail=100
```

#### Response Procedure (RTO: 5 minutes)
```bash
# 1. Immediate assessment
echo "🚨 Application server failure detected"
kubectl get nodes
kubectl get pods -n crypto-data -o wide

# 2. Scale up healthy instances
kubectl scale deployment crypto-service --replicas=6 -n crypto-data

# 3. Rolling restart if needed
kubectl rollout restart deployment crypto-service -n crypto-data

# 4. Monitor recovery
kubectl rollout status deployment crypto-service -n crypto-data --timeout=300s

# 5. Verify service health
curl -f https://api.smartwalletfx.com/health
```

### Scenario 2: Database Failure

#### Detection
```bash
# Database connection alerts
# Query performance degradation
# Replication lag alerts

# Verification
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "SELECT 1;"
```

#### Response Procedure (RTO: 30 minutes)

**Minor Issues (Connection problems, slow queries):**
```bash
# 1. Restart database pod
kubectl delete pod postgres-0 -n crypto-data

# 2. Monitor restart
kubectl get pods -n crypto-data -w

# 3. Verify connections
kubectl exec -n crypto-data deployment/crypto-service -- \
  pg_isready -h postgres -p 5432 -U crypto_user
```

**Major Issues (Data corruption, hardware failure):**
```bash
# 1. Switch to read-only mode immediately
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"READ_ONLY_MODE":"true","DATABASE_READONLY":"true"}}'

# 2. Assess damage
kubectl logs -n crypto-data postgres-0 --tail=500

# 3. Initiate backup restoration
LATEST_BACKUP=$(aws s3 ls s3://smartwalletfx-dr-backups/database/full/ \
  --recursive | sort | tail -n 1 | awk '{print $4}')

aws s3 cp "s3://smartwalletfx-dr-backups/database/full/${LATEST_BACKUP}" \
  ./restore_backup.dump

# 4. Create new database instance
kubectl apply -f k8s/postgres-restore.yaml

# 5. Restore data
kubectl cp restore_backup.dump crypto-data/postgres-restore-0:/tmp/
kubectl exec -n crypto-data postgres-restore-0 -- \
  pg_restore --dbname=crypto_data --clean --if-exists /tmp/restore_backup.dump

# 6. Switch traffic to restored database
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"DATABASE_URL":"postgresql://crypto_user:pass@postgres-restore:5432/crypto_data"}}'

# 7. Restart application
kubectl rollout restart deployment crypto-service -n crypto-data

# 8. Disable read-only mode
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"READ_ONLY_MODE":"false","DATABASE_READONLY":"false"}}'
```

### Scenario 3: Redis Cache Failure

#### Response Procedure (RTO: 10 minutes)
```bash
# 1. Verify impact (service should continue without cache)
kubectl logs -n crypto-data deployment/crypto-service | grep -i redis

# 2. Restart Redis
kubectl delete pod redis-0 -n crypto-data

# 3. Monitor restart
kubectl get pods -n crypto-data | grep redis

# 4. Test connectivity
kubectl exec -n crypto-data redis-0 -- redis-cli ping

# 5. Warm cache if needed
kubectl exec -n crypto-data deployment/crypto-service -- \
  curl -X POST http://localhost:3000/api/admin/cache/warm
```

### Scenario 4: Complete Regional Failure

#### Cross-Region Failover (RTO: 1 hour)

**Prerequisites:**
- Secondary region infrastructure pre-deployed
- DNS failover configured
- Cross-region replication active

**Failover Procedure:**
```bash
#!/bin/bash
# Cross-region disaster recovery script

echo "🌍 Initiating cross-region failover to us-west-2"

# 1. Promote read replica to primary
aws rds promote-read-replica \
  --db-instance-identifier crypto-data-replica-west \
  --region us-west-2

# 2. Update DNS to point to secondary region
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.smartwalletfx.com",
        "Type": "A",
        "AliasTarget": {
          "DNSName": "secondary-lb-west.elb.amazonaws.com",
          "EvaluateTargetHealth": true,
          "HostedZoneId": "Z215JYRZR1TBD5"
        }
      }
    }]
  }'

# 3. Scale up secondary region infrastructure
kubectl config use-context crypto-data-west
kubectl scale deployment crypto-service --replicas=3 -n crypto-data

# 4. Update configuration for primary mode
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"DATABASE_READONLY":"false","REDIS_PRIMARY":"true"}}'

# 5. Restart services
kubectl rollout restart deployment crypto-service -n crypto-data

# 6. Verify functionality
sleep 60
curl -f https://api.smartwalletfx.com/health

echo "✅ Cross-region failover completed"
```

### Scenario 5: Security Incident

#### Response Procedure (RTO: 1 hour)

**Immediate Response (0-15 minutes):**
```bash
# 1. Isolate affected systems
kubectl patch service crypto-service -n crypto-data \
  --patch '{"spec":{"type":"ClusterIP"}}'  # Remove external access

# 2. Rotate all secrets immediately
kubectl delete secret crypto-service-secrets -n crypto-data
kubectl create secret generic crypto-service-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=DATABASE_URL="$NEW_DATABASE_URL" \
  -n crypto-data

# 3. Enable security lockdown mode
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"SECURITY_LOCKDOWN":"true","API_ACCESS":"restricted"}}'

# 4. Capture forensic evidence
kubectl logs -n crypto-data deployment/crypto-service --since=2h > security_incident_logs.txt
```

**Investigation Phase (15-45 minutes):**
```bash
# 1. Analyze attack vectors
grep -E "(error|unauthorized|suspicious)" security_incident_logs.txt

# 2. Check for data breaches
kubectl exec -n crypto-data postgres-0 -- \
  psql -U crypto_user -d crypto_data -c "
  SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del
  FROM pg_stat_user_tables
  WHERE n_tup_upd > 0 OR n_tup_del > 0
  ORDER BY n_tup_upd + n_tup_del DESC;"

# 3. Review access logs
kubectl logs -n crypto-data deployment/crypto-service | \
  grep -E "api.*[4-5][0-9][0-9]" | tail -100
```

**Recovery Phase (45-60 minutes):**
```bash
# 1. Apply security patches
kubectl set image deployment/crypto-service \
  crypto-service=smartwalletfx/crypto-service:v3.0.1-security \
  -n crypto-data

# 2. Restore service with enhanced security
kubectl patch configmap crypto-service-config -n crypto-data \
  --patch '{"data":{"SECURITY_LOCKDOWN":"false","ENHANCED_LOGGING":"true"}}'

# 3. Gradually restore external access
kubectl patch service crypto-service -n crypto-data \
  --patch '{"spec":{"type":"LoadBalancer"}}'

# 4. Monitor for continued threats
kubectl logs -n crypto-data deployment/crypto-service -f | \
  grep -E "(error|suspicious|unauthorized)"
```

## 🔄 Recovery Procedures

### Database Point-in-Time Recovery

```bash
#!/bin/bash
# Point-in-time recovery script

TARGET_TIME="$1"  # Format: "2024-01-15 10:30:00"

if [ -z "$TARGET_TIME" ]; then
  echo "Usage: $0 'YYYY-MM-DD HH:MM:SS'"
  exit 1
fi

echo "🕒 Initiating point-in-time recovery to: $TARGET_TIME"

# 1. Find appropriate base backup
BACKUP_DATE=$(date -d "$TARGET_TIME" +%Y%m%d)
BACKUP_FILE=$(aws s3 ls s3://smartwalletfx-dr-backups/database/full/ | \
  grep "$BACKUP_DATE" | tail -1 | awk '{print $4}')

if [ -z "$BACKUP_FILE" ]; then
  echo "❌ No backup found for date $BACKUP_DATE"
  exit 1
fi

# 2. Download base backup
aws s3 cp "s3://smartwalletfx-dr-backups/database/full/$BACKUP_FILE" \
  ./base_backup.dump

# 3. Download WAL files
mkdir -p wal_files
aws s3 sync "s3://smartwalletfx-dr-backups/database/wal/" \
  ./wal_files/

# 4. Create recovery configuration
cat > recovery.conf <<EOF
restore_command = 'cp ./wal_files/%f %p'
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'promote'
EOF

# 5. Restore base backup
kubectl exec -n crypto-data postgres-recovery-0 -- \
  pg_restore --dbname=crypto_data_recovery --clean --if-exists \
  /tmp/base_backup.dump

# 6. Apply recovery configuration and start recovery
kubectl cp recovery.conf crypto-data/postgres-recovery-0:/var/lib/postgresql/data/
kubectl exec -n crypto-data postgres-recovery-0 -- \
  pg_ctl restart -D /var/lib/postgresql/data

echo "✅ Point-in-time recovery initiated"
```

### Configuration Recovery

```bash
#!/bin/bash
# Configuration recovery script

BACKUP_DATE="$1"  # Format: YYYYMMDD_HHMMSS

if [ -z "$BACKUP_DATE" ]; then
  echo "Usage: $0 YYYYMMDD_HHMMSS"
  exit 1
fi

echo "⚙️ Recovering configuration from backup: $BACKUP_DATE"

# 1. Download configuration backup
aws s3 cp "s3://smartwalletfx-dr-backups/config/config_backup_${BACKUP_DATE}.tar.gz" \
  ./config_recovery.tar.gz

# 2. Extract backup
tar -xzf config_recovery.tar.gz

# 3. Apply Kubernetes configurations
kubectl apply -f k8s/

# 4. Update ConfigMaps and Secrets
kubectl apply -f k8s_backup_${BACKUP_DATE}.yaml

# 5. Restart affected services
kubectl rollout restart deployment crypto-service -n crypto-data

echo "✅ Configuration recovery completed"
```

## 📋 Testing and Validation

### Monthly DR Testing Schedule

```bash
#!/bin/bash
# Monthly disaster recovery test script

echo "🧪 Monthly DR Test - $(date)"

# Test 1: Database backup restoration
echo "1. Testing database backup restoration..."
./test-database-recovery.sh

# Test 2: Cross-region failover simulation
echo "2. Testing cross-region failover..."
./test-cross-region-failover.sh --dry-run

# Test 3: Security incident response
echo "3. Testing security incident response..."
./test-security-incident.sh --simulation

# Test 4: Configuration recovery
echo "4. Testing configuration recovery..."
./test-config-recovery.sh

# Test 5: Backup integrity verification
echo "5. Verifying backup integrity..."
./verify-backup-integrity.sh

# Generate test report
./generate-dr-test-report.sh
```

### Backup Integrity Verification

```bash
#!/bin/bash
# Backup integrity verification script

echo "🔍 Verifying backup integrity..."

# Test database backups
LATEST_DB_BACKUP=$(aws s3 ls s3://smartwalletfx-dr-backups/database/full/ \
  --recursive | sort | tail -n 1 | awk '{print $4}')

aws s3 cp "s3://smartwalletfx-dr-backups/database/full/$LATEST_DB_BACKUP" \
  ./test_backup.dump

# Verify backup can be listed (indicates integrity)
pg_restore --list ./test_backup.dump > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ Database backup integrity verified"
else
  echo "❌ Database backup integrity check failed"
fi

# Test configuration backups
LATEST_CONFIG_BACKUP=$(aws s3 ls s3://smartwalletfx-dr-backups/config/ \
  --recursive | sort | tail -n 1 | awk '{print $4}')

aws s3 cp "s3://smartwalletfx-dr-backups/config/$LATEST_CONFIG_BACKUP" \
  ./test_config.tar.gz

tar -tf ./test_config.tar.gz > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ Configuration backup integrity verified"
else
  echo "❌ Configuration backup integrity check failed"
fi

# Cleanup
rm -f ./test_backup.dump ./test_config.tar.gz
```

## 📞 Emergency Contacts and Communication

### Escalation Matrix

| Role | Primary Contact | Secondary Contact | Response Time |
|------|----------------|-------------------|---------------|
| **On-Call Engineer** | +1-555-0123 | +1-555-0124 | 5 minutes |
| **DevOps Lead** | +1-555-0125 | +1-555-0126 | 15 minutes |
| **Engineering Manager** | +1-555-0127 | +1-555-0128 | 30 minutes |
| **CTO** | +1-555-0129 | +1-555-0130 | 1 hour |
| **CEO** | +1-555-0131 | +1-555-0132 | 2 hours |

### Communication Channels

```bash
# Slack notifications
curl -X POST https://hooks.slack.com/services/CRITICAL_WEBHOOK \
  -d '{
    "text": "🚨 DISASTER RECOVERY INITIATED",
    "attachments": [
      {
        "color": "danger",
        "fields": [
          {"title": "Incident", "value": "'$INCIDENT_TYPE'", "short": true},
          {"title": "Severity", "value": "CRITICAL", "short": true},
          {"title": "ETA", "value": "'$ESTIMATED_RECOVERY'", "short": true}
        ]
      }
    ]
  }'

# Status page update
curl -X POST https://api.statuspage.io/v1/pages/PAGE_ID/incidents \
  -H "Authorization: OAuth YOUR_TOKEN" \
  -d "incident[name]=System Maintenance - Service Recovery" \
  -d "incident[status]=investigating" \
  -d "incident[body]=We are currently recovering from a system incident. Updates will be provided every 15 minutes."

# Email notifications
aws ses send-email \
  --source no-reply@smartwalletfx.com \
  --destination ToAddresses=executives@smartwalletfx.com \
  --message Subject="{Data='CRITICAL: DR Procedures Initiated'}",Body="{Text={Data='Disaster recovery procedures have been initiated for the crypto data service. Please check #incident-response for updates.'}}"
```

## 📊 Recovery Metrics and Reporting

### Post-Incident Report Template

```markdown
# Disaster Recovery Incident Report

**Incident ID**: DR-2024-001
**Date**: 2024-01-15
**Duration**: 2 hours 15 minutes
**Severity**: Critical

## Executive Summary
Brief description of the incident and impact.

## Timeline
- **10:00 UTC**: Incident detected
- **10:05 UTC**: DR procedures initiated
- **10:15 UTC**: Database backup restoration started
- **11:30 UTC**: Cross-region failover completed
- **12:15 UTC**: Full service restored

## Impact Assessment
- **Users Affected**: 10,000 (~80% of user base)
- **Data Loss**: None (RPO achieved)
- **Revenue Impact**: $50,000 estimated
- **SLA Breach**: Yes (99.95% availability target)

## Recovery Actions Taken
1. Immediate isolation of affected systems
2. Database backup restoration from 09:45 UTC backup
3. Cross-region failover to us-west-2
4. Service validation and monitoring

## Root Cause Analysis
Detailed analysis of what caused the disaster.

## Lessons Learned
- What worked well during recovery
- Areas for improvement
- Process gaps identified

## Action Items
- [ ] Update monitoring thresholds
- [ ] Improve cross-region failover automation
- [ ] Enhance backup verification procedures
- [ ] Update DR documentation

## Prevention Measures
Steps taken to prevent similar incidents.
```

### DR Metrics Dashboard

```yaml
# Grafana dashboard for DR metrics
dashboard:
  title: "Disaster Recovery Metrics"
  panels:
    - title: "Recovery Time Objectives"
      targets:
        - "avg(disaster_recovery_rto_seconds)"
        - "max(disaster_recovery_rto_seconds)"
    
    - title: "Recovery Point Objectives"
      targets:
        - "avg(disaster_recovery_rpo_seconds)"
        - "max(disaster_recovery_rpo_seconds)"
    
    - title: "Backup Success Rate"
      targets:
        - "rate(backup_operations_total{status='success'}[24h])"
        - "rate(backup_operations_total{status='failed'}[24h])"
    
    - title: "Cross-Region Replication Lag"
      targets:
        - "database_replication_lag_seconds"
        - "redis_replication_lag_seconds"
```

## 🔄 Continuous Improvement

### Quarterly DR Review Process

1. **Metrics Analysis**
   - Review RTO/RPO achievement
   - Analyze backup success rates
   - Assess cross-region replication performance

2. **Process Optimization**
   - Update procedures based on lessons learned
   - Enhance automation capabilities
   - Improve documentation clarity

3. **Infrastructure Updates**
   - Evaluate new DR technologies
   - Optimize backup strategies
   - Enhance monitoring capabilities

4. **Team Training**
   - Conduct DR simulation exercises
   - Update runbooks and procedures
   - Cross-train team members

---

This disaster recovery plan ensures comprehensive preparation for various failure scenarios while maintaining business continuity and minimizing data loss. Regular testing and updates keep the procedures current and effective.