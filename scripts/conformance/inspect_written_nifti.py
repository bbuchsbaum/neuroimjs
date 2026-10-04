"""Load NIfTI files written by neuroimjs with nibabel and report what it sees.

Usage: python inspect_written_nifti.py FILE [FILE ...]

Prints one JSON object mapping each path to nibabel's view of the file: shape,
dtype, best affine, qform/sform and their codes, zooms (including pixdim[4]),
units, and the voxel data flattened x-fastest (Fortran order, NIfTI storage
order). Used by tests/conformance/nifti.writers.nibabel.test.ts, which runs it
through uv with the versions pinned in the conformance manifest.
"""

import json
import sys

import nibabel as nib
import numpy as np


def inspect(path):
    img = nib.load(path)
    hdr = img.header
    qform, qcode = hdr.get_qform(coded=True)
    sform, scode = hdr.get_sform(coded=True)
    data = np.asanyarray(img.dataobj)
    return {
        "shape": list(img.shape),
        "dtype": str(hdr.get_data_dtype()),
        "affine": img.affine.tolist(),
        "qform": None if qform is None else qform.tolist(),
        "qform_code": int(qcode),
        "sform": None if sform is None else sform.tolist(),
        "sform_code": int(scode),
        "zooms": [float(z) for z in hdr.get_zooms()],
        "units": list(hdr.get_xyzt_units()),
        "data": data.flatten(order="F").astype(np.float64).tolist(),
    }


def main(paths):
    json.dump({p: inspect(p) for p in paths}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1:])
