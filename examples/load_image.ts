import path from 'path';
import { fileURLToPath } from 'url';
import { read_vol } from '../src/io/nifti';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    // Use the bundled MNI file in tests/data for a reliable path
    const filePath = path.join(__dirname, '..', 'tests', 'data', 'volumes', 'tpl-MNI152NLin2009aAsym_res-1_T1w.nii.gz');
    console.log('Loading NIfTI file:', filePath);

    const vol = await read_vol(filePath);

    console.log('Loaded.');
    console.log('Dimensions:', vol.dim.join(' x '));
    console.log('Spacing  :', vol.spacing.join(' x '));
    console.log('Origin   :', vol.origin.join(', '));

    // Compute mean from underlying typed array for speed
    const data = vol.getData();
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] as number;
    const mean = sum / data.length;
    console.log('Mean intensity:', mean);
  } catch (err: any) {
    console.error('Error in load_image.ts:', err?.message || err);
    process.exit(1);
  }
}

main();

