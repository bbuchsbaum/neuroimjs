import { NeuroVol } from '../volume/NeuroVol';
import { readVol, writeVol } from './io';

// Re-export enhanced I/O functions
export { readVol as read_vol_async, writeVol as write_vol_async, readHeader, readVolList, readVec, writeVec } from './io';
export { FileFormat, NIFTIFormat, NIFTIDualFormat, AFNIFormat, findDescriptor, getFormat } from './formats';
export type { ReadVolOptions, WriteVolOptions, HeaderInfo } from './io';

/**
 * Read a NIfTI file and return a NeuroVol.
 *
 * Thin wrapper over {@link readVol} kept for backward compatibility. The single
 * source of truth for NIfTI parsing (scl_slope/scl_inter scaling, endianness,
 * affine reconstruction, gzip) lives in `io.ts`.
 *
 * @param input - Path to the NIfTI file or an ArrayBuffer of its bytes.
 */
export async function read_vol(input: string | ArrayBuffer): Promise<NeuroVol> {
  return readVol(input);
}

/**
 * Write a NeuroVol to a NIfTI file.
 *
 * Thin wrapper over {@link writeVol}; see `io.ts` for the implementation.
 *
 * @param vol - The volume to write.
 * @param filePath - Destination path.
 */
export async function write_vol(vol: NeuroVol, filePath: string): Promise<void> {
  return writeVol(vol, filePath);
}
