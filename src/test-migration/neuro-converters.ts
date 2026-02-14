/**
 * Specialized converters for neuroimaging-specific test patterns
 */

import { TestConversionRule } from './migrator';

export const neuroConversionRules: TestConversionRule[] = [
  // NeuroSpace conversions
  {
    pattern: /NeuroSpace\(\[(.+?)\],\s*\[(.+?)\],\s*\[(.+?)\]\)/g,
    replacement: 'new NeuroSpace([$1], [$2], [$3])'
  },
  
  // NeuroVol conversions
  {
    pattern: /DenseNeuroVol\((.+?),\s*(.+?)\)/g,
    replacement: 'new FloatNeuroVol($1, $2)'
  },
  {
    pattern: /LogicalNeuroVol\((.+?),\s*(.+?)\)/g,
    replacement: 'new LogicalNeuroVol($1, $2)'
  },
  {
    pattern: /SparseNeuroVol\((.+?),\s*(.+?),\s*(.+?)\)/g,
    replacement: 'new SparseNeuroVol($1, $2, $3)'
  },
  
  // ROI conversions
  {
    pattern: /spherical_roi\((.+?),\s*(.+?),\s*(.+?)\)/g,
    replacement: 'sphericalROI($1, $2, $3)'
  },
  {
    pattern: /cuboid_roi\((.+?),\s*(.+?),\s*(.+?)\)/g,
    replacement: 'cuboidROI($1, $2, $3)'
  },
  
  // File I/O conversions
  {
    pattern: /read_vol\(['"](.+?)['"]\)/g,
    replacement: "await readVol('$1')"
  },
  {
    pattern: /write_vol\((.+?),\s*['"](.+?)['"]\)/g,
    replacement: "await writeVol($1, '$2')"
  },
  
  // NumPy specific for neuroimaging
  {
    pattern: /np\.random\.rand\((.+?)\)/g,
    replacement: (match, dims) => {
      const dimArray = dims.split(',').map((d: string) => d.trim());
      if (dimArray.length === 1) {
        return `Float32Array.from({ length: ${dimArray[0]} }, () => Math.random())`;
      }
      return `Float32Array.from({ length: ${dimArray.join(' * ')} }, () => Math.random())`;
    }
  },
  {
    pattern: /np\.arange\((.+?)\)/g,
    replacement: 'Float32Array.from({ length: $1 }, (_, i) => i)'
  },
  {
    pattern: /np\.linspace\((.+?),\s*(.+?),\s*(.+?)\)/g,
    replacement: (match, start, end, num) => {
      return `Float32Array.from({ length: ${num} }, (_, i) => ${start} + (${end} - ${start}) * i / (${num} - 1))`;
    }
  },
  
  // Shape and dimension handling
  {
    pattern: /\.shape/g,
    replacement: '.dim'
  },
  {
    pattern: /\.dtype/g,
    replacement: '.constructor.name'
  },
  
  // Indexing conversions
  {
    pattern: /\[(.+?),\s*(.+?),\s*(.+?)\]/g,
    replacement: (match, i, j, k) => {
      // Check if this is array indexing vs array literal
      if (match.includes(':')) {
        return match; // Skip slicing for now
      }
      return `.getAt(${i}, ${j}, ${k})`;
    }
  },
  
  // Assert almost equal for floating point
  {
    pattern: /np\.testing\.assert_almost_equal\((.+?),\s*(.+?)\)/g,
    replacement: 'expect($1).toBeCloseTo($2)'
  },
  {
    pattern: /np\.testing\.assert_array_almost_equal\((.+?),\s*(.+?)\)/g,
    replacement: (match, arr1, arr2) => {
      return `for (let i = 0; i < ${arr1}.length; i++) {\n    expect(${arr1}[i]).toBeCloseTo(${arr2}[i]);\n  }`;
    }
  },
  
  // Temporary file handling
  {
    pattern: /with\s+tempfile\.NamedTemporaryFile\(.+?\)\s+as\s+(\w+):/g,
    replacement: (match, varName) => {
      return `const ${varName} = { name: path.join(tempDir, 'temp_' + Date.now()) };\n  try {`;
    }
  },
  {
    pattern: /tempfile\.mkdtemp\(\)/g,
    replacement: "await fs.mkdtemp(path.join(os.tmpdir(), 'neuro-test-'))"
  }
];

/**
 * Convert neuroimaging-specific test utilities
 */
export function convertTestUtilities(content: string): string {
  // Add common test utilities at the top
  const utilities = `
// Test utilities
function createTestVolume(dim: number[], fillValue = 0): FloatNeuroVol {
  const space = new NeuroSpace(dim, [1, 1, 1], [0, 0, 0]);
  const data = new Float32Array(dim[0] * dim[1] * dim[2]).fill(fillValue);
  return new FloatNeuroVol(space, data);
}

function createRandomVolume(dim: number[]): FloatNeuroVol {
  const space = new NeuroSpace(dim, [1, 1, 1], [0, 0, 0]);
  const data = Float32Array.from(
    { length: dim[0] * dim[1] * dim[2] }, 
    () => Math.random()
  );
  return new FloatNeuroVol(space, data);
}

function assertArraysClose(actual: TypedArray, expected: TypedArray, tolerance = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], -Math.log10(tolerance));
  }
}
`;

  return utilities + '\n' + content;
}

/**
 * Handle specific test fixture patterns
 */
export function convertFixtures(content: string): string {
  // Convert pytest fixtures to beforeEach
  content = content.replace(
    /@pytest\.fixture\s*\n\s*def\s+(\w+)\(\):\s*\n([\s\S]+?)(?=\n(?:def|class|@|\s*$))/gm,
    (match, name, body) => {
      const tsBody = body
        .split('\n')
        .map((line: string) => '  ' + line.trim())
        .join('\n');
      
      return `let ${name}: any;\n\nbeforeEach(() => {\n${tsBody}\n});`;
    }
  );

  // Convert fixture usage
  content = content.replace(
    /def\s+test_\w+\((.+?)\):/g,
    (match, params) => {
      const paramList = params.split(',').map((p: string) => p.trim());
      const fixtureUsage = paramList
        .filter((p: string) => p && p !== 'self')
        .map((p: string) => `// Uses fixture: ${p}`)
        .join('\n  ');
      
      return match.replace(params, '') + (fixtureUsage ? '\n  ' + fixtureUsage : '');
    }
  );

  return content;
}

/**
 * Post-process converted neuroimaging tests
 */
export function postProcessNeuroTests(content: string): string {
  // Apply neuroimaging-specific conversions
  for (const rule of neuroConversionRules) {
    content = content.replace(rule.pattern, rule.replacement as any);
  }

  // Convert fixtures
  content = convertFixtures(content);

  // Add utilities if needed
  if (content.includes('createTestVolume') || content.includes('createRandomVolume')) {
    content = convertTestUtilities(content);
  }

  // Fix async/await patterns
  content = content.replace(
    /it\(['"](.+?)['"],\s*\(\)\s*=>\s*{/g,
    "it('$1', async () => {"
  );

  // Fix import paths for neuroimaging modules
  content = content.replace(
    /from ['"]\.\.\/(.+?)['"]/g,
    "from '../src/$1'"
  );

  return content;
}

/**
 * Generate test template for a neuroimaging class
 */
export function generateTestTemplate(className: string, methods: string[]): string {
  const template = `import { describe, it, expect, beforeEach } from 'vitest';
import { ${className} } from '../src/${className}';
import { NeuroSpace } from '../src/geometry/NeuroSpace';
import { FloatNeuroVol } from '../src/volume/DenseNeuroVol';

describe('${className}', () => {
  let instance: ${className};
  let testSpace: NeuroSpace;
  let testVolume: FloatNeuroVol;

  beforeEach(() => {
    testSpace = new NeuroSpace([10, 10, 10], [1, 1, 1], [0, 0, 0]);
    testVolume = new FloatNeuroVol(testSpace);
    // Initialize instance based on class requirements
  });

${methods.map(method => `
  describe('${method}', () => {
    it('should ${method.replace(/([A-Z])/g, ' $1').toLowerCase()}', async () => {
      // Test implementation
      expect(instance).toBeDefined();
    });
  });
`).join('\n')}
});`;

  return template;
}
