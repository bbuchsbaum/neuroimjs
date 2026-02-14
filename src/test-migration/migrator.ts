/**
 * Test Migration Framework for converting Python tests to TypeScript
 * 
 * This framework provides utilities to help convert Python neuroimaging tests
 * to TypeScript while maintaining test coverage and correctness.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface TestConversionRule {
  pattern: RegExp;
  replacement: string | ((match: string, ...args: any[]) => string);
}

export interface MigrationOptions {
  inputDir: string;
  outputDir: string;
  testFramework: 'vitest' | 'jest';
  preserveComments: boolean;
}

export class TestMigrator {
  private conversionRules: TestConversionRule[] = [
    // Python imports to TypeScript imports
    {
      pattern: /^import\s+(\w+)\s+from\s+['"](.+)['"]/gm,
      replacement: "import { $1 } from '$2';"
    },
    {
      pattern: /^from\s+(.+)\s+import\s+(.+)/gm,
      replacement: (match, module, imports) => {
        // Handle relative imports
        const tsModule = module.replace(/\./g, '/').replace(/^\//, './');
        return `import { ${imports} } from '${tsModule}';`;
      }
    },
    
    // Test decorators and structure
    {
      pattern: /^@pytest\.mark\.(\w+)/gm,
      replacement: '// @$1'
    },
    {
      pattern: /^def\s+test_(\w+)\s*\((.*?)\)\s*:/gm,
      replacement: "it('should $1', async () => {"
    },
    {
      pattern: /^class\s+Test(\w+):/gm,
      replacement: "describe('$1', () => {"
    },
    
    // Assertions
    {
      pattern: /assert\s+(.+?)\s*==\s*(.+?)$/gm,
      replacement: 'expect($1).toEqual($2);'
    },
    {
      pattern: /assert\s+(.+?)\s*!=\s*(.+?)$/gm,
      replacement: 'expect($1).not.toEqual($2);'
    },
    {
      pattern: /assert\s+(.+?)\s*<\s*(.+?)$/gm,
      replacement: 'expect($1).toBeLessThan($2);'
    },
    {
      pattern: /assert\s+(.+?)\s*>\s*(.+?)$/gm,
      replacement: 'expect($1).toBeGreaterThan($2);'
    },
    {
      pattern: /assert\s+(.+?)$/gm,
      replacement: 'expect($1).toBeTruthy();'
    },
    {
      pattern: /pytest\.raises\((\w+)\)/gm,
      replacement: 'expect(() => { }).toThrow($1)'
    },
    
    // NumPy to TypeScript array operations
    {
      pattern: /np\.array\(\[(.+?)\]\)/g,
      replacement: 'new Float32Array([$1])'
    },
    {
      pattern: /np\.zeros\(\((.+?)\)\)/g,
      replacement: (match, dims) => {
        const dimArray = dims.split(',').map((d: string) => d.trim());
        if (dimArray.length === 1) {
          return `new Float32Array(${dimArray[0]})`;
        }
        return `new Float32Array(${dimArray.join(' * ')})`;
      }
    },
    {
      pattern: /np\.ones\(\((.+?)\)\)/g,
      replacement: (match, dims) => {
        const dimArray = dims.split(',').map((d: string) => d.trim());
        if (dimArray.length === 1) {
          return `new Float32Array(${dimArray[0]}).fill(1)`;
        }
        return `new Float32Array(${dimArray.join(' * ')}).fill(1)`;
      }
    },
    
    // Python syntax to TypeScript
    {
      pattern: /^\s{4}/gm,
      replacement: '  ' // Convert 4 spaces to 2
    },
    {
      pattern: /self\./g,
      replacement: 'this.'
    },
    {
      pattern: /True/g,
      replacement: 'true'
    },
    {
      pattern: /False/g,
      replacement: 'false'
    },
    {
      pattern: /None/g,
      replacement: 'null'
    },
    {
      pattern: /\blen\((.+?)\)/g,
      replacement: '$1.length'
    },
    {
      pattern: /\brange\((.+?)\)/g,
      replacement: 'Array.from({ length: $1 }, (_, i) => i)'
    },
    
    // Type hints
    {
      pattern: /:\s*int\b/g,
      replacement: ': number'
    },
    {
      pattern: /:\s*float\b/g,
      replacement: ': number'
    },
    {
      pattern: /:\s*str\b/g,
      replacement: ': string'
    },
    {
      pattern: /:\s*bool\b/g,
      replacement: ': boolean'
    },
    {
      pattern: /:\s*List\[(.+?)\]/g,
      replacement: ': $1[]'
    },
    {
      pattern: /:\s*Dict\[(.+?),\s*(.+?)\]/g,
      replacement: ': Record<$1, $2>'
    },
    
    // Common test patterns
    {
      pattern: /with\s+pytest\.raises\((.+?)\):/g,
      replacement: 'await expect(async () => {'
    },
    {
      pattern: /^\s*pass$/gm,
      replacement: '  // pass'
    }
  ];

  constructor(private options: MigrationOptions) {}

  /**
   * Convert a single Python test file to TypeScript
   */
  async convertFile(inputPath: string, outputPath: string): Promise<void> {
    const content = await fs.readFile(inputPath, 'utf-8');
    let converted = content;

    // Apply conversion rules
    for (const rule of this.conversionRules) {
      converted = converted.replace(rule.pattern, rule.replacement as any);
    }

    // Add test framework imports
    const imports = this.generateImports();
    converted = imports + '\n\n' + converted;

    // Fix indentation and brackets
    converted = this.fixIndentationAndBrackets(converted);

    // Add closing brackets for describe/it blocks
    converted = this.addClosingBrackets(converted);

    // Write the converted file
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, converted);
  }

  /**
   * Convert all Python test files in a directory
   */
  async convertDirectory(): Promise<void> {
    const files = await this.findPythonTestFiles(this.options.inputDir);
    
    for (const file of files) {
      const relativePath = path.relative(this.options.inputDir, file);
      const outputPath = path.join(
        this.options.outputDir,
        relativePath.replace(/\.py$/, '.test.ts')
      );
      
      console.log(`Converting ${relativePath}...`);
      
      try {
        await this.convertFile(file, outputPath);
        console.log(`✓ Converted to ${outputPath}`);
      } catch (error) {
        console.error(`✗ Failed to convert ${relativePath}:`, error);
      }
    }
  }

  private async findPythonTestFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...await this.findPythonTestFiles(fullPath));
      } else if (entry.isFile() && entry.name.match(/test.*\.py$/)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private generateImports(): string {
    if (this.options.testFramework === 'vitest') {
      return "import { describe, it, expect, beforeEach, afterEach } from 'vitest';";
    } else {
      return "// Jest imports\nimport { describe, it, expect, beforeEach, afterEach } from '@jest/globals';";
    }
  }

  private fixIndentationAndBrackets(content: string): string {
    // Fix common indentation issues
    const lines = content.split('\n');
    const fixedLines: string[] = [];
    let indentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Decrease indent for closing brackets
      if (trimmed === '}' || trimmed === '});' || trimmed === '})') {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Add proper indentation
      if (trimmed) {
        fixedLines.push('  '.repeat(indentLevel) + trimmed);
      } else {
        fixedLines.push('');
      }

      // Increase indent after opening brackets
      if (trimmed.endsWith('{') || trimmed.endsWith('=> {')) {
        indentLevel++;
      }
    }

    return fixedLines.join('\n');
  }

  private addClosingBrackets(content: string): string {
    // Count opening and closing brackets
    const openDescribe = (content.match(/describe\(/g) || []).length;
    const openIt = (content.match(/it\(/g) || []).length;
    const closeBrackets = (content.match(/}\);/g) || []).length;

    const missingBrackets = openDescribe + openIt - closeBrackets;

    // Add missing closing brackets
    for (let i = 0; i < missingBrackets; i++) {
      content += '\n});';
    }

    return content;
  }

  /**
   * Generate a migration report
   */
  async generateReport(): Promise<string> {
    const files = await this.findPythonTestFiles(this.options.inputDir);
    const report = [
      '# Test Migration Report',
      '',
      `Total Python test files found: ${files.length}`,
      '',
      '## Files to migrate:',
      ...files.map(f => `- ${path.relative(this.options.inputDir, f)}`),
      '',
      '## Conversion Rules Applied:',
      '- Python imports → TypeScript imports',
      '- pytest → vitest/jest',
      '- assert statements → expect assertions',
      '- NumPy arrays → TypedArrays',
      '- Python syntax → TypeScript syntax',
      '',
      '## Manual Review Required:',
      '- Complex NumPy operations',
      '- File I/O operations',
      '- Async/await patterns',
      '- Custom fixtures and mocks',
      '- Type annotations'
    ];

    return report.join('\n');
  }
}

/**
 * CLI interface for the test migrator
 */
export async function runMigration(
  inputDir: string,
  outputDir: string,
  options: Partial<MigrationOptions> = {}
): Promise<void> {
  const migrator = new TestMigrator({
    inputDir,
    outputDir,
    testFramework: options.testFramework || 'vitest',
    preserveComments: options.preserveComments ?? true
  });

  console.log('Starting test migration...');
  console.log(`Input directory: ${inputDir}`);
  console.log(`Output directory: ${outputDir}`);
  console.log('');

  // Generate report
  const report = await migrator.generateReport();
  await fs.writeFile(path.join(outputDir, 'migration-report.md'), report);
  console.log('Generated migration report');

  // Run conversion
  await migrator.convertDirectory();
  
  console.log('\nMigration complete!');
  console.log('Please review the converted files and make any necessary manual adjustments.');
}