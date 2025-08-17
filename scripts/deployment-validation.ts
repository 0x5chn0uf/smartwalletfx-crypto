#!/usr/bin/env tsx
/**
 * Comprehensive Deployment Validation Script
 * 
 * This script performs comprehensive validation of the deployment environment
 * and service configuration before production deployment.
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

interface ValidationCheck {
  category: string;
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'skip';
  message: string;
  details?: string;
  critical: boolean;
}

interface DeploymentValidationResult {
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
  checks: ValidationCheck[];
  recommendations: string[];
}

class DeploymentValidator {
  private checks: ValidationCheck[] = [];
  private recommendations: string[] = [];
  private baseUrl: string;
  private environment: string;

  constructor(baseUrl?: string, environment?: string) {
    this.baseUrl = baseUrl || process.env.SERVICE_URL || 'http://localhost:3000';
    this.environment = environment || process.env.NODE_ENV || 'development';
  }

  async validateDeployment(): Promise<DeploymentValidationResult> {
    console.log('🚀 Starting Comprehensive Deployment Validation...');
    console.log(`🌍 Environment: ${this.environment}`);
    console.log(`🔗 Service URL: ${this.baseUrl}`);
    console.log('=' .repeat(80));

    // Run all validation categories
    await this.validateEnvironmentConfiguration();
    await this.validateCodeQuality();
    await this.validateSecurity();
    await this.validateServiceHealth();
    await this.validateDatabase();
    await this.validateCache();
    await this.validateExternalDependencies();
    await this.validateMonitoring();
    await this.validatePerformance();
    await this.validateDocumentation();

    return this.generateReport();
  }

  private async validateEnvironmentConfiguration(): Promise<void> {
    console.log('🔧 Validating Environment Configuration...');

    // Check Node.js version
    try {
      const { stdout } = await execAsync('node --version');
      const nodeVersion = stdout.trim();
      const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);

      if (majorVersion >= 20) {
        this.addCheck('Environment', 'Node.js Version', 'pass', 
          `Node.js ${nodeVersion} meets requirements`, false);
      } else {
        this.addCheck('Environment', 'Node.js Version', 'fail',
          `Node.js ${nodeVersion} is below required version 20`, true);
      }
    } catch (error) {
      this.addCheck('Environment', 'Node.js Version', 'fail',
        'Could not determine Node.js version', true);
    }

    // Check npm version
    try {
      const { stdout } = await execAsync('npm --version');
      const npmVersion = stdout.trim();
      const majorVersion = parseInt(npmVersion.split('.')[0]);

      if (majorVersion >= 9) {
        this.addCheck('Environment', 'npm Version', 'pass',
          `npm ${npmVersion} meets requirements`, false);
      } else {
        this.addCheck('Environment', 'npm Version', 'warning',
          `npm ${npmVersion} may cause issues`, false);
      }
    } catch (error) {
      this.addCheck('Environment', 'npm Version', 'warning',
        'Could not determine npm version', false);
    }

    // Check environment variables
    const requiredEnvVars = [
      'NODE_ENV',
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY'
    ];

    if (this.environment === 'production') {
      requiredEnvVars.push('ALCHEMY_API_KEY', 'SENTRY_DSN');
    }

    for (const envVar of requiredEnvVars) {
      if (process.env[envVar]) {
        this.addCheck('Environment', `Environment Variable: ${envVar}`, 'pass',
          'Variable is set', false);
      } else {
        const isCritical = this.environment === 'production';
        this.addCheck('Environment', `Environment Variable: ${envVar}`, 
          isCritical ? 'fail' : 'warning',
          'Variable is not set', isCritical);
      }
    }

    // Check for development secrets in production
    if (this.environment === 'production') {
      const dangerousValues = ['changeme', 'secret', 'password', 'admin'];
      for (const envVar of ['JWT_SECRET', 'ENCRYPTION_KEY']) {
        const value = process.env[envVar];
        if (value && dangerousValues.some(dangerous => 
          value.toLowerCase().includes(dangerous))) {
          this.addCheck('Environment', `${envVar} Security`, 'fail',
            'Environment variable contains unsafe default value', true);
        }
      }
    }
  }

  private async validateCodeQuality(): Promise<void> {
    console.log('📝 Validating Code Quality...');

    // Check TypeScript compilation
    try {
      await execAsync('npm run typecheck');
      this.addCheck('Code Quality', 'TypeScript Compilation', 'pass',
        'TypeScript compiles without errors', false);
    } catch (error) {
      this.addCheck('Code Quality', 'TypeScript Compilation', 'fail',
        'TypeScript compilation failed', true);
    }

    // Check linting
    try {
      await execAsync('npm run lint');
      this.addCheck('Code Quality', 'ESLint Validation', 'pass',
        'No linting errors found', false);
    } catch (error) {
      this.addCheck('Code Quality', 'ESLint Validation', 'warning',
        'Linting errors found', false);
    }

    // Check for TODO/FIXME in critical paths
    try {
      const { stdout } = await execAsync(
        'grep -r "TODO\\|FIXME" src/ --include="*.ts" --exclude-dir=tests | wc -l'
      );
      const todoCount = parseInt(stdout.trim());
      
      if (todoCount === 0) {
        this.addCheck('Code Quality', 'TODO/FIXME Check', 'pass',
          'No TODO/FIXME found in source code', false);
      } else {
        this.addCheck('Code Quality', 'TODO/FIXME Check', 'warning',
          `Found ${todoCount} TODO/FIXME items in source code`, false);
      }
    } catch (error) {
      this.addCheck('Code Quality', 'TODO/FIXME Check', 'skip',
        'Could not scan for TODO/FIXME items', false);
    }

    // Check test coverage
    try {
      await execAsync('npm run test:coverage');
      this.addCheck('Code Quality', 'Test Coverage', 'pass',
        'Test coverage report generated successfully', false);
    } catch (error) {
      this.addCheck('Code Quality', 'Test Coverage', 'warning',
        'Could not generate test coverage report', false);
    }
  }

  private async validateSecurity(): Promise<void> {
    console.log('🔒 Validating Security Configuration...');

    // Check for hardcoded secrets
    try {
      const { stdout } = await execAsync(
        'grep -r "sk-\\|pk_\\|rk_\\|\\bkey\\b.*=\\|\\bsecret\\b.*=\\|\\bpassword\\b.*=" src/ --include="*.ts" --include="*.js" | grep -v "process.env" | wc -l'
      );
      const secretCount = parseInt(stdout.trim());

      if (secretCount === 0) {
        this.addCheck('Security', 'Hardcoded Secrets Scan', 'pass',
          'No obvious hardcoded secrets found', false);
      } else {
        this.addCheck('Security', 'Hardcoded Secrets Scan', 'fail',
          `Found ${secretCount} potential hardcoded secrets`, true);
      }
    } catch (error) {
      this.addCheck('Security', 'Hardcoded Secrets Scan', 'warning',
        'Could not scan for hardcoded secrets', false);
    }

    // Check dependencies for known vulnerabilities
    try {
      await execAsync('npm audit --audit-level=critical');
      this.addCheck('Security', 'Dependency Security Audit', 'pass',
        'No critical vulnerabilities found in dependencies', false);
    } catch (error) {
      this.addCheck('Security', 'Dependency Security Audit', 'fail',
        'Critical vulnerabilities found in dependencies', true);
    }

    // Validate JWT secret strength
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      if (jwtSecret.length >= 64) {
        this.addCheck('Security', 'JWT Secret Strength', 'pass',
          'JWT secret meets length requirements', false);
      } else if (jwtSecret.length >= 32) {
        this.addCheck('Security', 'JWT Secret Strength', 'warning',
          'JWT secret length is adequate but could be stronger', false);
      } else {
        this.addCheck('Security', 'JWT Secret Strength', 'fail',
          'JWT secret is too short (minimum 32 characters)', true);
      }
    }
  }

  private async validateServiceHealth(): Promise<void> {
    console.log('🏥 Validating Service Health...');

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        timeout: 10000
      });

      if (response.ok) {
        const healthData = await response.json();
        this.addCheck('Service Health', 'Health Endpoint', 'pass',
          'Health endpoint responding correctly', false);

        // Check health endpoint structure
        if (healthData.status && healthData.timestamp) {
          this.addCheck('Service Health', 'Health Data Structure', 'pass',
            'Health endpoint returns proper structure', false);
        } else {
          this.addCheck('Service Health', 'Health Data Structure', 'warning',
            'Health endpoint missing required fields', false);
        }

        // Check dependencies status
        if (healthData.dependencies) {
          Object.entries(healthData.dependencies).forEach(([dep, status]) => {
            const isHealthy = status === 'connected' || status === 'healthy';
            this.addCheck('Service Health', `Dependency: ${dep}`, 
              isHealthy ? 'pass' : 'fail',
              `${dep} status: ${status}`, !isHealthy);
          });
        }
      } else {
        this.addCheck('Service Health', 'Health Endpoint', 'fail',
          `Health endpoint returned ${response.status}`, true);
      }
    } catch (error) {
      this.addCheck('Service Health', 'Health Endpoint', 'fail',
        'Health endpoint not accessible or not responding', true);
    }

    // Check if service is binding to correct port
    const expectedPort = process.env.PORT || 3000;
    try {
      const response = await fetch(`${this.baseUrl.replace(/:\d+/, `:${expectedPort}`)}/health`);
      if (response.ok) {
        this.addCheck('Service Health', 'Port Configuration', 'pass',
          `Service correctly bound to port ${expectedPort}`, false);
      }
    } catch (error) {
      this.addCheck('Service Health', 'Port Configuration', 'warning',
        'Could not verify port configuration', false);
    }
  }

  private async validateDatabase(): Promise<void> {
    console.log('🗄️ Validating Database Configuration...');

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.addCheck('Database', 'Database URL', 'fail',
        'DATABASE_URL not configured', true);
      return;
    }

    try {
      // Basic URL validation
      const url = new URL(databaseUrl);
      if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
        this.addCheck('Database', 'Database URL Format', 'pass',
          'Database URL format is valid', false);
      } else {
        this.addCheck('Database', 'Database URL Format', 'fail',
          'Database URL is not a valid PostgreSQL connection string', true);
      }

      // Check if SSL is properly configured for production
      if (this.environment === 'production' && !databaseUrl.includes('sslmode=require')) {
        this.addCheck('Database', 'SSL Configuration', 'warning',
          'SSL not explicitly required for production database', false);
      }
    } catch (error) {
      this.addCheck('Database', 'Database URL Format', 'fail',
        'Database URL format is invalid', true);
    }

    // Check database pool configuration
    const poolSize = process.env.DATABASE_POOL_SIZE;
    if (poolSize) {
      const size = parseInt(poolSize);
      if (size >= 5 && size <= 50) {
        this.addCheck('Database', 'Connection Pool Size', 'pass',
          `Pool size (${size}) is within recommended range`, false);
      } else {
        this.addCheck('Database', 'Connection Pool Size', 'warning',
          `Pool size (${size}) may not be optimal`, false);
      }
    }
  }

  private async validateCache(): Promise<void> {
    console.log('💾 Validating Cache Configuration...');

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.addCheck('Cache', 'Redis URL', 'fail',
        'REDIS_URL not configured', true);
      return;
    }

    try {
      // Basic URL validation
      new URL(redisUrl);
      this.addCheck('Cache', 'Redis URL Format', 'pass',
        'Redis URL format is valid', false);
    } catch (error) {
      this.addCheck('Cache', 'Redis URL Format', 'fail',
        'Redis URL format is invalid', true);
    }

    // Check Redis memory configuration
    const maxMemory = process.env.REDIS_MAX_MEMORY;
    if (maxMemory) {
      this.addCheck('Cache', 'Memory Configuration', 'pass',
        `Redis memory limit configured: ${maxMemory}`, false);
    } else {
      this.addCheck('Cache', 'Memory Configuration', 'warning',
        'Redis memory limit not explicitly configured', false);
    }
  }

  private async validateExternalDependencies(): Promise<void> {
    console.log('🌐 Validating External Dependencies...');

    // Check primary API key
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (alchemyKey && alchemyKey.length > 20) {
      this.addCheck('External Dependencies', 'Alchemy API Key', 'pass',
        'Alchemy API key is configured', false);
    } else {
      const isCritical = this.environment === 'production';
      this.addCheck('External Dependencies', 'Alchemy API Key', 
        isCritical ? 'fail' : 'warning',
        'Alchemy API key is missing or invalid', isCritical);
    }

    // Check optional API keys
    const optionalKeys = [
      'MORALIS_API_KEY',
      'QUICKNODE_API_KEY',
      'OPENSEA_API_KEY',
      'COINGECKO_API_KEY'
    ];

    let configuredOptionalKeys = 0;
    optionalKeys.forEach(keyName => {
      if (process.env[keyName]) {
        configuredOptionalKeys++;
        this.addCheck('External Dependencies', keyName, 'pass',
          'Optional API key configured', false);
      }
    });

    if (configuredOptionalKeys > 0) {
      this.addCheck('External Dependencies', 'Redundancy', 'pass',
        `${configuredOptionalKeys} backup API providers configured`, false);
    } else {
      this.addCheck('External Dependencies', 'Redundancy', 'warning',
        'No backup API providers configured', false);
    }
  }

  private async validateMonitoring(): Promise<void> {
    console.log('📊 Validating Monitoring Configuration...');

    // Check if metrics endpoint is accessible
    try {
      const metricsPort = process.env.METRICS_PORT || 9090;
      const metricsUrl = `${this.baseUrl.replace(/:\d+/, `:${metricsPort}`)}/metrics`;
      const response = await fetch(metricsUrl, { timeout: 5000 });

      if (response.ok) {
        this.addCheck('Monitoring', 'Metrics Endpoint', 'pass',
          'Metrics endpoint is accessible', false);
      } else {
        this.addCheck('Monitoring', 'Metrics Endpoint', 'warning',
          'Metrics endpoint not accessible', false);
      }
    } catch (error) {
      this.addCheck('Monitoring', 'Metrics Endpoint', 'warning',
        'Could not access metrics endpoint', false);
    }

    // Check if monitoring files exist
    const monitoringFiles = [
      'monitoring/grafana-dashboard.json',
      'monitoring/alerts.yml',
      'monitoring/setup-monitoring.sh'
    ];

    for (const file of monitoringFiles) {
      try {
        await fs.access(file);
        this.addCheck('Monitoring', `Monitoring Config: ${path.basename(file)}`, 'pass',
          `${file} exists`, false);
      } catch (error) {
        this.addCheck('Monitoring', `Monitoring Config: ${path.basename(file)}`, 'warning',
          `${file} not found`, false);
      }
    }

    // Check Sentry configuration for production
    if (this.environment === 'production') {
      const sentryDsn = process.env.SENTRY_DSN;
      if (sentryDsn) {
        this.addCheck('Monitoring', 'Error Tracking', 'pass',
          'Sentry error tracking configured', false);
      } else {
        this.addCheck('Monitoring', 'Error Tracking', 'warning',
          'Sentry error tracking not configured', false);
      }
    }
  }

  private async validatePerformance(): Promise<void> {
    console.log('⚡ Validating Performance Configuration...');

    // Check if performance testing scripts exist
    const perfScripts = [
      'scripts/load-test.ts',
      'scripts/benchmark.ts',
      'scripts/performance-profiler.ts'
    ];

    for (const script of perfScripts) {
      try {
        await fs.access(script);
        this.addCheck('Performance', `Performance Script: ${path.basename(script)}`, 'pass',
          `${script} available`, false);
      } catch (error) {
        this.addCheck('Performance', `Performance Script: ${path.basename(script)}`, 'warning',
          `${script} not found`, false);
      }
    }

    // Check performance configuration
    const maxConcurrent = process.env.MAX_CONCURRENT_REQUESTS;
    if (maxConcurrent) {
      const limit = parseInt(maxConcurrent);
      if (limit > 0 && limit <= 1000) {
        this.addCheck('Performance', 'Concurrency Limit', 'pass',
          `Concurrency limit set to ${limit}`, false);
      } else {
        this.addCheck('Performance', 'Concurrency Limit', 'warning',
          `Concurrency limit (${limit}) may be too high`, false);
      }
    }

    // Check timeout configuration
    const requestTimeout = process.env.REQUEST_TIMEOUT;
    if (requestTimeout) {
      const timeout = parseInt(requestTimeout);
      if (timeout >= 5000 && timeout <= 60000) {
        this.addCheck('Performance', 'Request Timeout', 'pass',
          `Request timeout set to ${timeout}ms`, false);
      } else {
        this.addCheck('Performance', 'Request Timeout', 'warning',
          `Request timeout (${timeout}ms) may not be optimal`, false);
      }
    }
  }

  private async validateDocumentation(): Promise<void> {
    console.log('📚 Validating Documentation...');

    const docFiles = [
      'README.md',
      'docs/production/deployment-guide.md',
      'docs/api/openapi-spec.yaml'
    ];

    for (const file of docFiles) {
      try {
        await fs.access(file);
        this.addCheck('Documentation', `Documentation: ${path.basename(file)}`, 'pass',
          `${file} exists`, false);
      } catch (error) {
        this.addCheck('Documentation', `Documentation: ${path.basename(file)}`, 'warning',
          `${file} not found`, false);
      }
    }

    // Check if API documentation is valid
    try {
      await execAsync('npm run docs:validate');
      this.addCheck('Documentation', 'API Documentation Validation', 'pass',
        'API documentation is valid', false);
    } catch (error) {
      this.addCheck('Documentation', 'API Documentation Validation', 'warning',
        'API documentation validation failed', false);
    }
  }

  private addCheck(category: string, name: string, status: 'pass' | 'fail' | 'warning' | 'skip', 
                  message: string, critical: boolean, details?: string): void {
    this.checks.push({
      category,
      name,
      status,
      message,
      details,
      critical
    });
  }

  private generateReport(): DeploymentValidationResult {
    const passed = this.checks.filter(c => c.status === 'pass').length;
    const failed = this.checks.filter(c => c.status === 'fail').length;
    const warnings = this.checks.filter(c => c.status === 'warning').length;
    const skipped = this.checks.filter(c => c.status === 'skip').length;

    const criticalFailures = this.checks.filter(c => c.critical && c.status === 'fail').length;

    let overallStatus: 'ready' | 'needs-attention' | 'not-ready';
    if (criticalFailures > 0) {
      overallStatus = 'not-ready';
    } else if (failed > 0 || warnings > 5) {
      overallStatus = 'needs-attention';
    } else {
      overallStatus = 'ready';
    }

    // Generate recommendations
    if (criticalFailures > 0) {
      this.recommendations.push('🚨 CRITICAL: Fix all critical failures before deployment');
    }
    
    if (failed > 0) {
      this.recommendations.push('Address all failed checks before production deployment');
    }
    
    if (warnings > 3) {
      this.recommendations.push('Review and resolve warnings to improve deployment reliability');
    }

    this.recommendations.push('Perform final integration testing in staging environment');
    this.recommendations.push('Execute load testing with production-like traffic');
    this.recommendations.push('Verify monitoring and alerting are functional');
    this.recommendations.push('Ensure rollback procedures are tested and ready');

    return {
      timestamp: new Date().toISOString(),
      environment: this.environment,
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

  printReport(result: DeploymentValidationResult): void {
    console.log('\n🎯 Deployment Validation Report');
    console.log('=' .repeat(80));
    console.log(`📅 Timestamp: ${result.timestamp}`);
    console.log(`🌍 Environment: ${result.environment}`);
    console.log(`📊 Overall Status: ${this.getStatusEmoji(result.overallStatus)} ${result.overallStatus.toUpperCase()}`);
    console.log(`📈 Summary: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.warnings} warnings, ${result.summary.skipped} skipped`);

    // Group checks by category
    const categories = [...new Set(result.checks.map(c => c.category))];
    
    for (const category of categories) {
      console.log(`\n📋 ${category}:`);
      const categoryChecks = result.checks.filter(c => c.category === category);
      
      for (const check of categoryChecks) {
        const emoji = this.getCheckEmoji(check.status);
        console.log(`  ${emoji} ${check.name}: ${check.message}`);
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
      console.log('✅ Deployment validation passed! System is ready for deployment.');
    } else if (result.overallStatus === 'needs-attention') {
      console.log('⚠️  Deployment needs attention. Review warnings and failures before proceeding.');
    } else {
      console.log('❌ Deployment validation failed! Critical issues must be resolved.');
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

  async saveReport(result: DeploymentValidationResult): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'deployment-validation-reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `deployment-validation-${result.environment}-${timestamp}.json`;
    const filePath = path.join(reportsDir, filename);
    
    await fs.writeFile(filePath, JSON.stringify(result, null, 2));
    
    return filePath;
  }
}

// CLI interface
async function main() {
  const baseUrl = process.argv[2] || process.env.SERVICE_URL;
  const environment = process.argv[3] || process.env.NODE_ENV;
  
  const validator = new DeploymentValidator(baseUrl, environment);
  
  try {
    const result = await validator.validateDeployment();
    
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
    console.error('❌ Deployment validation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { DeploymentValidator, DeploymentValidationResult };