#!/usr/bin/env tsx
/**
 * Production Readiness Validation
 * Comprehensive check of all system components for production deployment
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ValidationResult {
  category: string;
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: string;
  }>;
}

interface ProductionReadinessReport {
  timestamp: string;
  overallStatus: 'ready' | 'needs-attention' | 'not-ready';
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  validationResults: ValidationResult[];
  recommendations: string[];
}

class ProductionReadinessValidator {
  private results: ValidationResult[] = [];
  private recommendations: string[] = [];

  async runAllValidations(): Promise<ProductionReadinessReport> {
    console.log('🔍 Starting Production Readiness Validation...');
    console.log('=' .repeat(60));

    // Core Infrastructure Checks
    await this.validateInfrastructure();
    
    // Application Architecture Checks
    await this.validateArchitecture();
    
    // Security Checks
    await this.validateSecurity();
    
    // Performance Checks
    await this.validatePerformance();
    
    // Monitoring & Observability Checks
    await this.validateMonitoring();
    
    // Event-Driven Architecture Checks
    await this.validateEventDrivenArchitecture();
    
    // Code Quality Checks
    await this.validateCodeQuality();
    
    // Configuration Checks
    await this.validateConfiguration();
    
    // Documentation Checks
    await this.validateDocumentation();

    return this.generateReport();
  }

  private async validateInfrastructure(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check Docker configuration
    try {
      await fs.access('Dockerfile');
      checks.push({
        name: 'Docker Configuration',
        status: 'pass',
        message: 'Dockerfile exists'
      });
    } catch {
      checks.push({
        name: 'Docker Configuration',
        status: 'fail',
        message: 'Dockerfile not found',
        details: 'Create Dockerfile for containerized deployment'
      });
      this.recommendations.push('Create Dockerfile for containerized deployment');
    }

    // Check Kubernetes manifests
    try {
      await fs.access('k8s');
      checks.push({
        name: 'Kubernetes Manifests',
        status: 'pass',
        message: 'Kubernetes configuration directory exists'
      });
    } catch {
      checks.push({
        name: 'Kubernetes Manifests',
        status: 'warning',
        message: 'Kubernetes manifests not found',
        details: 'Consider adding k8s/ directory with deployment manifests'
      });
    }

    // Check monitoring setup
    try {
      await fs.access('monitoring/setup-monitoring.sh');
      checks.push({
        name: 'Monitoring Infrastructure',
        status: 'pass',
        message: 'Monitoring setup script exists'
      });
    } catch {
      checks.push({
        name: 'Monitoring Infrastructure',
        status: 'fail',
        message: 'Monitoring setup not found'
      });
    }

    // Check environment configuration
    try {
      await fs.access('.env.example');
      checks.push({
        name: 'Environment Configuration',
        status: 'pass',
        message: 'Environment template exists'
      });
    } catch {
      checks.push({
        name: 'Environment Configuration',
        status: 'warning',
        message: '.env.example not found',
        details: 'Create environment template for deployment guidance'
      });
    }

    this.results.push({
      category: 'Infrastructure',
      checks
    });
  }

  private async validateArchitecture(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check hexagonal architecture structure
    const requiredDirs = [
      'src/app/ports',
      'src/adapters/inbound',
      'src/adapters/outbound',
      'src/events'
    ];

    for (const dir of requiredDirs) {
      try {
        await fs.access(dir);
        checks.push({
          name: `Hexagonal Architecture - ${dir}`,
          status: 'pass',
          message: `${dir} directory exists`
        });
      } catch {
        checks.push({
          name: `Hexagonal Architecture - ${dir}`,
          status: 'fail',
          message: `${dir} directory missing`,
          details: 'Hexagonal architecture requires proper port/adapter separation'
        });
      }
    }

    // Check event bus implementations
    try {
      await fs.access('src/adapters/outbound/event-bus/InMemoryEventBusAdapter.ts');
      await fs.access('src/adapters/outbound/event-bus/BullMQEventBusAdapter.ts');
      checks.push({
        name: 'Event Bus Implementations',
        status: 'pass',
        message: 'Both in-memory and BullMQ event bus adapters exist'
      });
    } catch {
      checks.push({
        name: 'Event Bus Implementations',
        status: 'fail',
        message: 'Missing event bus adapter implementations'
      });
    }

    // Check async portfolio service
    try {
      await fs.access('src/services/AsyncPortfolioService.ts');
      checks.push({
        name: 'Async Portfolio Service',
        status: 'pass',
        message: 'Async portfolio service exists'
      });
    } catch {
      checks.push({
        name: 'Async Portfolio Service',
        status: 'fail',
        message: 'Async portfolio service missing'
      });
    }

    // Check cost optimization service
    try {
      await fs.access('src/services/CostOptimizationService.ts');
      checks.push({
        name: 'Cost Optimization Service',
        status: 'pass',
        message: 'Cost optimization service exists'
      });
    } catch {
      checks.push({
        name: 'Cost Optimization Service',
        status: 'fail',
        message: 'Cost optimization service missing'
      });
    }

    this.results.push({
      category: 'Architecture',
      checks
    });
  }

  private async validateSecurity(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check for hardcoded secrets
    try {
      const { stdout } = await execAsync('grep -r "password\|secret\|key\|token" src/ --include="*.ts" --include="*.js" | grep -v "process.env" | wc -l');
      const count = parseInt(stdout.trim());
      
      if (count === 0) {
        checks.push({
          name: 'Hardcoded Secrets',
          status: 'pass',
          message: 'No hardcoded secrets found'
        });
      } else {
        checks.push({
          name: 'Hardcoded Secrets',
          status: 'fail',
          message: `Found ${count} potential hardcoded secrets`,
          details: 'Use environment variables for all sensitive data'
        });
        this.recommendations.push('Remove hardcoded secrets and use environment variables');
      }
    } catch {
      checks.push({
        name: 'Hardcoded Secrets',
        status: 'warning',
        message: 'Could not scan for hardcoded secrets'
      });
    }

    // Check for security middleware
    try {
      const appFile = await fs.readFile('src/index.ts', 'utf-8');
      const hasHelmet = appFile.includes('helmet');
      const hasCors = appFile.includes('cors');
      const hasRateLimit = appFile.includes('rate');

      if (hasHelmet && hasCors && hasRateLimit) {
        checks.push({
          name: 'Security Middleware',
          status: 'pass',
          message: 'Security middleware properly configured'
        });
      } else {
        const missing = [];
        if (!hasHelmet) missing.push('helmet');
        if (!hasCors) missing.push('cors');
        if (!hasRateLimit) missing.push('rate limiting');
        
        checks.push({
          name: 'Security Middleware',
          status: 'warning',
          message: `Missing security middleware: ${missing.join(', ')}`,
          details: 'Ensure helmet, CORS, and rate limiting are configured'
        });
      }
    } catch {
      checks.push({
        name: 'Security Middleware',
        status: 'warning',
        message: 'Could not verify security middleware configuration'
      });
    }

    // Check for input validation
    try {
      const routeFiles = await fs.readdir('src/routes');
      let hasValidation = false;
      
      for (const file of routeFiles) {
        if (file.endsWith('.ts')) {
          const content = await fs.readFile(`src/routes/${file}`, 'utf-8');
          if (content.includes('zod') || content.includes('joi') || content.includes('validator')) {
            hasValidation = true;
            break;
          }
        }
      }

      if (hasValidation) {
        checks.push({
          name: 'Input Validation',
          status: 'pass',
          message: 'Input validation implemented in routes'
        });
      } else {
        checks.push({
          name: 'Input Validation',
          status: 'warning',
          message: 'Input validation not detected in routes',
          details: 'Implement input validation using Zod or similar library'
        });
      }
    } catch {
      checks.push({
        name: 'Input Validation',
        status: 'warning',
        message: 'Could not verify input validation'
      });
    }

    this.results.push({
      category: 'Security',
      checks
    });
  }

  private async validatePerformance(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check for performance testing scripts
    const performanceScripts = [
      'scripts/load-test.ts',
      'scripts/benchmark.ts',
      'scripts/performance-profiler.ts'
    ];

    for (const script of performanceScripts) {
      try {
        await fs.access(script);
        checks.push({
          name: `Performance Testing - ${path.basename(script)}`,
          status: 'pass',
          message: `${script} exists`
        });
      } catch {
        checks.push({
          name: `Performance Testing - ${path.basename(script)}`,
          status: 'fail',
          message: `${script} missing`,
          details: 'Performance testing scripts are required for production readiness'
        });
      }
    }

    // Check for caching implementation
    try {
      const serviceFiles = await fs.readdir('src/services');
      let hasCaching = false;
      
      for (const file of serviceFiles) {
        if (file.endsWith('.ts')) {
          const content = await fs.readFile(`src/services/${file}`, 'utf-8');
          if (content.includes('cache') || content.includes('redis')) {
            hasCaching = true;
            break;
          }
        }
      }

      if (hasCaching) {
        checks.push({
          name: 'Caching Implementation',
          status: 'pass',
          message: 'Caching mechanisms detected'
        });
      } else {
        checks.push({
          name: 'Caching Implementation',
          status: 'warning',
          message: 'No caching implementation detected',
          details: 'Implement caching for improved performance'
        });
      }
    } catch {
      checks.push({
        name: 'Caching Implementation',
        status: 'warning',
        message: 'Could not verify caching implementation'
      });
    }

    this.results.push({
      category: 'Performance',
      checks
    });
  }

  private async validateMonitoring(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check for monitoring configuration
    const monitoringFiles = [
      'monitoring/grafana-dashboard.json',
      'monitoring/alerts.yml',
      'monitoring/setup-monitoring.sh'
    ];

    for (const file of monitoringFiles) {
      try {
        await fs.access(file);
        checks.push({
          name: `Monitoring Config - ${path.basename(file)}`,
          status: 'pass',
          message: `${file} exists`
        });
      } catch {
        checks.push({
          name: `Monitoring Config - ${path.basename(file)}`,
          status: 'fail',
          message: `${file} missing`,
          details: 'Complete monitoring setup is required for production'
        });
      }
    }

    // Check for metrics implementation
    try {
      const indexFile = await fs.readFile('src/index.ts', 'utf-8');
      const hasMetrics = indexFile.includes('prom-client') || indexFile.includes('metrics');

      if (hasMetrics) {
        checks.push({
          name: 'Metrics Collection',
          status: 'pass',
          message: 'Metrics collection implemented'
        });
      } else {
        checks.push({
          name: 'Metrics Collection',
          status: 'warning',
          message: 'Metrics collection not detected',
          details: 'Implement Prometheus metrics for monitoring'
        });
      }
    } catch {
      checks.push({
        name: 'Metrics Collection',
        status: 'warning',
        message: 'Could not verify metrics implementation'
      });
    }

    // Check for health check endpoint
    try {
      const routeFiles = await fs.readdir('src/routes');
      let hasHealthCheck = false;
      
      for (const file of routeFiles) {
        if (file.includes('health') || file.includes('status')) {
          hasHealthCheck = true;
          break;
        }
      }

      if (hasHealthCheck) {
        checks.push({
          name: 'Health Check Endpoint',
          status: 'pass',
          message: 'Health check endpoint exists'
        });
      } else {
        checks.push({
          name: 'Health Check Endpoint',
          status: 'fail',
          message: 'Health check endpoint missing',
          details: 'Implement /health endpoint for monitoring'
        });
      }
    } catch {
      checks.push({
        name: 'Health Check Endpoint',
        status: 'warning',
        message: 'Could not verify health check endpoint'
      });
    }

    this.results.push({
      category: 'Monitoring & Observability',
      checks
    });
  }

  private async validateEventDrivenArchitecture(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check event contracts
    try {
      await fs.access('src/events/contracts');
      const contracts = await fs.readdir('src/events/contracts');
      
      if (contracts.length > 0) {
        checks.push({
          name: 'Event Contracts',
          status: 'pass',
          message: `${contracts.length} event contracts defined`
        });
      } else {
        checks.push({
          name: 'Event Contracts',
          status: 'warning',
          message: 'No event contracts found',
          details: 'Define event contracts for type safety'
        });
      }
    } catch {
      checks.push({
        name: 'Event Contracts',
        status: 'fail',
        message: 'Event contracts directory missing'
      });
    }

    // Check event versioning
    try {
      const contractsDir = 'src/events/contracts';
      const contracts = await fs.readdir(contractsDir);
      let hasVersioning = false;
      
      for (const contract of contracts) {
        if (contract.includes('V1') || contract.includes('V2')) {
          hasVersioning = true;
          break;
        }
      }

      if (hasVersioning) {
        checks.push({
          name: 'Event Versioning',
          status: 'pass',
          message: 'Event versioning implemented'
        });
      } else {
        checks.push({
          name: 'Event Versioning',
          status: 'warning',
          message: 'Event versioning not detected',
          details: 'Implement event versioning for backward compatibility'
        });
      }
    } catch {
      checks.push({
        name: 'Event Versioning',
        status: 'warning',
        message: 'Could not verify event versioning'
      });
    }

    // Check workers
    try {
      await fs.access('src/workers');
      const workers = await fs.readdir('src/workers');
      
      if (workers.length > 0) {
        checks.push({
          name: 'Event Workers',
          status: 'pass',
          message: `${workers.length} event workers implemented`
        });
      } else {
        checks.push({
          name: 'Event Workers',
          status: 'warning',
          message: 'No event workers found'
        });
      }
    } catch {
      checks.push({
        name: 'Event Workers',
        status: 'fail',
        message: 'Workers directory missing'
      });
    }

    this.results.push({
      category: 'Event-Driven Architecture',
      checks
    });
  }

  private async validateCodeQuality(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check TypeScript configuration
    try {
      await fs.access('tsconfig.json');
      checks.push({
        name: 'TypeScript Configuration',
        status: 'pass',
        message: 'tsconfig.json exists'
      });
    } catch {
      checks.push({
        name: 'TypeScript Configuration',
        status: 'fail',
        message: 'tsconfig.json missing'
      });
    }

    // Check ESLint configuration
    try {
      await fs.access('.eslintrc.js');
      checks.push({
        name: 'ESLint Configuration',
        status: 'pass',
        message: 'ESLint configuration exists'
      });
    } catch {
      try {
        await fs.access('.eslintrc.json');
        checks.push({
          name: 'ESLint Configuration',
          status: 'pass',
          message: 'ESLint configuration exists'
        });
      } catch {
        checks.push({
          name: 'ESLint Configuration',
          status: 'warning',
          message: 'ESLint configuration missing',
          details: 'Configure ESLint for code quality enforcement'
        });
      }
    }

    // Check test coverage
    try {
      await fs.access('tests');
      const testFiles = await fs.readdir('tests', { recursive: true });
      const testCount = testFiles.filter(file => file.toString().endsWith('.test.ts')).length;
      
      if (testCount > 10) {
        checks.push({
          name: 'Test Coverage',
          status: 'pass',
          message: `${testCount} test files found`
        });
      } else if (testCount > 0) {
        checks.push({
          name: 'Test Coverage',
          status: 'warning',
          message: `Only ${testCount} test files found`,
          details: 'Increase test coverage for production readiness'
        });
      } else {
        checks.push({
          name: 'Test Coverage',
          status: 'fail',
          message: 'No test files found',
          details: 'Implement comprehensive test suite'
        });
      }
    } catch {
      checks.push({
        name: 'Test Coverage',
        status: 'fail',
        message: 'Tests directory missing'
      });
    }

    this.results.push({
      category: 'Code Quality',
      checks
    });
  }

  private async validateConfiguration(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check configuration structure
    try {
      await fs.access('src/config/index.ts');
      checks.push({
        name: 'Configuration Structure',
        status: 'pass',
        message: 'Configuration module exists'
      });
    } catch {
      checks.push({
        name: 'Configuration Structure',
        status: 'fail',
        message: 'Configuration module missing'
      });
    }

    // Check environment validation
    try {
      const configFile = await fs.readFile('src/config/index.ts', 'utf-8');
      const hasValidation = configFile.includes('zod') || configFile.includes('joi');

      if (hasValidation) {
        checks.push({
          name: 'Environment Validation',
          status: 'pass',
          message: 'Environment validation implemented'
        });
      } else {
        checks.push({
          name: 'Environment Validation',
          status: 'warning',
          message: 'Environment validation not detected',
          details: 'Implement environment variable validation'
        });
      }
    } catch {
      checks.push({
        name: 'Environment Validation',
        status: 'warning',
        message: 'Could not verify environment validation'
      });
    }

    this.results.push({
      category: 'Configuration',
      checks
    });
  }

  private async validateDocumentation(): Promise<void> {
    const checks: ValidationResult['checks'] = [];

    // Check for README
    try {
      await fs.access('README.md');
      checks.push({
        name: 'README Documentation',
        status: 'pass',
        message: 'README.md exists'
      });
    } catch {
      checks.push({
        name: 'README Documentation',
        status: 'warning',
        message: 'README.md missing',
        details: 'Create comprehensive README for deployment guidance'
      });
    }

    // Check for API documentation
    try {
      const hasSwagger = await fs.access('src/swagger.ts').then(() => true).catch(() => false);
      const hasApiDocs = await fs.access('docs/api.md').then(() => true).catch(() => false);

      if (hasSwagger || hasApiDocs) {
        checks.push({
          name: 'API Documentation',
          status: 'pass',
          message: 'API documentation exists'
        });
      } else {
        checks.push({
          name: 'API Documentation',
          status: 'warning',
          message: 'API documentation missing',
          details: 'Document API endpoints for integration'
        });
      }
    } catch {
      checks.push({
        name: 'API Documentation',
        status: 'warning',
        message: 'Could not verify API documentation'
      });
    }

    // Check for performance guide
    try {
      await fs.access('docs/performance-guide.md');
      checks.push({
        name: 'Performance Guide',
        status: 'pass',
        message: 'Performance guide exists'
      });
    } catch {
      checks.push({
        name: 'Performance Guide',
        status: 'warning',
        message: 'Performance guide missing',
        details: 'Document performance testing and optimization'
      });
    }

    this.results.push({
      category: 'Documentation',
      checks
    });
  }

  private generateReport(): ProductionReadinessReport {
    const allChecks = this.results.flatMap(result => result.checks);
    const passed = allChecks.filter(check => check.status === 'pass').length;
    const failed = allChecks.filter(check => check.status === 'fail').length;
    const warnings = allChecks.filter(check => check.status === 'warning').length;

    let overallStatus: 'ready' | 'needs-attention' | 'not-ready';
    
    if (failed === 0 && warnings <= 3) {
      overallStatus = 'ready';
    } else if (failed <= 2) {
      overallStatus = 'needs-attention';
    } else {
      overallStatus = 'not-ready';
    }

    // Add general recommendations
    if (failed > 0) {
      this.recommendations.push('Address all critical failures before production deployment');
    }
    
    if (warnings > 5) {
      this.recommendations.push('Review and address warnings to improve production readiness');
    }

    this.recommendations.push('Perform load testing before production deployment');
    this.recommendations.push('Set up monitoring alerts and verify they work correctly');
    this.recommendations.push('Create deployment runbook with rollback procedures');

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      summary: {
        totalChecks: allChecks.length,
        passed,
        failed,
        warnings
      },
      validationResults: this.results,
      recommendations: [...new Set(this.recommendations)] // Remove duplicates
    };
  }

  async saveReport(report: ProductionReadinessReport): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'production-readiness-reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `production-readiness-${timestamp}.json`;
    const filePath = path.join(reportsDir, filename);
    
    await fs.writeFile(filePath, JSON.stringify(report, null, 2));
    
    return filePath;
  }

  printReport(report: ProductionReadinessReport): void {
    console.log('\n🎯 Production Readiness Report');
    console.log('=' .repeat(60));
    console.log(`Overall Status: ${this.getStatusEmoji(report.overallStatus)} ${report.overallStatus.toUpperCase()}`);
    console.log(`Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`);
    console.log('');

    // Print results by category
    for (const categoryResult of report.validationResults) {
      console.log(`\n📋 ${categoryResult.category}:`);
      
      for (const check of categoryResult.checks) {
        const emoji = this.getCheckEmoji(check.status);
        console.log(`  ${emoji} ${check.name}: ${check.message}`);
        
        if (check.details) {
          console.log(`    → ${check.details}`);
        }
      }
    }

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }

    console.log('\n' + '=' .repeat(60));
    
    if (report.overallStatus === 'ready') {
      console.log('✅ System is production ready!');
    } else if (report.overallStatus === 'needs-attention') {
      console.log('⚠️ System needs attention before production deployment');
    } else {
      console.log('❌ System is not ready for production deployment');
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
      default: return '❓';
    }
  }
}

// CLI interface
async function runProductionReadinessCheck(): Promise<void> {
  const validator = new ProductionReadinessValidator();
  
  try {
    const report = await validator.runAllValidations();
    
    validator.printReport(report);
    
    const reportPath = await validator.saveReport(report);
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    // Exit with appropriate code
    if (report.overallStatus === 'not-ready') {
      process.exit(1);
    } else if (report.overallStatus === 'needs-attention') {
      process.exit(2);
    } else {
      process.exit(0);
    }
    
  } catch (error) {
    console.error('Production readiness check failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runProductionReadinessCheck();
}

export { ProductionReadinessValidator, ProductionReadinessReport };
