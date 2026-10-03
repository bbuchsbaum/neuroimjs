#!/usr/bin/env node
/**
 * Materialise the test data that the unit, browser and example code expect
 * under tests/data/ (which is git-ignored) from files committed to the repo.
 *
 * The only volume needed is the ICBM 2009a nonlinear asymmetric MNI152 T1w
 * template at 1 mm (TemplateFlow name tpl-MNI152NLin2009aAsym_res-1_T1w).
 * The identical file is already committed for the docs site as
 * docs/public/data/mni152_t1.nii.gz (licence: docs/public/data/LICENSE-MNI152.txt),
 * so it is copied, not downloaded. Both the source and any existing target are
 * verified against a pinned SHA-256 so a stale or corrupt copy cannot pass.
 *
 * Usage: node scripts/prepare-test-data.mjs   (idempotent; also run by the
 * vitest and Playwright global setups)
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_DATA = [
  {
    source: 'docs/public/data/mni152_t1.nii.gz',
    target: 'tests/data/volumes/tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz',
    sha256: '834d734e62804d7ab166fe3f60939c7ef674f959051c8d059f880663d6b9e5b9',
  },
];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function prepareTestData({ quiet = false } = {}) {
  for (const { source, target, sha256: expected } of TEST_DATA) {
    const src = join(root, source);
    const dst = join(root, target);
    if (existsSync(dst) && sha256(dst) === expected) continue;

    if (!existsSync(src)) {
      throw new Error(`prepare-test-data: missing committed source ${source}`);
    }
    const actual = sha256(src);
    if (actual !== expected) {
      throw new Error(
        `prepare-test-data: ${source} has SHA-256 ${actual}, expected ${expected}`
      );
    }
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    if (sha256(dst) !== expected) {
      throw new Error(`prepare-test-data: copy to ${target} failed verification`);
    }
    if (!quiet) console.log(`prepare-test-data: ${relative(root, src)} -> ${target}`);
  }
}

/** Default export: the globalSetup hook of vitest.config.ts and playwright.config.ts. */
export default function globalSetup() {
  prepareTestData({ quiet: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareTestData();
}
