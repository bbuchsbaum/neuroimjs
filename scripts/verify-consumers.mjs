/**
 * Downstream consumer contract suite (tests/consumers/).
 *
 * Runs each known downstream app's actual call surface against the PACKED
 * tarball, not src/:
 *   1. `npm pack` + install into a temporary consumer project;
 *   2. type-check the TypeScript consumer mirrors against the installed
 *      declarations (neuroimjs-vscode webview, neuromosaic option objects);
 *   3. build the contract pages with Vite against the installed package,
 *      resolving imports the way each consumer does (the UMD bundle as a
 *      classic script, 'neuroimjs' aliased to the ES bundle, and
 *      'neuroimjs/browser' through the exports map);
 *   4. serve them and run tests/consumers/*.spec.ts with Playwright
 *      (Chromium) — the Node-only xnat2bids spec uses the same install.
 *
 * Requires a built dist/ (`npm run build && npm run build:vite`) and a
 * Playwright Chromium (`npx playwright install chromium`).
 * Extra arguments are passed to `playwright test` (e.g. `-- --grep vscode`).
 * Set NEUROIMJS_KEEP_CONSUMER=1 to keep the temporary project for debugging.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { createPackedConsumer, repositoryRoot } from './lib/packed-consumer.mjs';

const requiredBuildOutputs = [
  'dist/cjs/index.js',
  'dist/esm/index.js',
  'dist/types/browser.d.ts',
  'dist/neuroimjs.es.js',
  'dist/neuroimjs.umd.js',
];
const missingOutputs = requiredBuildOutputs.filter(path => !existsSync(join(repositoryRoot, path)));
if (missingOutputs.length > 0) {
  console.error(`Missing build outputs (${missingOutputs.join(', ')}). Run \`npm run build && npm run build:vite\` first.`);
  process.exit(1);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function serve(directory) {
  const root = resolve(directory);
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise(resolvePromise => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const started = Date.now();
const log = message => console.log(`[consumers ${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

const consumer = createPackedConsumer({ prefix: 'neuroimjs-consumers-', name: 'neuroimjs-consumer-contracts' });
const { consumerRoot, tarballName, run } = consumer;
let server;
let status = 1;

try {
  log(`installed ${tarballName} into ${consumerRoot}`);
  const installed = join(consumerRoot, 'node_modules', 'neuroimjs');
  const pagesRoot = join(consumerRoot, 'pages');
  cpSync(join(repositoryRoot, 'tests', 'consumers', 'pages'), pagesRoot, { recursive: true });

  // Type-level contracts against the installed declarations. Mirrors the
  // neuroimjs-vscode webview tsconfig (strict, Bundler resolution).
  writeFileSync(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
    },
    files: ['pages/vscode.ts', 'pages/neuromosaic-options.ts'],
  }, null, 2));
  try {
    run('node', [join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', 'tsconfig.json'], consumerRoot);
  } catch (error) {
    console.error('Consumer type contracts failed against the packed declarations:');
    console.error(String(error.stdout ?? '') + String(error.stderr ?? ''));
    throw new Error('consumer type-check failed');
  }
  log('type contracts passed (neuroimjs-vscode, neuromosaic options)');

  // neuromosaic vendors the UMD file and loads it as a classic script.
  const publicDir = join(pagesRoot, 'public');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(installed, 'dist', 'neuroimjs.umd.js'), join(publicDir, 'neuroimjs.umd.js'));

  const { build } = await import('vite');
  const siteRoot = join(consumerRoot, 'site');
  await build({
    configFile: false,
    root: pagesRoot,
    publicDir,
    logLevel: 'error',
    resolve: {
      // FROIAtlas's alias: the bare specifier -> the ES browser bundle.
      // Exact match only, so 'neuroimjs/browser' still goes through `exports`.
      alias: [{ find: /^neuroimjs$/, replacement: join(installed, 'dist', 'neuroimjs.es.js') }],
    },
    build: {
      outDir: siteRoot,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'es2022',
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        input: {
          neuromosaic: join(pagesRoot, 'neuromosaic.html'),
          froiatlas: join(pagesRoot, 'froiatlas.html'),
          vscode: join(pagesRoot, 'vscode.html'),
        },
      },
    },
  });
  log('built contract pages against the installed package');

  server = await serve(siteRoot);
  const { port } = server.address();
  // Async spawn: the static server lives in this process's event loop.
  const playwright = spawn(process.execPath, [
    join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test',
    '--config',
    join(repositoryRoot, 'tests', 'consumers', 'playwright.config.ts'),
    ...process.argv.slice(2),
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEUROIMJS_CONSUMER_ROOT: consumerRoot,
      NEUROIMJS_CONSUMER_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  status = await new Promise(resolveStatus => {
    playwright.on('close', code => resolveStatus(code ?? 1));
    playwright.on('error', () => resolveStatus(1));
  });
  log(status === 0 ? `consumer contracts passed: ${tarballName}` : 'consumer contracts FAILED');
} catch (error) {
  if (error?.stderr) process.stderr.write(String(error.stderr));
  console.error(error instanceof Error ? error.message : error);
  status = 1;
} finally {
  server?.close();
  if (process.env.NEUROIMJS_KEEP_CONSUMER) {
    log(`kept ${consumer.temporaryRoot}`);
  } else {
    consumer.cleanup();
  }
}

process.exit(status);
