#!/usr/bin/env node
/**
 * Check the NIfTI writers against nibabel (opt-in).
 *
 * Usage: npm run conformance:writers
 *
 * Runs tests/conformance/nifti.writers.nibabel.test.ts with NIJ_NIBABEL=1:
 * neuroimjs writes NIfTI files with writeVol/writeVec, and
 * scripts/conformance/inspect_written_nifti.py loads them with nibabel in an
 * ephemeral uv environment pinned to the versions in the conformance
 * manifest. Needs uv (or UV=/path/to/uv) and, on first run, network access.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'tests/conformance/nifti.writers.nibabel.test.ts'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NIJ_NIBABEL: '1' } }
);
process.exit(result.status ?? 1);
