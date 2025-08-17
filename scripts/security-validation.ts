#!/usr/bin/env tsx
/**
 * Security Validation Script
 * Validates all security measures before production deployment
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import fetch from 'node-fetch';

interface SecurityCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  critical: boolean;
}

class SecurityValidator {
  private checks: SecurityCheck[] = [];
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async runAllChecks(): Promise<void> {
    console.log('🔒 Running Security Validation Checks...\n');

    await this.checkHardcodedSecrets();
    await this.checkEnvironmentConfiguration();
    await this.checkSecurityHeaders();
    await this.checkSwaggerProtection();
    await this.checkCORSConfiguration();
    await this.checkRateLimiting();
    await this.checkErrorHandling();
    
    this.printResults();
    this.evaluateResults();
  }

  private async checkHardcodedSecrets(): Promise<void> {
    try {
      // Check for potential hardcoded secrets in source code
      const result = execSync(
        'grep -r "password\\|secret\\|key\\|token" src/ --include="*.ts" --include="*.js" | grep -v "process.env" | wc -l',
        { encoding: 'utf8' }
      ).trim();
      
      const count = parseInt(result);
      
      if (count === 0) {
        this.addCheck('Hardcoded Secrets', 'PASS', 'No hardcoded secrets found', true);
      } else {
        this.addCheck('Hardcoded Secrets', 'FAIL', `Found ${count} potential hardcoded secrets`, true);
      }
    } catch (error) {
      this.addCheck('Hardcoded Secrets', 'WARN', 'Could not scan for hardcoded secrets', true);
    }
  }

  private async checkEnvironmentConfiguration(): Promise<void> {
    const nodeEnv = process.env.NODE_ENV;
    
    // Check NODE_ENV
    if (nodeEnv === 'production') {
      this.addCheck('Environment', 'PASS', 'NODE_ENV correctly set to production', true);
    } else {
      this.addCheck('Environment', 'WARN', `NODE_ENV is ${nodeEnv}, not production`, false);
    }

    // Check required production environment variables
    const requiredProdVars = [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'ALCHEMY_API_KEY'
    ];

    const missing = requiredProdVars.filter(varName => !process.env[varName]);
    
    if (missing.length === 0) {
      this.addCheck('Required Variables', 'PASS', 'All required environment variables present', true);
    } else {
      this.addCheck('Required Variables', 'FAIL', `Missing: ${missing.join(', ')}`, true);
    }

    // Check Swagger configuration in production
    if (nodeEnv === 'production' && process.env.ENABLE_SWAGGER === 'true') {
      if (process.env.SWAGGER_ALLOWED_IPS) {
        this.addCheck('Swagger Security', 'WARN', 'Swagger enabled in production with IP restrictions', false);
      } else {
        this.addCheck('Swagger Security', 'FAIL', 'Swagger enabled in production without IP restrictions', true);
      }
    } else if (nodeEnv === 'production') {
      this.addCheck('Swagger Security', 'PASS', 'Swagger disabled in production', false);
    }

    // Check CORS origins
    const corsOrigins = process.env.CORS_ORIGINS;
    if (nodeEnv === 'production' && corsOrigins) {
      if (corsOrigins.includes('localhost') || corsOrigins.includes('*')) {
        this.addCheck('CORS Security', 'FAIL', 'Insecure CORS origins in production', true);
      } else {
        this.addCheck('CORS Security', 'PASS', 'CORS origins properly configured', false);
      }
    }
  }

  private async checkSecurityHeaders(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const headers = response.headers;

      // Check for critical security headers
      const requiredHeaders = [
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
        'strict-transport-security',
        'content-security-policy'
      ];

      const missingHeaders = requiredHeaders.filter(header => !headers.get(header));

      if (missingHeaders.length === 0) {
        this.addCheck('Security Headers', 'PASS', 'All critical security headers present', true);
      } else {
        this.addCheck('Security Headers', 'FAIL', `Missing headers: ${missingHeaders.join(', ')}`, true);
      }

      // Validate specific header values
      if (headers.get('x-content-type-options') !== 'nosniff') {
        this.addCheck('X-Content-Type-Options', 'FAIL', 'Header not set to nosniff', true);
      } else {
        this.addCheck('X-Content-Type-Options', 'PASS', 'Properly configured', false);
      }

      if (headers.get('referrer-policy') !== 'strict-origin-when-cross-origin') {
        this.addCheck('Referrer Policy', 'FAIL', 'Header not properly configured', true);
      } else {
        this.addCheck('Referrer Policy', 'PASS', 'Properly configured', false);
      }

      if (headers.get('x-frame-options') !== 'DENY') {
        this.addCheck('X-Frame-Options', 'FAIL', 'Header not set to DENY', true);
      } else {
        this.addCheck('X-Frame-Options', 'PASS', 'Properly configured', false);
      }

    } catch (error) {
      this.addCheck('Security Headers', 'FAIL', 'Could not verify security headers - server not running?', true);
    }
  }

  private async checkSwaggerProtection(): Promise<void> {
    try {
      // Test Swagger access without authentication
      const response = await fetch(`${this.baseUrl}/api-docs`);
      
      if (process.env.NODE_ENV === 'production') {
        if (response.status === 401) {
          this.addCheck('Swagger Protection', 'PASS', 'Swagger requires authentication in production', false);
        } else if (response.status === 404) {
          this.addCheck('Swagger Protection', 'PASS', 'Swagger disabled in production', false);
        } else {
          this.addCheck('Swagger Protection', 'FAIL', 'Swagger accessible without authentication in production', true);
        }
      } else {
        if (response.status === 200) {
          this.addCheck('Swagger Access', 'PASS', 'Swagger accessible in development', false);
        } else {
          this.addCheck('Swagger Access', 'WARN', 'Swagger not accessible', false);
        }
      }
    } catch (error) {
      this.addCheck('Swagger Protection', 'WARN', 'Could not test Swagger access', false);
    }
  }

  private async checkCORSConfiguration(): Promise<void> {
    try {
      // Test CORS with malicious origin
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: {
          'Origin': 'https://malicious-site.com'
        }
      });

      if (response.status === 403) {
        this.addCheck('CORS Protection', 'PASS', 'Malicious origins properly rejected', false);
      } else {
        this.addCheck('CORS Protection', 'FAIL', 'CORS allows unauthorized origins', true);
      }
    } catch (error) {
      this.addCheck('CORS Protection', 'WARN', 'Could not test CORS protection', false);
    }
  }

  private async checkRateLimiting(): Promise<void> {
    try {
      // Make multiple rapid requests to test rate limiting
      const requests = Array.from({ length: 10 }, () => 
        fetch(`${this.baseUrl}/api/protocols`)
      );

      const responses = await Promise.all(requests);
      const rateLimitedResponses = responses.filter(r => r.status === 429);

      if (rateLimitedResponses.length > 0) {
        this.addCheck('Rate Limiting', 'PASS', 'Rate limiting active', false);
      } else {
        this.addCheck('Rate Limiting', 'WARN', 'Rate limiting may not be working', false);
      }
    } catch (error) {
      this.addCheck('Rate Limiting', 'WARN', 'Could not test rate limiting', false);
    }
  }

  private async checkErrorHandling(): Promise<void> {
    try {
      // Test error response format
      const response = await fetch(`${this.baseUrl}/api/nonexistent`);
      const body = await response.json();

      // Check for information disclosure in errors
      const bodyStr = JSON.stringify(body);
      if (bodyStr.includes('stack') || bodyStr.includes('Error:')) {
        this.addCheck('Error Handling', 'FAIL', 'Error responses contain stack traces', true);
      } else if (body.success === false && body.error && body.metadata) {
        this.addCheck('Error Handling', 'PASS', 'Error responses properly formatted', false);
      } else {
        this.addCheck('Error Handling', 'WARN', 'Error response format unclear', false);
      }
    } catch (error) {
      this.addCheck('Error Handling', 'WARN', 'Could not test error handling', false);
    }
  }

  private addCheck(name: string, status: 'PASS' | 'FAIL' | 'WARN', message: string, critical: boolean): void {
    this.checks.push({ name, status, message, critical });
  }

  private printResults(): void {
    console.log('\n🔒 SECURITY VALIDATION RESULTS');
    console.log('='.repeat(80));

    const grouped = {
      critical: this.checks.filter(c => c.critical),
      standard: this.checks.filter(c => !c.critical)
    };

    console.log('\n🚨 CRITICAL SECURITY CHECKS:');
    grouped.critical.forEach(check => {
      const icon = check.status === 'PASS' ? '✅' : check.status === 'FAIL' ? '❌' : '⚠️';
      console.log(`${icon} ${check.name}: ${check.message}`);
    });

    console.log('\n📋 STANDARD SECURITY CHECKS:');
    grouped.standard.forEach(check => {
      const icon = check.status === 'PASS' ? '✅' : check.status === 'FAIL' ? '❌' : '⚠️';
      console.log(`${icon} ${check.name}: ${check.message}`);
    });

    // Summary
    const passed = this.checks.filter(c => c.status === 'PASS').length;
    const failed = this.checks.filter(c => c.status === 'FAIL').length;
    const warned = this.checks.filter(c => c.status === 'WARN').length;

    console.log('\n📊 SUMMARY:');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warned}`);
  }

  private evaluateResults(): void {
    const criticalFailures = this.checks.filter(c => c.critical && c.status === 'FAIL');
    const totalFailures = this.checks.filter(c => c.status === 'FAIL');

    console.log('\n🎯 SECURITY ASSESSMENT:');

    if (criticalFailures.length > 0) {
      console.log('❌ CRITICAL SECURITY FAILURES DETECTED');
      console.log('🚨 DO NOT DEPLOY TO PRODUCTION');
      console.log('\nCritical issues that must be fixed:');
      criticalFailures.forEach(check => {
        console.log(`  - ${check.name}: ${check.message}`);
      });
      process.exit(1);
    } else if (totalFailures.length > 0) {
      console.log('⚠️  SECURITY ISSUES DETECTED');
      console.log('🔧 Fix these issues before production deployment:');
      totalFailures.forEach(check => {
        console.log(`  - ${check.name}: ${check.message}`);
      });
      process.exit(2);
    } else {
      console.log('✅ ALL SECURITY CHECKS PASSED');
      console.log('🚀 Safe for production deployment');
      process.exit(0);
    }
  }
}

// CLI interface
async function main() {
  const baseUrl = process.argv[2] || process.env.TEST_BASE_URL || 'http://localhost:3000';
  
  console.log(`Testing security against: ${baseUrl}\n`);
  
  const validator = new SecurityValidator(baseUrl);
  await validator.runAllChecks();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Security validation failed:', error);
    process.exit(1);
  });
}

export { SecurityValidator };