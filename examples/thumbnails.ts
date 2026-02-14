import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';
import { read_vol } from '../src/io/nifti';
import { extractOrthogonalSlices } from '../src/volume/orthogonalSlices';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function writeSlicePNG(
  data: Float32Array | Float64Array | Uint8Array | Int16Array | Int32Array | Uint16Array | Int8Array,
  width: number,
  height: number,
  outPath: string,
): void {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const dest = imageData.data;

  // Compute min/max for simple normalization
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] as number;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Fill with flipped Y (common medical display expectation)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x;
      const v = data[srcIdx] as number;
      const n = max > min ? Math.max(0, Math.min(255, Math.round(((v - min) / (max - min)) * 255))) : 0;
      const fy = height - 1 - y; // flip Y
      const di = (fy * width + x) * 4;
      dest[di] = n;
      dest[di + 1] = n;
      dest[di + 2] = n;
      dest[di + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

async function main() {
  try {
    const filePath = path.join(__dirname, '..', 'tests', 'data', 'volumes', 'tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
    const outDir = path.join(__dirname, 'output', 'thumbnails');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    console.log('Loading NIfTI file:', filePath);
    const vol = await read_vol(filePath);
    // Use the volume center in world coordinates
    const centerVoxel = vol.dim.map((d) => (d - 1) / 2);
    const centerWorld = vol.space.gridToCoord(centerVoxel);

    const slices = extractOrthogonalSlices(vol, centerWorld);

    const items: Array<[string, typeof slices[keyof typeof slices]]> = [
      ['axial', slices.axial],
      ['sagittal', slices.sagittal],
      ['coronal', slices.coronal],
    ];

    for (const [name, slice] of items) {
      const data = slice.getData();
      const [w, h] = slice.dim;
      const outPath = path.join(outDir, `${name}.png`);
      writeSlicePNG(
        data as any,
        w,
        h,
        outPath,
      );
      console.log('Wrote', outPath);
    }
  } catch (err: any) {
    console.error('Error in thumbnails.ts:', err?.message || err);
    process.exit(1);
  }
}

main();

