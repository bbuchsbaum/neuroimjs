/**
 * Pack the repository with `npm pack` and install the tarball into a fresh,
 * private npm project, exactly as a downstream consumer would receive it.
 * Shared by scripts/verify-package.mjs and scripts/verify-consumers.mjs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {{ prefix: string, name: string }} options
 * @returns {{ temporaryRoot: string, consumerRoot: string, tarballName: string,
 *   run: (command: string, args: string[], cwd?: string) => string, cleanup: () => void }}
 */
export function createPackedConsumer({ prefix, name }) {
  // realpath: on macOS tmpdir() is a symlink (/var -> /private/var), which
  // bundlers resolving real paths would treat as outside the project root.
  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const environment = { ...process.env, npm_config_cache: join(temporaryRoot, 'npm-cache') };
  const run = (command, args, cwd = repositoryRoot) => execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => rmSync(temporaryRoot, { recursive: true, force: true });

  try {
    const packResult = JSON.parse(run('npm', [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      temporaryRoot,
    ]));
    const tarballName = packResult[0].filename;
    const consumerRoot = join(temporaryRoot, 'consumer');

    writeFileSync(join(temporaryRoot, 'package.json'), JSON.stringify({ private: true }));
    mkdirSync(consumerRoot);
    writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ name, private: true, type: 'module' }));

    run('npm', [
      'install',
      join(temporaryRoot, tarballName),
      '--ignore-scripts',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
    ], consumerRoot);

    return { temporaryRoot, consumerRoot, tarballName, run, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
