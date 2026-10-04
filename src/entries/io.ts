/**
 * `neuroimjs/io` — NIfTI and volume I/O without the viewer.
 *
 * This entry is guaranteed not to load the display layer (pixi.js, mobx,
 * lit, src/display, src/controls), so it is safe in Node processes such as an
 * Electron main process. `scripts/verify-subpaths.mjs` enforces that
 * guarantee against the packed tarball.
 *
 * `readNiftiArrayBuffer` is deliberately absent: it statically imports the
 * ESM-only `nifti-reader-js`, which would break `require('neuroimjs/io')`.
 * Pass an ArrayBuffer to `readVol` instead, or use `neuroimjs/browser`.
 *
 * @packageDocumentation
 */
export { readVol, writeVol, readHeader, readVolList, readVec, writeVec } from '../io/io';
export type { ReadVolOptions, WriteVolOptions, HeaderInfo } from '../io/io';
export { read_vol, write_vol } from '../io/nifti';
export {
  FileFormat,
  NIFTIFormat,
  NIFTIDualFormat,
  AFNIFormat,
  findDescriptor,
  getFormat,
} from '../io/formats';
export type { NeuroVol } from '../volume/NeuroVol';
export type { NeuroVec } from '../vec/NeuroVec';
