#!/usr/bin/env node
/**
 * Regenerate the nibabel conformance fixtures (tests/conformance/fixtures/).
 *
 * Usage: npm run conformance:generate
 *
 * Runs scripts/conformance/generate_nifti_fixtures.py inside an ephemeral uv
 * environment with pinned versions, so no global Python packages are needed or
 * touched. Only fixture generation needs Python; the vitest specs read the
 * committed fixtures and manifest.
 *
 * Override the uv binary with UV=/path/to/uv. The pins below are recorded in
 * the manifest; bump them deliberately and review the fixture diff.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PINS = {
  python: '3.12',
  nibabel: '5.3.2',
  numpy: '2.1.3',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function findUv() {
  if (process.env.UV) return process.env.UV;
  const probe = spawnSync('uv', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'uv';
  const local = join(homedir(), '.local', 'bin', 'uv');
  if (existsSync(local)) return local;
  console.error('uv not found. Install it (https://docs.astral.sh/uv/) or set UV=/path/to/uv.');
  process.exit(1);
}

const uvArgs = [
  'run',
  '--no-project',
  '--python', PINS.python,
  '--with', `nibabel==${PINS.nibabel}`,
  '--with', `numpy==${PINS.numpy}`,
  'python',
  'scripts/conformance/generate_nifti_fixtures.py',
];
const recorded = `uv ${uvArgs.join(' ')}`;

const result = spawnSync(findUv(), [...uvArgs, '--command', recorded], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
