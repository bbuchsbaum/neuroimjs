# NPM Scripts Quick Reference

This document lists all available npm scripts for the neuroimjs project.

## Building

### Production Builds

```bash
npm run build              # Full build (CJS + ESM + Types)
npm run build:cjs          # CommonJS build only
npm run build:esm          # ES modules build only
npm run build:types        # TypeScript declarations only
npm run build:vite         # Vite browser build (dist/neuroimjs.es.js)
npm run build:quick        # Quick CJS build for testing
```

## Testing

```bash
npm test                   # Run all tests with Vitest
npm run test:watch         # Run tests in watch mode
npm run test:types         # TypeScript type checking
npm run test:specific      # Run specific test with verbose output
npm run test:alignment     # Run alignment integration tests
npm run test:debug         # Run tests with verbose output, no coverage
```

## Demos & Examples

### Composable Views Demos (NEW!)

```bash
npm run demo:composable    # View all composable views demos (index page)
npm run demo:single-view   # Single axial view example
npm run demo:two-view      # Two synchronized views example
npm run demo:multi-panel   # Multi-panel custom layout example
```

### Classic Viewer Demos

```bash
npm run demo:simple-ortho  # SimpleOrthogonalViewer (3-view layout)
```

### Command-Line Demos

```bash
npm run demo:ortho         # Orthogonal slice demo (Node.js)
npm run demo:extract       # Extract orthogonal slices (Node.js)
npm run demo:test-ortho    # Test orthogonal slicing (Node.js)
npm run demo:load          # Load image example (Node.js)
npm run demo:thumbs        # Generate thumbnails (Node.js)
```

### Development Server

```bash
npm run serve:examples     # Serve examples directory at http://localhost:8080
```

## Development Tools

```bash
npm run dev                # Start Vite dev server
npm run lint               # Run ESLint
npm run format             # Format code with Prettier
```

## Publishing

```bash
npm run prepublishOnly     # Runs automatically before npm publish (builds library)
```

## Script Patterns

### Demo Scripts Pattern

All `demo:*` scripts follow this pattern:
1. Build the library with `npm run build:vite`
2. Start http-server
3. Automatically open the example in your browser

**Example:**
```bash
npm run demo:single-view
# Equivalent to:
# 1. npm run build:vite
# 2. npx http-server -c-1 . -o examples/single-axial-view.html
```

### Test Scripts Pattern

Test scripts use Vitest:
- `npm test` - Run all tests once
- `npm run test:watch` - Continuous testing during development
- `npm run test:specific` - Run with verbose reporter for debugging

## Common Workflows

### Development Workflow

```bash
# 1. Start with a clean build
npm run build

# 2. Run tests to ensure everything works
npm test

# 3. Start dev server for live development
npm run dev

# 4. Run tests in watch mode in another terminal
npm run test:watch
```

### Demo Development Workflow

```bash
# 1. Build the library
npm run build:vite

# 2. Serve examples
npm run serve:examples

# 3. Open http://localhost:8080/examples/your-demo.html
```

### Pre-commit Workflow

```bash
# 1. Type check
npm run test:types

# 2. Run tests
npm test

# 3. Lint code
npm run lint

# 4. Format code (optional)
npm run format
```

### Release Workflow

```bash
# 1. Ensure all tests pass
npm test

# 2. Type check
npm run test:types

# 3. Build everything
npm run build

# 4. Test examples work
npm run demo:composable

# 5. Update version in package.json
npm version [major|minor|patch]

# 6. Publish (prepublishOnly runs automatically)
npm publish
```

## Troubleshooting

### "Cannot find module" errors in demos

Run the build first:
```bash
npm run build:vite
```

### Tests fail with type errors

Run type checking separately:
```bash
npm run test:types
```

### Browser doesn't open automatically

The `-o` flag in http-server may not work on all systems. Run the command and manually open the URL shown in the terminal.

### Port 8080 already in use

Kill the existing server or use a different port:
```bash
npx http-server -p 8081 -c-1 . -o examples/your-demo.html
```

## Adding New Scripts

To add a new npm script:

1. Add to `package.json` under `"scripts"`:
   ```json
   "demo:my-new-demo": "npm run build:vite && npx http-server -c-1 . -o examples/my-demo.html"
   ```

2. Document it in this file

3. Update the examples README if it's a demo

## Script Flags Explained

### http-server flags
- `-c-1` - Disable caching (always serve latest files)
- `-o` - Open browser automatically
- `-p PORT` - Use specific port

### Vitest flags
- `--watch` - Watch mode (re-run on file changes)
- `--reporter=verbose` - Detailed test output
- `--no-coverage` - Skip coverage collection
- `run` - Run once and exit (vs watch mode)

### TypeScript flags
- `--noEmit` - Type check without generating files
- `-p FILE` - Use specific tsconfig file
- `--outDir DIR` - Output directory for compiled files
