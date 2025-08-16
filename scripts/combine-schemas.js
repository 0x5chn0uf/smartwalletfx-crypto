#!/usr/bin/env node

/**
 * Schema Combiner for Prisma Multi-File Setup
 * 
 * Combines multiple .prisma files into a single schema.prisma file
 * while maintaining proper organization and comments.
 */

const fs = require('fs');
const path = require('path');

const SCHEMAS_DIR = path.join(__dirname, '../prisma/schemas');
const OUTPUT_FILE = path.join(__dirname, '../prisma/schema.prisma');

// Define the order of schema files to include
const SCHEMA_FILES = [
  'base.prisma',      // Generator and datasource
  'core.prisma',      // Core entities (UserWallet, Token, etc.)
  'portfolio.prisma', // Portfolio management
  'defi.prisma',      // DeFi positions and protocols
  'nft.prisma',       // NFT collections and tokens
  'transactions.prisma', // Blockchain transactions
  'analytics.prisma'  // Analytics and system health
];

function combineSchemas() {
  console.log('🔧 Combining Prisma schemas...');
  
  let combinedContent = `// SmartWalletFX Crypto Data Service - Combined Prisma Schema
// 
// This file is auto-generated from modular schema files.
// DO NOT EDIT DIRECTLY - Edit files in prisma/schemas/ instead
// 
// To regenerate: npm run schema:combine
//
// Schema Organization:
// - base.prisma: Generator and datasource configuration
// - core.prisma: Core entities (UserWallet, Token, TokenBalance, PriceCache)  
// - portfolio.prisma: Portfolio management and aggregation
// - defi.prisma: DeFi positions, protocols, and yield tracking
// - nft.prisma: NFT collections, tokens, and marketplace data
// - transactions.prisma: Blockchain transactions and token transfers
// - analytics.prisma: Analytics events, caching, and system health
//
// Generated: ${new Date().toISOString()}

`;

  for (const schemaFile of SCHEMA_FILES) {
    const filePath = path.join(SCHEMAS_DIR, schemaFile);
    
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Schema file not found: ${schemaFile}`);
      process.exit(1);
    }
    
    console.log(`📄 Including ${schemaFile}...`);
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Add section header
    combinedContent += `\n// ============================================================================\n`;
    combinedContent += `// ${schemaFile.replace('.prisma', '').toUpperCase()} SCHEMA\n`;
    combinedContent += `// ============================================================================\n\n`;
    
    // Add the content (skip generator/datasource in non-base files)
    if (schemaFile !== 'base.prisma') {
      const lines = content.split('\n');
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('generator ') && 
               !trimmed.startsWith('datasource ') &&
               !trimmed.includes('provider =') &&
               !trimmed.includes('url =') &&
               !trimmed.includes('previewFeatures =');
      });
      combinedContent += filteredLines.join('\n');
    } else {
      combinedContent += content;
    }
    
    combinedContent += '\n';
  }
  
  // Write the combined schema
  fs.writeFileSync(OUTPUT_FILE, combinedContent, 'utf8');
  
  console.log(`✅ Combined schema written to ${OUTPUT_FILE}`);
  console.log(`📊 Generated ${combinedContent.split('\n').length} lines from ${SCHEMA_FILES.length} files`);
}

function validateSchemas() {
  console.log('🔍 Validating individual schema files...');
  
  for (const schemaFile of SCHEMA_FILES) {
    const filePath = path.join(SCHEMAS_DIR, schemaFile);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Basic validation
    if (schemaFile === 'base.prisma') {
      if (!content.includes('generator client') || !content.includes('datasource db')) {
        console.error(`❌ ${schemaFile} missing generator or datasource`);
        process.exit(1);
      }
    } else {
      // Non-base files should not have generator/datasource
      if (content.includes('generator ') || content.includes('datasource ')) {
        console.warn(`⚠️  ${schemaFile} contains generator/datasource (will be filtered)`);
      }
    }
    
    console.log(`✅ ${schemaFile} validated`);
  }
}

function main() {
  try {
    validateSchemas();
    combineSchemas();
    
    console.log('\n🎉 Schema combination completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: npm run prisma:generate');
    console.log('2. Run: npm run prisma:migrate');
    console.log('3. Test the application');
    
  } catch (error) {
    console.error('❌ Schema combination failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { combineSchemas, validateSchemas };