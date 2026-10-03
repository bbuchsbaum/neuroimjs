#!/usr/bin/env node
// Verify that a version published to npm matches a tarball packed from source.
//
// Usage:
//   node scripts/verify-published.mjs <version> [options]
//
// Options:
//   --local-tarball <path>      Reference tarball (default: `npm pack` of --pack-dir).
//   --pack-dir <dir>            Directory to `npm pack --ignore-scripts` when no
//                               --local-tarball is given (default: repo root). Its
//                               dist/ must already be built.
//   --published-tarball <path>  Use this file instead of downloading from npm
//                               (for testing the comparison itself).
//   --package <name>            Package name (default: name in package.json of --pack-dir).
//   --require-provenance        Fail when the registry has no SLSA provenance attestation.
//   --retries <n>               Download attempts while the registry propagates (default 1).
//   --retry-delay <seconds>     Delay between attempts (default 15).
//
// Compares the file list and the SHA-256 of every file in the two tarballs.
// Exit status: 0 = identical (and provenance present if required),
//              1 = mismatch or missing provenance, 2 = usage or runtime error.
// No dependencies beyond Node's standard library.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';
const SLSA_PREDICATE = /^https:\/\/slsa\.dev\/provenance\//;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error('usage: node scripts/verify-published.mjs <version> [--local-tarball <path>] ' +
    '[--pack-dir <dir>] [--published-tarball <path>] [--package <name>] ' +
    '[--require-provenance] [--retries <n>] [--retry-delay <seconds>]');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { retries: 1, retryDelay: 15, requireProvenance: false, packDir: repositoryRoot };
  const valued = {
    '--local-tarball': 'localTarball',
    '--pack-dir': 'packDir',
    '--published-tarball': 'publishedTarball',
    '--package': 'packageName',
    '--retries': 'retries',
    '--retry-delay': 'retryDelay',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--require-provenance') options.requireProvenance = true;
    else if (arg === '-h' || arg === '--help') usage();
    else if (valued[arg]) {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      options[valued[arg]] = argv[++i];
    } else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) usage('exactly one <version> is required');
  options.version = positional[0].replace(/^v/, '');
  options.retries = Number(options.retries);
  options.retryDelay = Number(options.retryDelay);
  if (!Number.isInteger(options.retries) || options.retries < 1) usage('--retries must be a positive integer');
  if (!(options.retryDelay >= 0)) usage('--retry-delay must be a non-negative number');
  options.packDir = resolve(options.packDir);
  return options;
}

function npm(args, cwd) {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Minimal ustar/pax reader: returns Map<path-without-"package/"-prefix, sha256-hex>.
function readTarball(file) {
  const data = gunzipSync(readFileSync(file));
  const files = new Map();
  const field = (block, start, length) => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? length : end).toString('utf8');
  };
  let offset = 0;
  let paxPath = null;
  let gnuLongName = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      // pax extended header: records of the form "<len> key=value\n".
      const text = body.toString('utf8');
      let cursor = 0;
      while (cursor < text.length) {
        const space = text.indexOf(' ', cursor);
        const length = parseInt(text.slice(cursor, space), 10);
        if (!length) break;
        const record = text.slice(space + 1, cursor + length - 1);
        const eq = record.indexOf('=');
        if (record.slice(0, eq) === 'path') paxPath = record.slice(eq + 1);
        cursor += length;
      }
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      gnuLongName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    const prefix = field(header, 345, 155);
    let name = paxPath ?? gnuLongName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    paxPath = null;
    gnuLongName = null;
    if (type !== '0' && type !== '\0') continue; // only regular files carry content
    name = name.replace(/^[^/]+\//, ''); // strip the top-level "package/" directory
    files.set(name, createHash('sha256').update(body).digest('hex'));
  }
  return files;
}

function sri(file) {
  return `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error(`GET ${url} -> HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function downloadPublished(spec, destination, retries, retryDelay) {
  for (let attempt = 1; ; attempt++) {
    try {
      const [result] = JSON.parse(npm(['pack', spec, '--json', '--pack-destination', destination], destination));
      return join(destination, result.filename);
    } catch (error) {
      if (attempt >= retries) throw new Error(`npm pack ${spec} failed: ${(error.stderr || error.message).trim()}`);
      console.log(`  ${spec} not available yet (attempt ${attempt}/${retries}); retrying in ${retryDelay}s`);
      await sleep(retryDelay * 1000);
    }
  }
}

async function checkProvenance(name, version) {
  let manifest;
  try {
    manifest = await fetchJson(`${REGISTRY}/${encodeURIComponent(name).replace('%40', '@')}/${version}`);
  } catch (error) {
    return { ok: false, detail: `could not read registry manifest (${error.message})` };
  }
  const attestations = manifest.dist?.attestations;
  if (!attestations?.url) return { ok: false, detail: 'no dist.attestations in registry manifest', integrity: manifest.dist?.integrity };
  try {
    const bundle = await fetchJson(attestations.url);
    const types = (bundle.attestations ?? []).map((entry) => entry.predicateType);
    const ok = types.some((type) => SLSA_PREDICATE.test(type));
    return {
      ok,
      detail: ok ? `SLSA provenance attestation present (${attestations.url})` : `attestations found but no SLSA provenance: ${types.join(', ')}`,
      integrity: manifest.dist?.integrity,
    };
  } catch (error) {
    return { ok: false, detail: `dist.attestations listed but unreadable (${error.message})`, integrity: manifest.dist?.integrity };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageName = options.packageName ??
    JSON.parse(readFileSync(join(options.packDir, 'package.json'), 'utf8')).name;
  const spec = `${packageName}@${options.version}`;
  const scratch = mkdtempSync(join(tmpdir(), 'verify-published-'));
  // Separate directories: both tarballs have the same file name.
  const localDir = join(scratch, 'local');
  const publishedDir = join(scratch, 'published');
  mkdirSync(localDir);
  mkdirSync(publishedDir);

  try {
    let localTarball = options.localTarball && resolve(options.localTarball);
    if (!localTarball) {
      const localVersion = JSON.parse(readFileSync(join(options.packDir, 'package.json'), 'utf8')).version;
      if (localVersion !== options.version) {
        throw new Error(`package.json in ${options.packDir} is ${localVersion}, not ${options.version}; check out the matching tag first`);
      }
      const [result] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', localDir], options.packDir));
      localTarball = join(localDir, result.filename);
    }
    const publishedTarball = options.publishedTarball
      ? resolve(options.publishedTarball)
      : await downloadPublished(spec, publishedDir, options.retries, options.retryDelay);

    console.log(`Comparing ${spec}`);
    console.log(`  published: ${publishedTarball}`);
    console.log(`  local:     ${localTarball}`);

    const published = readTarball(publishedTarball);
    const local = readTarball(localTarball);
    const onlyPublished = [...published.keys()].filter((file) => !local.has(file)).sort();
    const onlyLocal = [...local.keys()].filter((file) => !published.has(file)).sort();
    const differing = [...published.keys()].filter((file) => local.has(file) && local.get(file) !== published.get(file)).sort();

    const show = (label, list) => {
      if (!list.length) return;
      console.log(`  ${label} (${list.length}):`);
      for (const file of list.slice(0, 50)) console.log(`    ${file}`);
      if (list.length > 50) console.log(`    ... and ${list.length - 50} more`);
    };
    show('only in published tarball', onlyPublished);
    show('only in local tarball', onlyLocal);
    show('content differs', differing);

    const contentMatch = !onlyPublished.length && !onlyLocal.length && !differing.length;
    console.log(contentMatch
      ? `  MATCH: ${published.size} files, identical paths and SHA-256`
      : `  MISMATCH: published ${published.size} files, local ${local.size} files`);

    let provenanceOk = true;
    if (!options.publishedTarball) {
      const provenance = await checkProvenance(packageName, options.version);
      console.log(`  provenance: ${provenance.ok ? 'OK' : 'MISSING'} - ${provenance.detail}`);
      if (provenance.integrity) {
        const same = provenance.integrity === sri(localTarball);
        console.log(`  tarball integrity ${same ? 'identical' : 'differs (informational; per-file comparison is authoritative)'}`);
      }
      provenanceOk = provenance.ok || !options.requireProvenance;
    } else if (options.requireProvenance) {
      console.log('  provenance: not checked (--published-tarball given)');
    }

    process.exitCode = contentMatch && provenanceOk ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(2);
});
