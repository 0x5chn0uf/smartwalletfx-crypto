#!/usr/bin/env tsx
/**
 * Monitoring & Alerting Validation Script
 * 
 * Validates that monitoring and alerting systems are properly configured
 * and functional before production deployment.
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

interface MonitoringCheck {
  component: string;
  check: string;
  status: 'pass' | 'fail' | 'warning' | 'skip';
  message: string;
  details?: string;
  critical: boolean;
}

interface MonitoringValidationResult {
  timestamp: string;
  environment: string;
  overallStatus: 'ready' | 'needs-attention' | 'not-ready';
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  checks: MonitoringCheck[];
  recommendations: string[];
}

class MonitoringValidator {
  private checks: MonitoringCheck[] = [];
  private recommendations: string[] = [];
  private baseUrl: string;
  private metricsUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.SERVICE_URL || 'http://localhost:3000';
    const metricsPort = process.env.METRICS_PORT || 9090;
    this.metricsUrl = `${this.baseUrl.replace(/:\d+/, `:${metricsPort}`)}/metrics`;
  }

  async validateMonitoring(): Promise<MonitoringValidationResult> {
    console.log('📊 Starting Monitoring & Alerting Validation...');
    console.log(`🔗 Service URL: ${this.baseUrl}`);
    console.log(`📈 Metrics URL: ${this.metricsUrl}`);
    console.log('=' .repeat(80));

    await this.validateMetricsEndpoint();
    await this.validatePrometheusConfiguration();
    await this.validateGrafanaDashboards();
    await this.validateAlertingRules();
    await this.validateHealthChecks();
    await this.validateLogging();
    await this.validateErrorTracking();
    await this.validateNotificationChannels();

    return this.generateReport();
  }

  private async validateMetricsEndpoint(): Promise<void> {
    console.log('📈 Validating Metrics Endpoint...');

    try {
      const response = await fetch(this.metricsUrl, { timeout: 10000 });

      if (response.ok) {
        const metricsText = await response.text();
        
        this.addCheck('Metrics', 'Metrics Endpoint Accessibility', 'pass',
          'Metrics endpoint is accessible and responding', false);

        // Check for essential metrics
        const essentialMetrics = [
          'nodejs_heap_size_total_bytes',
          'nodejs_heap_size_used_bytes',
          'http_requests_total',
          'http_request_duration_ms',
          'process_cpu_user_seconds_total'
        ];

        let foundMetrics = 0;
        for (const metric of essentialMetrics) {
          if (metricsText.includes(metric)) {
            foundMetrics++;
            this.addCheck('Metrics', `Essential Metric: ${metric}`, 'pass',
              'Metric is being collected', false);
          } else {
            this.addCheck('Metrics', `Essential Metric: ${metric}`, 'warning',
              'Metric not found in metrics output', false);
          }
        }

        if (foundMetrics >= essentialMetrics.length * 0.8) {
          this.addCheck('Metrics', 'Metrics Coverage', 'pass',
            `${foundMetrics}/${essentialMetrics.length} essential metrics found`, false);
        } else {
          this.addCheck('Metrics', 'Metrics Coverage', 'warning',
            `Only ${foundMetrics}/${essentialMetrics.length} essential metrics found`, false);
        }

        // Check for custom application metrics
        const customMetrics = [
          'crypto_api_requests_total',
          'crypto_cache_hits_total',
          'crypto_external_api_calls_total',
          'crypto_portfolio_calculations_total'
        ];

        let foundCustomMetrics = 0;
        for (const metric of customMetrics) {
          if (metricsText.includes(metric)) {
            foundCustomMetrics++;
          }
        }

        if (foundCustomMetrics > 0) {
          this.addCheck('Metrics', 'Custom Application Metrics', 'pass',
            `${foundCustomMetrics} custom metrics found`, false);
        } else {
          this.addCheck('Metrics', 'Custom Application Metrics', 'warning',
            'No custom application metrics found', false);
        }

      } else {
        this.addCheck('Metrics', 'Metrics Endpoint Accessibility', 'fail',
          `Metrics endpoint returned ${response.status}`, true);
      }
    } catch (error) {
      this.addCheck('Metrics', 'Metrics Endpoint Accessibility', 'fail',
        'Metrics endpoint not accessible', true);
    }
  }

  private async validatePrometheusConfiguration(): Promise<void> {
    console.log('🔍 Validating Prometheus Configuration...');

    // Check if Prometheus configuration exists
    const prometheusFiles = [
      'monitoring/prometheus.yml',
      'monitoring/alerts.yml'
    ];

    for (const file of prometheusFiles) {
      try {
        await fs.access(file);
        this.addCheck('Prometheus', `Config File: ${path.basename(file)}`, 'pass',
          `${file} exists`, false);

        // Validate Prometheus configuration syntax
        if (file.endsWith('prometheus.yml')) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            
            // Check for essential sections
            if (content.includes('scrape_configs:')) {
              this.addCheck('Prometheus', 'Scrape Configs', 'pass',
                'Scrape configurations found', false);
            } else {
              this.addCheck('Prometheus', 'Scrape Configs', 'warning',
                'No scrape configurations found', false);
            }

            if (content.includes('rule_files:')) {
              this.addCheck('Prometheus', 'Rule Files', 'pass',
                'Alert rule files configured', false);
            } else {
              this.addCheck('Prometheus', 'Rule Files', 'warning',
                'No alert rule files configured', false);
            }

            if (content.includes('alerting:')) {
              this.addCheck('Prometheus', 'Alerting Config', 'pass',
                'Alerting configuration found', false);
            } else {
              this.addCheck('Prometheus', 'Alerting Config', 'warning',
                'No alerting configuration found', false);
            }

          } catch (error) {
            this.addCheck('Prometheus', 'Config Validation', 'warning',
              'Could not validate Prometheus configuration', false);
          }
        }

      } catch (error) {
        this.addCheck('Prometheus', `Config File: ${path.basename(file)}`, 'warning',
          `${file} not found`, false);
      }
    }

    // Check if monitoring setup script exists
    try {
      await fs.access('monitoring/setup-monitoring.sh');
      this.addCheck('Prometheus', 'Setup Script', 'pass',
        'Monitoring setup script exists', false);

      // Check if script is executable
      try {
        const stats = await fs.stat('monitoring/setup-monitoring.sh');
        if (stats.mode & 0o111) {
          this.addCheck('Prometheus', 'Setup Script Permissions', 'pass',
            'Setup script is executable', false);
        } else {
          this.addCheck('Prometheus', 'Setup Script Permissions', 'warning',
            'Setup script is not executable', false);
        }
      } catch (error) {
        this.addCheck('Prometheus', 'Setup Script Permissions', 'warning',
          'Could not check script permissions', false);
      }

    } catch (error) {
      this.addCheck('Prometheus', 'Setup Script', 'warning',
        'Monitoring setup script not found', false);
    }
  }

  private async validateGrafanaDashboards(): Promise<void> {
    console.log('📊 Validating Grafana Dashboards...');

    const dashboardFiles = [
      'monitoring/grafana-dashboard.json',
      'monitoring/crypto-data-dashboard.json'
    ];

    let foundDashboards = 0;
    for (const file of dashboardFiles) {
      try {
        await fs.access(file);
        foundDashboards++;
        this.addCheck('Grafana', `Dashboard: ${path.basename(file)}`, 'pass',
          `${file} exists`, false);

        // Validate dashboard JSON
        try {
          const content = await fs.readFile(file, 'utf-8');
          const dashboard = JSON.parse(content);

          if (dashboard.dashboard || dashboard.title) {
            this.addCheck('Grafana', `Dashboard JSON: ${path.basename(file)}`, 'pass',
              'Dashboard JSON is valid', false);
          } else {
            this.addCheck('Grafana', `Dashboard JSON: ${path.basename(file)}`, 'warning',
              'Dashboard JSON may be invalid', false);
          }

          // Check for essential panels
          const panels = dashboard.panels || dashboard.dashboard?.panels || [];
          if (panels.length > 0) {
            this.addCheck('Grafana', `Dashboard Panels: ${path.basename(file)}`, 'pass',
              `${panels.length} panels found in dashboard`, false);
          } else {
            this.addCheck('Grafana', `Dashboard Panels: ${path.basename(file)}`, 'warning',
              'No panels found in dashboard', false);
          }

        } catch (error) {
          this.addCheck('Grafana', `Dashboard JSON: ${path.basename(file)}`, 'warning',
            'Could not parse dashboard JSON', false);
        }

      } catch (error) {
        this.addCheck('Grafana', `Dashboard: ${path.basename(file)}`, 'warning',
          `${file} not found`, false);
      }
    }

    if (foundDashboards > 0) {
      this.addCheck('Grafana', 'Dashboard Availability', 'pass',
        `${foundDashboards} dashboard(s) configured`, false);
    } else {
      this.addCheck('Grafana', 'Dashboard Availability', 'warning',
        'No Grafana dashboards found', false);
    }
  }

  private async validateAlertingRules(): Promise<void> {
    console.log('🚨 Validating Alerting Rules...');

    try {
      const alertsFile = 'monitoring/alerts.yml';
      await fs.access(alertsFile);
      
      this.addCheck('Alerting', 'Alert Rules File', 'pass',
        'Alert rules file exists', false);

      const content = await fs.readFile(alertsFile, 'utf-8');

      // Check for essential alert rules
      const essentialAlerts = [
        'HighErrorRate',
        'HighResponseTime',
        'ServiceDown',
        'HighMemoryUsage',
        'HighCPUUsage'
      ];

      let foundAlerts = 0;
      for (const alert of essentialAlerts) {
        if (content.includes(alert)) {
          foundAlerts++;
          this.addCheck('Alerting', `Alert Rule: ${alert}`, 'pass',
            'Alert rule found', false);
        } else {
          this.addCheck('Alerting', `Alert Rule: ${alert}`, 'warning',
            'Alert rule not found', false);
        }
      }

      if (foundAlerts >= essentialAlerts.length * 0.6) {
        this.addCheck('Alerting', 'Alert Coverage', 'pass',
          `${foundAlerts}/${essentialAlerts.length} essential alerts configured`, false);
      } else {
        this.addCheck('Alerting', 'Alert Coverage', 'warning',
          `Only ${foundAlerts}/${essentialAlerts.length} essential alerts configured`, false);
      }

      // Check for severity levels
      if (content.includes('severity:')) {
        this.addCheck('Alerting', 'Alert Severity Levels', 'pass',
          'Alert severity levels configured', false);
      } else {
        this.addCheck('Alerting', 'Alert Severity Levels', 'warning',
          'No alert severity levels found', false);
      }

    } catch (error) {
      this.addCheck('Alerting', 'Alert Rules File', 'warning',
        'Alert rules file not found', false);
    }
  }

  private async validateHealthChecks(): Promise<void> {
    console.log('🏥 Validating Health Checks...');

    try {
      const response = await fetch(`${this.baseUrl}/health`, { timeout: 10000 });

      if (response.ok) {
        const healthData = await response.json();
        
        this.addCheck('Health Checks', 'Health Endpoint', 'pass',
          'Health endpoint is responding', false);

        // Check health response structure
        const requiredFields = ['status', 'timestamp', 'uptime'];
        let foundFields = 0;

        for (const field of requiredFields) {
          if (healthData[field] !== undefined) {
            foundFields++;
            this.addCheck('Health Checks', `Health Field: ${field}`, 'pass',
              `Field '${field}' present in health response`, false);
          } else {
            this.addCheck('Health Checks', `Health Field: ${field}`, 'warning',
              `Field '${field}' missing from health response`, false);
          }
        }

        // Check dependencies health
        if (healthData.dependencies) {
          const deps = Object.keys(healthData.dependencies);
          this.addCheck('Health Checks', 'Dependencies Health', 'pass',
            `${deps.length} dependencies checked: ${deps.join(', ')}`, false);

          // Check each dependency status
          Object.entries(healthData.dependencies).forEach(([dep, status]) => {
            const isHealthy = status === 'connected' || status === 'healthy' || status === 'ok';
            this.addCheck('Health Checks', `Dependency: ${dep}`, 
              isHealthy ? 'pass' : 'fail',
              `${dep} status: ${status}`, !isHealthy);
          });
        } else {
          this.addCheck('Health Checks', 'Dependencies Health', 'warning',
            'No dependencies health checks found', false);
        }

        // Check health check performance
        const responseTime = response.headers.get('x-response-time');
        if (responseTime) {
          const time = parseFloat(responseTime);
          if (time < 100) {
            this.addCheck('Health Checks', 'Health Check Performance', 'pass',
              `Health check responds in ${time}ms`, false);
          } else {
            this.addCheck('Health Checks', 'Health Check Performance', 'warning',
              `Health check is slow (${time}ms)`, false);
          }
        }

      } else {
        this.addCheck('Health Checks', 'Health Endpoint', 'fail',
          `Health endpoint returned ${response.status}`, true);
      }
    } catch (error) {
      this.addCheck('Health Checks', 'Health Endpoint', 'fail',
        'Health endpoint not accessible', true);
    }

    // Check if readiness probe exists (for Kubernetes)
    try {
      const response = await fetch(`${this.baseUrl}/ready`, { timeout: 5000 });
      if (response.ok) {
        this.addCheck('Health Checks', 'Readiness Probe', 'pass',
          'Readiness probe endpoint exists', false);
      }
    } catch (error) {
      this.addCheck('Health Checks', 'Readiness Probe', 'skip',
        'Readiness probe endpoint not implemented', false);
    }

    // Check if liveness probe exists (for Kubernetes)
    try {
      const response = await fetch(`${this.baseUrl}/live`, { timeout: 5000 });
      if (response.ok) {
        this.addCheck('Health Checks', 'Liveness Probe', 'pass',
          'Liveness probe endpoint exists', false);
      }
    } catch (error) {
      this.addCheck('Health Checks', 'Liveness Probe', 'skip',
        'Liveness probe endpoint not implemented', false);
    }
  }

  private async validateLogging(): Promise<void> {
    console.log('📝 Validating Logging Configuration...');

    // Check logging configuration
    const logLevel = process.env.LOG_LEVEL || 'info';
    const logFormat = process.env.LOG_FORMAT || 'text';

    this.addCheck('Logging', 'Log Level Configuration', 'pass',
      `Log level set to: ${logLevel}`, false);

    this.addCheck('Logging', 'Log Format Configuration', 'pass',
      `Log format set to: ${logFormat}`, false);

    // Check if structured logging is used
    if (logFormat === 'json') {
      this.addCheck('Logging', 'Structured Logging', 'pass',
        'JSON structured logging enabled', false);
    } else {
      this.addCheck('Logging', 'Structured Logging', 'warning',
        'Consider enabling JSON structured logging for production', false);
    }

    // Check log file configuration
    const logFileEnabled = process.env.LOG_FILE_ENABLED === 'true';
    if (logFileEnabled) {
      this.addCheck('Logging', 'File Logging', 'pass',
        'File logging is enabled', false);

      const logFilePath = process.env.LOG_FILE_PATH;
      if (logFilePath) {
        this.addCheck('Logging', 'Log File Path', 'pass',
          `Log file path configured: ${logFilePath}`, false);
      }
    } else {
      this.addCheck('Logging', 'File Logging', 'warning',
        'File logging is disabled', false);
    }

    // Check log rotation configuration
    const maxFileSize = process.env.LOG_MAX_FILE_SIZE;
    const maxFiles = process.env.LOG_MAX_FILES;

    if (maxFileSize && maxFiles) {
      this.addCheck('Logging', 'Log Rotation', 'pass',
        `Log rotation configured: ${maxFileSize} per file, ${maxFiles} files max`, false);
    } else {
      this.addCheck('Logging', 'Log Rotation', 'warning',
        'Log rotation not fully configured', false);
    }
  }

  private async validateErrorTracking(): Promise<void> {
    console.log('🐛 Validating Error Tracking...');

    const sentryDsn = process.env.SENTRY_DSN;
    const environment = process.env.NODE_ENV || 'development';

    if (sentryDsn) {
      this.addCheck('Error Tracking', 'Sentry Configuration', 'pass',
        'Sentry DSN is configured', false);

      // Validate DSN format
      try {
        new URL(sentryDsn);
        this.addCheck('Error Tracking', 'Sentry DSN Format', 'pass',
          'Sentry DSN format is valid', false);
      } catch (error) {
        this.addCheck('Error Tracking', 'Sentry DSN Format', 'fail',
          'Sentry DSN format is invalid', false);
      }

      const sentryEnv = process.env.SENTRY_ENVIRONMENT || environment;
      this.addCheck('Error Tracking', 'Sentry Environment', 'pass',
        `Sentry environment set to: ${sentryEnv}`, false);

      const sampleRate = process.env.SENTRY_SAMPLE_RATE || '1.0';
      const rate = parseFloat(sampleRate);
      if (rate >= 0 && rate <= 1) {
        this.addCheck('Error Tracking', 'Sentry Sample Rate', 'pass',
          `Sample rate set to: ${rate}`, false);
      } else {
        this.addCheck('Error Tracking', 'Sentry Sample Rate', 'warning',
          `Invalid sample rate: ${sampleRate}`, false);
      }

    } else {
      const isCritical = environment === 'production';
      this.addCheck('Error Tracking', 'Sentry Configuration', 
        isCritical ? 'fail' : 'warning',
        'Sentry DSN not configured', isCritical);
    }

    // Check for custom error tracking implementation
    try {
      await fs.access('src/utils/errorHandler.ts');
      this.addCheck('Error Tracking', 'Custom Error Handler', 'pass',
        'Custom error handler implementation found', false);
    } catch (error) {
      this.addCheck('Error Tracking', 'Custom Error Handler', 'warning',
        'No custom error handler found', false);
    }
  }

  private async validateNotificationChannels(): Promise<void> {
    console.log('📢 Validating Notification Channels...');

    // This is a placeholder for notification channel validation
    // In a real implementation, you would test actual notification channels

    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhook) {
      this.addCheck('Notifications', 'Slack Integration', 'pass',
        'Slack webhook URL configured', false);
    } else {
      this.addCheck('Notifications', 'Slack Integration', 'warning',
        'No Slack webhook configured', false);
    }

    const emailConfig = process.env.SMTP_HOST && process.env.SMTP_USER;
    if (emailConfig) {
      this.addCheck('Notifications', 'Email Notifications', 'pass',
        'SMTP email configuration found', false);
    } else {
      this.addCheck('Notifications', 'Email Notifications', 'warning',
        'No email notification configuration found', false);
    }

    const pagerDutyKey = process.env.PAGERDUTY_API_KEY;
    if (pagerDutyKey) {
      this.addCheck('Notifications', 'PagerDuty Integration', 'pass',
        'PagerDuty API key configured', false);
    } else {
      this.addCheck('Notifications', 'PagerDuty Integration', 'skip',
        'PagerDuty not configured', false);
    }
  }

  private addCheck(component: string, check: string, status: 'pass' | 'fail' | 'warning' | 'skip',
                  message: string, critical: boolean, details?: string): void {
    this.checks.push({
      component,
      check,
      status,
      message,
      details,
      critical
    });
  }

  private generateReport(): MonitoringValidationResult {
    const passed = this.checks.filter(c => c.status === 'pass').length;
    const failed = this.checks.filter(c => c.status === 'fail').length;
    const warnings = this.checks.filter(c => c.status === 'warning').length;
    const skipped = this.checks.filter(c => c.status === 'skip').length;

    const criticalFailures = this.checks.filter(c => c.critical && c.status === 'fail').length;

    let overallStatus: 'ready' | 'needs-attention' | 'not-ready';
    if (criticalFailures > 0) {
      overallStatus = 'not-ready';
    } else if (failed > 0 || warnings > 8) {
      overallStatus = 'needs-attention';
    } else {
      overallStatus = 'ready';
    }

    // Generate recommendations
    if (criticalFailures > 0) {
      this.recommendations.push('🚨 Fix critical monitoring failures immediately');
    }
    
    if (failed > 0) {
      this.recommendations.push('Address all failed monitoring checks');
    }
    
    if (warnings > 5) {
      this.recommendations.push('Review and improve monitoring configuration warnings');
    }

    this.recommendations.push('Test all alert conditions manually before deployment');
    this.recommendations.push('Verify notification channels are working correctly');
    this.recommendations.push('Ensure monitoring data retention policies are configured');
    this.recommendations.push('Set up monitoring for the monitoring system itself');

    return {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      overallStatus,
      summary: {
        totalChecks: this.checks.length,
        passed,
        failed,
        warnings,
        skipped
      },
      checks: this.checks,
      recommendations: this.recommendations
    };
  }

  printReport(result: MonitoringValidationResult): void {
    console.log('\n📊 Monitoring Validation Report');
    console.log('=' .repeat(80));
    console.log(`📅 Timestamp: ${result.timestamp}`);
    console.log(`🌍 Environment: ${result.environment}`);
    console.log(`📊 Overall Status: ${this.getStatusEmoji(result.overallStatus)} ${result.overallStatus.toUpperCase()}`);
    console.log(`📈 Summary: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.warnings} warnings, ${result.summary.skipped} skipped`);

    // Group checks by component
    const components = [...new Set(result.checks.map(c => c.component))];
    
    for (const component of components) {
      console.log(`\n📋 ${component}:`);
      const componentChecks = result.checks.filter(c => c.component === component);
      
      for (const check of componentChecks) {
        const emoji = this.getCheckEmoji(check.status);
        console.log(`  ${emoji} ${check.check}: ${check.message}`);
        if (check.details) {
          console.log(`    ℹ️  ${check.details}`);
        }
      }
    }

    if (result.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      result.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }

    console.log('\n' + '=' .repeat(80));
    
    if (result.overallStatus === 'ready') {
      console.log('✅ Monitoring validation passed! Monitoring system is ready.');
    } else if (result.overallStatus === 'needs-attention') {
      console.log('⚠️  Monitoring needs attention. Review warnings and failures.');
    } else {
      console.log('❌ Monitoring validation failed! Critical issues must be resolved.');
    }
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'ready': return '✅';
      case 'needs-attention': return '⚠️';
      case 'not-ready': return '❌';
      default: return '❓';
    }
  }

  private getCheckEmoji(status: string): string {
    switch (status) {
      case 'pass': return '✅';
      case 'warning': return '⚠️';
      case 'fail': return '❌';
      case 'skip': return '⏭️';
      default: return '❓';
    }
  }

  async saveReport(result: MonitoringValidationResult): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'monitoring-validation-reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `monitoring-validation-${result.environment}-${timestamp}.json`;
    const filePath = path.join(reportsDir, filename);
    
    await fs.writeFile(filePath, JSON.stringify(result, null, 2));
    
    return filePath;
  }
}

// CLI interface
async function main() {
  const baseUrl = process.argv[2] || process.env.SERVICE_URL;
  
  const validator = new MonitoringValidator(baseUrl);
  
  try {
    const result = await validator.validateMonitoring();
    
    validator.printReport(result);
    
    const reportPath = await validator.saveReport(result);
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    // Exit with appropriate code
    if (result.overallStatus === 'not-ready') {
      process.exit(1);
    } else if (result.overallStatus === 'needs-attention') {
      process.exit(2);
    } else {
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Monitoring validation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { MonitoringValidator, MonitoringValidationResult };