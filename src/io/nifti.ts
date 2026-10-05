import { NeuroVol } from '../volume/NeuroVol';
import { readVol, writeVol } from './io';

// Re-export enhanced I/O functions
export { readVol as read_vol_async, writeVol as write_vol_async, readHeader, readVolList, readVec, writeVec } from './io';
export { FileFormat, NIFTIFormat, NIFTIDualFormat, AFNIFormat, findDescriptor, getFormat } from './formats';
export type { ReadVolOptions, WriteVolOptions, HeaderInfo } from './io';

/**
 * Read a NIfTI file and return a NeuroVol.
 *
 * Thin wrapper over {@link readVol} kept for backward compatibility. There are
 * two NIfTI decoders: `io.ts` (`readVol`, Node entry) and `browserNifti.ts`
 * (`readNiftiArrayBuffer`, browser entry). Both take intensity scaling and
 * affine voxel sizes from the shared helpers in `niftiGeometry.ts`.
 *
 * @param input - Path to the NIfTI file or an ArrayBuffer of its bytes.
 */
export async function read_vol(input: string | ArrayBuffer): Promise<NeuroVol> {
  return readVol(input);
}

/**
 * Write a NeuroVol to a NIfTI file.
 *
 * Thin wrapper over {@link writeVol} with default options; see `io.ts` for
 * the implementation. Compression follows the extension: a `.nii.gz` path is
 * gzipped and a `.nii` path is not.
 *
 * @param vol - The volume to write.
 * @param filePath - Destination path.
 */
export async function write_vol(vol: NeuroVol, filePath: string): Promise<void> {
  return writeVol(vol, filePath);
}
