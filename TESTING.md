# Testing Guide for neuroimjs

## Running Tests

### Run all tests
```bash
npm test
```

### Run specific test files
```bash
# Using npm scripts
npm run test:specific src/display/__tests__/integration/MultiLayerAlignment.test.ts

# Using the test runner script
./test-specific.sh MultiLayerAlignment

# Run alignment tests specifically
npm run test:alignment
```

### Watch mode for development
```bash
# Watch all tests
npm run test:watch

# Watch specific test file
./test-watch.sh MultiLayerAlignment
```

### Debug mode with verbose output
```bash
npm run test:debug
```

## Common Test Issues

### Out of Bounds Errors
When working with multiple volumes of different dimensions, ensure slice indices are within bounds for all volumes:

```typescript
import { getSafeSliceIndex } from './helpers/testUtils';

// Get a safe slice index for axial view
const sliceIndex = getSafeSliceIndex(volStack, AxisSet3D.fromStr('XYZ'));
```

### Volume Dimensions
- Always check the dimensions of test volumes before selecting slice indices
- For axial views (XYZ), the Z dimension determines the number of slices
- For sagittal views (YZX), the X dimension determines the number of slices
- For coronal views (XZY), the Y dimension determines the number of slices

## Test Organization

- Unit tests: `src/**/__tests__/*.test.ts`
- Integration tests: `src/**/__tests__/integration/*.test.ts`
- Test helpers: `src/**/__tests__/helpers/*.ts`

## Tips for Test Development

1. Use focused test runs during development:
   ```bash
   npm run test:specific -- --grep "should cache alignment"
   ```

2. Add console logs temporarily for debugging:
   ```typescript
   console.log('Debug:', variable);
   ```

3. Use the verbose reporter for detailed output:
   ```bash
   npm run test:debug
   ```

4. Check test coverage:
   ```bash
   npm test -- --coverage
   ```