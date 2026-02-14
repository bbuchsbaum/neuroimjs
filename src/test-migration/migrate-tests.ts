#!/usr/bin/env node

/**
 * CLI script to migrate Python tests to TypeScript
 */

import { runMigration } from './migrator';
import * as path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: migrate-tests <input-dir> <output-dir> [--framework=vitest|jest]');
  console.log('');
  console.log('Example:');
  console.log('  migrate-tests /path/to/python/tests ./tests/migrated');
  process.exit(1);
}

const inputDir = path.resolve(args[0]);
const outputDir = path.resolve(args[1]);

// Parse options
const options: any = {};
for (let i = 2; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--framework=')) {
    options.testFramework = arg.split('=')[1];
  }
}

// Run migration
runMigration(inputDir, outputDir, options)
  .then(() => {
    console.log('Migration completed successfully!');
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });