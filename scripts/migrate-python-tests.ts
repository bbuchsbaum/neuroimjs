/**
 * Script to migrate Python neuroimaging tests to TypeScript
 */

import { TestMigrator, MigrationOptions } from '../src/test-migration/migrator';
import { neuroConversionRules, postProcessNeuroTests } from '../src/test-migration/neuro-converters';
import * as path from 'path';
import * as fs from 'fs/promises';

// Extend the base migrator with neuroimaging-specific rules
class NeuroTestMigrator extends TestMigrator {
  constructor(options: MigrationOptions) {
    super(options);
    
    // Add neuroimaging-specific conversion rules
    (this as any).conversionRules.push(...neuroConversionRules);
  }

  async convertFile(inputPath: string, outputPath: string): Promise<void> {
    // Use base conversion
    await super.convertFile(inputPath, outputPath);
    
    // Apply neuroimaging-specific post-processing
    let content = await fs.readFile(outputPath, 'utf-8');
    content = postProcessNeuroTests(content);
    
    // Add neuroimaging imports
    const neuroImports = `
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol, Int16NeuroVol, UInt8NeuroVol } from '../src/volume/DenseNeuroVol';
import { LogicalNeuroVol } from '../src/volume/LogicalNeuroVol';
import { SparseNeuroVol } from '../src/sparse/SparseNeuroVol';
import { readVol, writeVol } from '../src/io/io';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
`;

    // Insert imports after the test framework imports
    content = content.replace(
      /import \{ describe.*? \} from 'vitest';/,
      match => match + '\n' + neuroImports
    );

    await fs.writeFile(outputPath, content);
  }
}

async function main() {
  const pythonTestDir = '/Users/bbuchsbaum/code/pyneuroim/tests';
  const outputDir = path.join(process.cwd(), 'tests/migrated');

  console.log('=== Neuroimaging Test Migration ===\n');
  console.log(`Source: ${pythonTestDir}`);
  console.log(`Target: ${outputDir}`);
  console.log('');

  const migrator = new NeuroTestMigrator({
    inputDir: pythonTestDir,
    outputDir: outputDir,
    testFramework: 'vitest',
    preserveComments: true
  });

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Generate migration report
  const report = await (migrator as any).generateReport();
  await fs.writeFile(path.join(outputDir, 'migration-report.md'), report);
  console.log('✓ Generated migration report\n');

  // Get list of files to migrate
  const files = await (migrator as any).findPythonTestFiles(pythonTestDir);
  console.log(`Found ${files.length} test files to migrate\n`);

  // Migrate a subset of important tests first
  const priorityTests = [
    'test_neurovol.py',
    'test_neurovec.py', 
    'test_roi.py',
    'test_io.py',
    'test_sparse.py'
  ];

  for (const testName of priorityTests) {
    const file = files.find(f => f.endsWith(testName));
    if (file) {
      const relativePath = path.relative(pythonTestDir, file);
      const outputPath = path.join(outputDir, relativePath.replace(/\.py$/, '.test.ts'));
      
      console.log(`Converting ${testName}...`);
      try {
        await migrator.convertFile(file, outputPath);
        console.log(`✓ Converted to ${path.relative(process.cwd(), outputPath)}`);
      } catch (error) {
        console.error(`✗ Failed to convert ${testName}:`, error);
      }
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Total files: ${files.length}`);
  console.log(`Priority tests converted: ${priorityTests.length}`);
  console.log('\nNext steps:');
  console.log('1. Review the migrated tests in tests/migrated/');
  console.log('2. Fix any compilation errors');
  console.log('3. Update import paths and type annotations');
  console.log('4. Run tests and fix any runtime issues');
  console.log('5. Migrate remaining tests as needed');
}

// Run the migration
main().catch(console.error);