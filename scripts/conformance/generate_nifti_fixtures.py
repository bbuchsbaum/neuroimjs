"""Generate nibabel-referenced NIfTI conformance fixtures for neuroimjs.

Run through the pinned, ephemeral uv environment (never a global Python):

    npm run conformance:generate

which executes scripts/conformance/generate.mjs -> this script. Every fixture is
written to disk first and then RE-LOADED WITH nibabel; all expected values in
the manifest come from that reload of the exact committed bytes, so the
manifest describes what nibabel reads from the file, not what we meant to write.

Outputs (deterministic; regenerating without code changes yields identical bytes):
    tests/conformance/fixtures/nifti/<case>.nii[.gz]
    tests/conformance/fixtures/manifest.json
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import platform
import struct
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from nibabel.affines import apply_affine, voxel_sizes
from nibabel.orientations import aff2axcodes
from nibabel.spatialimages import HeaderDataError

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tests" / "conformance" / "fixtures"
NIFTI_DIR = OUT_DIR / "nifti"

SHAPE3 = (3, 4, 5)  # distinct extents so an axis transposition cannot hide
SHAPE4 = (3, 4, 5, 3)

# Byte offsets of NIfTI-1 header fields that are patched after nibabel writes
# the file (used to build headers nibabel would never emit on its own).
N1_PIXDIM = 76
N1_SCL_SLOPE = 112
N1_SCL_INTER = 116
N1_QFORM_CODE = 252  # int16
N1_SFORM_CODE = 254  # int16

DTYPES = {
    "int8": np.int8,
    "uint8": np.uint8,
    "int16": np.int16,
    "uint16": np.uint16,
    "int32": np.int32,
    "uint32": np.uint32,
    "float32": np.float32,
    "float64": np.float64,
}


# --------------------------------------------------------------------------
# Data and affine builders
# --------------------------------------------------------------------------


def rng_for(case_id: str) -> np.random.Generator:
    seed = int.from_bytes(hashlib.sha256(case_id.encode()).digest()[:8], "little")
    return np.random.default_rng(seed)


def make_data(case_id: str, dtype_name: str, shape) -> np.ndarray:
    """Values covering the dtype's extremes plus a random interior."""
    dt = np.dtype(DTYPES[dtype_name])
    rng = rng_for(case_id)
    n = int(np.prod(shape))
    if dt.kind in "iu":
        info = np.iinfo(dt)
        vals = rng.integers(
            info.min,
            info.max,
            size=n,
            endpoint=True,
            dtype=np.int64 if dt != np.uint32 else np.uint64,
        )
        vals = vals.astype(dt)
        # Extremes and byte-order-sensitive patterns at fixed positions.
        specials = [info.min, info.max, 0, 1]
        if info.min < 0:
            specials.append(-1)
        if dt.itemsize > 1:
            specials.append(0x0102 if info.max >= 0x0102 else 2)
        for idx, v in enumerate(specials):
            vals[idx] = v
    else:
        vals = (rng.standard_normal(n) * 1000.0).astype(dt)
        specials = [0.0, -0.0, 1.0, -1.5, 1e-30, -3.25e30, 0.1]
        if dt == np.float64:
            specials += [1e-300, 1.7e300]
        for idx, v in enumerate(specials):
            vals[idx] = v
    # Reshape with Fortran order so that file order == our flat order.
    return vals.reshape(shape, order="F")


def rot(axis: str, deg: float) -> np.ndarray:
    t = np.deg2rad(deg)
    c, s = np.cos(t), np.sin(t)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def affine_from(R: np.ndarray, zooms, offset) -> np.ndarray:
    A = np.eye(4)
    A[:3, :3] = R @ np.diag(zooms)
    A[:3, 3] = offset
    return A


RAS = affine_from(np.eye(3), (2.0, 2.5, 3.0), (-3.0, -5.0, 6.5))
LAS = affine_from(
    np.diag([-1.0, 1.0, 1.0]), (2.0, 2.5, 3.0), (4.0, -5.0, 6.5)
)  # det < 0 -> qfac = -1
OBLIQUE = affine_from(
    rot("x", 17.0) @ rot("z", -11.0), (1.5, 2.0, 2.5), (-12.25, 8.5, -30.0)
)
OBLIQUE_NEG = affine_from(
    rot("y", 23.0) @ rot("x", -9.0) @ np.diag([-1.0, 1.0, 1.0]),
    (2.0, 1.75, 3.0),
    (40.0, -22.0, 15.5),
)
SHEAR = np.array(
    [
        [1.8, 0.25, -0.1, -20.0],
        [-0.15, 2.2, 0.3, 14.5],
        [0.05, -0.2, 2.9, -7.25],
        [0.0, 0.0, 0.0, 1.0],
    ]
)  # general sform (non-rigid): only representable as sform
ROTATED_90 = affine_from(
    np.array([[0.0, 0.0, 1.0], [-1.0, 0.0, 0.0], [0.0, -1.0, 0.0]]),
    (1.0, 2.0, 3.0),
    (10.0, 20.0, -30.0),
)


# --------------------------------------------------------------------------
# Writing helpers
# --------------------------------------------------------------------------


def build_image(
    data, *, fmt="nifti1", endian="<", qform=None, qcode=0, sform=None, scode=0
):
    header_cls = nib.Nifti2Header if fmt == "nifti2" else nib.Nifti1Header
    image_cls = nib.Nifti2Image if fmt == "nifti2" else nib.Nifti1Image
    hdr = header_cls(endianness=endian)
    hdr.set_data_dtype(data.dtype)
    img = image_cls(data, None, header=hdr)
    if qform is not None:
        img.set_qform(qform, code=int(qcode))
    else:
        img.set_qform(None, code=0)
    if sform is not None:
        img.set_sform(sform, code=int(scode))
    else:
        img.set_sform(None, code=0)
    if sform is not None and qform is None:
        # Keep pixdim consistent with the sform (nibabel leaves it at 1 here);
        # the deliberate mismatch case patches pixdim afterwards.
        img.header.set_zooms(
            tuple(float(v) for v in voxel_sizes(sform)) + img.header.get_zooms()[3:]
        )
    if data.ndim == 4:
        zooms = img.header.get_zooms()
        img.header.set_zooms(zooms[:3] + (2.0,))
        img.header.set_xyzt_units("mm", "sec")
    return img


def patch_n1(raw: bytearray, offset: int, value: float, code: str = "f") -> None:
    """Overwrite one NIfTI-1 header field in the file's own byte order."""
    endian = "<" if struct.unpack("<i", raw[0:4])[0] == 348 else ">"
    struct.pack_into(endian + code, raw, offset, value)


def write_case(case_id: str, img, *, compressed: bool, patches=None) -> Path:
    raw = bytearray(img.to_bytes())
    for patch in patches or []:
        patch_n1(raw, *patch)
    suffix = ".nii.gz" if compressed else ".nii"
    path = NIFTI_DIR / f"{case_id}{suffix}"
    if compressed:
        buf = io.BytesIO()
        # mtime=0 and no filename keep the gzip stream byte-for-byte reproducible.
        with gzip.GzipFile(
            filename="", mode="wb", fileobj=buf, mtime=0, compresslevel=9
        ) as gz:
            gz.write(bytes(raw))
        path.write_bytes(buf.getvalue())
    else:
        path.write_bytes(bytes(raw))
    return path


# --------------------------------------------------------------------------
# Expected values (from a nibabel reload of the written file)
# --------------------------------------------------------------------------


def num(x):
    """JSON-safe float: NaN/inf become null (callers document this)."""
    x = float(x)
    return x if np.isfinite(x) else None


def mat(a):
    return None if a is None else [[float(v) for v in row] for row in np.asarray(a)]


SAMPLE_VOXELS = [
    [0, 0, 0],
    [2, 3, 4],
    [1, 2, 3],
    [2, 0, 4],
    [0.5, 1.25, 3.75],
    [-1.0, 4.0, 2.5],
]


def load_fixed_float(path: Path):
    """Load `path` after applying nifti1_io's FIXED_FLOAT rule to the scaling fields.

    nifti1_io.c reads scl_slope and scl_inter through FIXED_FLOAT, which maps
    any non-finite value to 0. With scl_inter -> 0 a valid slope still scales;
    with scl_slope -> 0 scaling is disabled. Only the in-memory copy is
    patched; the committed fixture keeps its original bytes.
    """
    data = path.read_bytes()
    if path.suffix == ".gz":
        data = gzip.decompress(data)
    raw = bytearray(data)
    endian = "<" if struct.unpack("<i", raw[0:4])[0] == 348 else ">"
    for offset in (N1_SCL_SLOPE, N1_SCL_INTER):
        (value,) = struct.unpack_from(endian + "f", raw, offset)
        if not np.isfinite(value):
            patch_n1(raw, offset, 0.0)
    return nib.Nifti1Image.from_bytes(bytes(raw))


def describe(case_id: str, path: Path, spec: dict) -> dict:
    reference_note = None
    try:
        img = nib.load(str(path))
        if spec.get("fixed_float"):
            raise SystemExit(f"{case_id}: nibabel now loads this file; drop fixed_float")
    except HeaderDataError as err:
        if not spec.get("fixed_float"):
            raise
        img = load_fixed_float(path)
        reference_note = (
            f"nibabel {nib.__version__} refuses to load this file ({err}). Expected values "
            "follow nifti1_io's FIXED_FLOAT rule instead: a non-finite scl_slope or "
            "scl_inter is read as 0, so a valid slope with a NaN intercept scales by "
            "value * slope. Geometry and raw header fields still come from nibabel."
        )
    hdr = img.header  # as nibabel interprets it (check_fix applied, scaling moved to dataobj)
    with nib.openers.ImageOpener(str(path)) as fobj:
        raw = type(hdr).from_fileobj(fobj, check=False)  # field values exactly as stored
    fmt = "nifti2" if isinstance(img, nib.Nifti2Image) else "nifti1"
    assert fmt == spec["format"], (case_id, fmt)
    assert hdr.endianness == spec["endian"], (case_id, hdr.endianness)
    assert int(hdr["qform_code"]) == spec["qcode"], (
        case_id,
        "qform_code",
        int(hdr["qform_code"]),
    )
    assert int(hdr["sform_code"]) == spec["scode"], (
        case_id,
        "sform_code",
        int(hdr["sform_code"]),
    )

    affine = hdr.get_best_affine()
    assert np.allclose(affine, img.affine)
    qform, qcode = hdr.get_qform(coded=True)
    sform, scode = hdr.get_sform(coded=True)
    # nibabel moves scl_slope/scl_inter from the header into the array proxy on load.
    slope, inter = float(img.dataobj.slope), float(img.dataobj.inter)

    scaled = np.asarray(img.get_fdata(dtype=np.float64))
    unscaled = np.asarray(img.dataobj.get_unscaled())
    assert np.all(np.isfinite(scaled)), case_id

    if scaled.ndim == 3:
        vols_scaled = [scaled]
        vols_unscaled = [unscaled]
    else:
        vols_scaled = [scaled[..., t] for t in range(scaled.shape[3])]
        vols_unscaled = [unscaled[..., t] for t in range(unscaled.shape[3])]

    canonical = nib.as_closest_canonical(img)
    shape3 = img.shape[:3]
    entry = {
        "id": case_id,
        "description": spec["description"],
        "file": path.relative_to(OUT_DIR).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "format": fmt,
        "compressed": path.suffix == ".gz",
        "endian": "little" if hdr.endianness == "<" else "big",
        "tags": spec.get("tags", []),
        "shape": [int(s) for s in img.shape],
        "header": {
            "dim": [int(v) for v in raw["dim"]],
            "pixdim": [float(v) for v in raw["pixdim"]],
            "datatype": int(raw["datatype"]),
            "dtype": str(hdr.get_data_dtype().newbyteorder("=").name),
            "bitpix": int(raw["bitpix"]),
            "vox_offset": int(raw["vox_offset"]),
            "scl_slope": num(raw["scl_slope"]),
            "scl_inter": num(raw["scl_inter"]),
            "qform_code": int(qcode),
            "sform_code": int(scode),
            "zooms": [float(z) for z in hdr.get_zooms()],
        },
        "scaling": {"slope": slope, "inter": inter},
        "affine": mat(affine),
        "qform": mat(qform),
        "sform": mat(sform),
        "voxel_sizes": [float(v) for v in voxel_sizes(affine)],
        "axcodes": list(aff2axcodes(affine)),
        "canonical": {
            "shape": [int(s) for s in canonical.shape[:3]],
            "affine": mat(canonical.affine),
            "axcodes": list(aff2axcodes(canonical.affine)),
        },
        "samples": [
            {
                "ijk": [float(v) for v in ijk],
                "xyz": [float(v) for v in apply_affine(affine, ijk)],
            }
            for ijk in SAMPLE_VOXELS
        ],
        "volumes": [
            {
                # Fortran (x-fastest) order == NIfTI on-disk order == neuroimjs getData() order.
                "scaled": [float(v) for v in v_s.ravel(order="F")],
                "unscaled": [float(v) for v in v_u.ravel(order="F")],
            }
            for v_s, v_u in zip(vols_scaled, vols_unscaled)
        ],
        "_shape3": list(shape3),
    }
    if reference_note:
        entry["reference_note"] = reference_note
    return entry


# --------------------------------------------------------------------------
# Case table
# --------------------------------------------------------------------------


def cases():
    out = []

    def add(
        case_id,
        description,
        *,
        dtype="int16",
        shape=SHAPE3,
        fmt="nifti1",
        endian="<",
        compressed=False,
        qform=None,
        qcode=0,
        sform=None,
        scode=0,
        patches=None,
        tags=(),
        fixed_float=False,
    ):
        out.append(
            dict(
                id=case_id,
                description=description,
                dtype=dtype,
                shape=shape,
                format=fmt,
                endian=endian,
                compressed=compressed,
                qform=qform,
                qcode=qcode,
                sform=sform,
                scode=scode,
                patches=patches or [],
                tags=list(tags),
                fixed_float=fixed_float,
            )
        )

    # 1. Every datatype neuroimjs decodes, little-endian, sform+qform (nibabel default style).
    for name in DTYPES:
        add(
            f"dtype_{name}_le",
            f"{name} little-endian .nii, qform=sform=oblique (codes 1/2)",
            dtype=name,
            qform=OBLIQUE,
            qcode=1,
            sform=OBLIQUE,
            scode=2,
            tags=["dtype"],
        )

    # 2. Big-endian storage for every multi-byte datatype.
    for name in ["int16", "uint16", "int32", "uint32", "float32", "float64"]:
        add(
            f"dtype_{name}_be",
            f"{name} big-endian .nii",
            dtype=name,
            endian=">",
            sform=RAS,
            scode=2,
            tags=["dtype", "endian"],
        )

    # 3. Compression.
    add(
        "gz_int16_le",
        "int16 little-endian .nii.gz",
        compressed=True,
        sform=RAS,
        scode=2,
        tags=["gzip"],
    )
    add(
        "gz_float32_be",
        "float32 big-endian .nii.gz",
        dtype="float32",
        endian=">",
        compressed=True,
        sform=OBLIQUE,
        scode=2,
        tags=["gzip", "endian"],
    )

    # 4. scl_slope / scl_inter.
    add(
        "scl_int16_slope_inter",
        "int16 with scl_slope=0.5, scl_inter=-10.25",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 0.5), (N1_SCL_INTER, -10.25)],
        tags=["scaling"],
    )
    add(
        "scl_uint8_slope",
        "uint8 with scl_slope=2.75, scl_inter=0",
        dtype="uint8",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 2.75), (N1_SCL_INTER, 0.0)],
        tags=["scaling"],
    )
    add(
        "scl_int32_inter_only",
        "int32 with scl_slope=1, scl_inter=1000.5",
        dtype="int32",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 1.0), (N1_SCL_INTER, 1000.5)],
        tags=["scaling"],
    )
    add(
        "scl_float32_slope",
        "float32 with scl_slope=-3.5, scl_inter=7",
        dtype="float32",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, -3.5), (N1_SCL_INTER, 7.0)],
        tags=["scaling"],
    )
    add(
        "scl_int16_be_gz",
        "int16 big-endian .nii.gz with scl_slope=0.125, scl_inter=3",
        endian=">",
        compressed=True,
        sform=OBLIQUE,
        scode=2,
        patches=[(N1_SCL_SLOPE, 0.125), (N1_SCL_INTER, 3.0)],
        tags=["scaling", "endian", "gzip"],
    )
    add(
        "scl_slope_zero_with_inter",
        "scl_slope=0 (=> no scaling per spec) with a nonzero scl_inter=5",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 0.0), (N1_SCL_INTER, 5.0)],
        tags=["scaling", "edge"],
    )
    add(
        "scl_slope_nan",
        "scl_slope=NaN (=> no scaling) with a nonzero scl_inter=5",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, float("nan")), (N1_SCL_INTER, 5.0)],
        tags=["scaling", "edge"],
    )
    add(
        "scl_inter_nan",
        "valid scl_slope=2 with scl_inter=NaN (nibabel raises; FIXED_FLOAT reference)",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 2.0), (N1_SCL_INTER, float("nan"))],
        tags=["scaling", "edge"],
        fixed_float=True,
    )
    add(
        "scl_slope_one_inter_zero",
        "explicit scl_slope=1, scl_inter=0 (identity scaling)",
        dtype="int8",
        sform=RAS,
        scode=2,
        patches=[(N1_SCL_SLOPE, 1.0), (N1_SCL_INTER, 0.0)],
        tags=["scaling"],
    )

    # 5. qform / sform selection.
    add(
        "xform_qform_only_ras",
        "qform only (code 1), RAS, qfac=+1",
        qform=RAS,
        qcode=1,
        tags=["xform"],
    )
    add(
        "xform_qform_only_las",
        "qform only (code 1), LAS => negative qfac",
        qform=LAS,
        qcode=1,
        tags=["xform", "qfac"],
    )
    add(
        "xform_qform_only_oblique",
        "qform only, oblique rotation, qfac=+1",
        qform=OBLIQUE,
        qcode=1,
        tags=["xform", "oblique"],
    )
    add(
        "xform_qform_only_oblique_negqfac",
        "qform only, oblique rotation with negative qfac",
        qform=OBLIQUE_NEG,
        qcode=2,
        tags=["xform", "oblique", "qfac"],
    )
    add(
        "xform_qform_only_rot90",
        "qform only, 90-degree permuted axes (PIR-like)",
        qform=ROTATED_90,
        qcode=1,
        tags=["xform"],
    )
    add(
        "xform_qfac_zero",
        "qform only, RAS affine but pixdim[0]=0 (nibabel/nifti1_io treat as qfac=+1)",
        qform=RAS,
        qcode=1,
        patches=[(N1_PIXDIM, 0.0)],
        tags=["xform", "qfac", "edge"],
    )
    add(
        "xform_sform_only_shear",
        "sform only (code 2) general affine with shear",
        sform=SHEAR,
        scode=2,
        tags=["xform", "oblique"],
    )
    add(
        "xform_both_sform_code_higher",
        "qform (code 1, RAS) and sform (code 2, oblique) differ; sform_code > qform_code",
        qform=RAS,
        qcode=1,
        sform=OBLIQUE,
        scode=2,
        tags=["xform", "precedence"],
    )
    add(
        "xform_both_equal_codes",
        "qform and sform differ, both code 1",
        qform=LAS,
        qcode=1,
        sform=OBLIQUE_NEG,
        scode=1,
        tags=["xform", "precedence"],
    )
    add(
        "xform_both_qform_code_higher",
        "qform (code 2, RAS) and sform (code 1, oblique) differ; qform_code > sform_code",
        qform=RAS,
        qcode=2,
        sform=OBLIQUE,
        scode=1,
        tags=["xform", "precedence"],
    )
    add(
        "xform_none",
        "qform_code=sform_code=0 (no transform; pixdim only)",
        # nibabel always writes an sform on save, so zero both codes afterwards.
        patches=[
            (N1_QFORM_CODE, 0, "h"),
            (N1_SFORM_CODE, 0, "h"),
            (N1_PIXDIM, 1.0),
            (N1_PIXDIM + 4, 2.0),
            (N1_PIXDIM + 8, 2.5),
            (N1_PIXDIM + 12, 3.0),
        ],
        tags=["xform", "edge"],
    )
    add(
        "xform_sform_pixdim_mismatch",
        "sform only; pixdim[1:4] deliberately disagrees with sform column norms",
        sform=OBLIQUE,
        scode=2,
        patches=[(N1_PIXDIM + 4, 9.0), (N1_PIXDIM + 8, 9.0), (N1_PIXDIM + 12, 9.0)],
        tags=["xform", "edge"],
    )

    # 6. 4D files with oblique affines.
    add(
        "vec4d_int16_sform_oblique",
        "4D int16, 3 volumes, oblique sform",
        shape=SHAPE4,
        sform=OBLIQUE,
        scode=2,
        tags=["4d", "oblique"],
    )
    add(
        "vec4d_float32_qform_negqfac_gz",
        "4D float32 .nii.gz, oblique qform with negative qfac, scaled",
        dtype="float32",
        shape=SHAPE4,
        qform=OBLIQUE_NEG,
        qcode=1,
        compressed=True,
        patches=[(N1_SCL_SLOPE, 2.0), (N1_SCL_INTER, -1.0)],
        tags=["4d", "oblique", "scaling", "gzip"],
    )
    add(
        "vec4d_int16_be_shear",
        "4D int16 big-endian, sheared sform",
        shape=SHAPE4,
        endian=">",
        sform=SHEAR,
        scode=1,
        tags=["4d", "oblique", "endian"],
    )

    # 7. NIfTI-2.
    add(
        "nifti2_int16_sform",
        "NIfTI-2 int16, sform only (oblique)",
        fmt="nifti2",
        sform=OBLIQUE,
        scode=2,
        tags=["nifti2"],
    )
    add(
        "nifti2_float64_both",
        "NIfTI-2 float64, qform+sform identical (codes 1/1)",
        dtype="float64",
        fmt="nifti2",
        qform=LAS,
        qcode=1,
        sform=LAS,
        scode=1,
        tags=["nifti2"],
    )
    add(
        "nifti2_qform_only",
        "NIfTI-2 int16, qform only (sform_code 0)",
        fmt="nifti2",
        qform=OBLIQUE,
        qcode=1,
        tags=["nifti2", "xform"],
    )
    add(
        "nifti2_float32_be_gz",
        "NIfTI-2 float32 big-endian .nii.gz, sform only",
        dtype="float32",
        fmt="nifti2",
        endian=">",
        compressed=True,
        sform=SHEAR,
        scode=2,
        tags=["nifti2", "endian", "gzip"],
    )

    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", default="", help="recorded in the manifest")
    args = parser.parse_args()

    NIFTI_DIR.mkdir(parents=True, exist_ok=True)
    for old in NIFTI_DIR.glob("*.nii*"):
        old.unlink()

    script_bytes = Path(__file__).read_bytes()
    entries = []
    for spec in cases():
        data = make_data(spec["id"], spec["dtype"], spec["shape"])
        img = build_image(
            data,
            fmt=spec["format"],
            endian=spec["endian"],
            qform=spec["qform"],
            qcode=spec["qcode"],
            sform=spec["sform"],
            scode=spec["scode"],
        )
        if spec["patches"] and spec["format"] != "nifti1":
            raise SystemExit(f"{spec['id']}: header patches are NIfTI-1 offsets only")
        path = write_case(
            spec["id"], img, compressed=spec["compressed"], patches=spec["patches"]
        )
        entry = describe(spec["id"], path, spec)
        entry.pop("_shape3")
        entries.append(entry)

    manifest = {
        "schema": 1,
        "generator": {
            "script": "scripts/conformance/generate_nifti_fixtures.py",
            "sha256": hashlib.sha256(script_bytes).hexdigest(),
            "command": args.command,
            "python": platform.python_version(),
            "nibabel": nib.__version__,
            "numpy": np.__version__,
        },
        "conventions": {
            "data_order": "Each volume is flattened x-fastest (Fortran order), matching NIfTI storage.",
            "scaled": "nibabel img.get_fdata(dtype=float64) (scl_slope/scl_inter applied per nibabel rules).",
            "unscaled": "nibabel img.dataobj.get_unscaled() (raw stored values).",
            "affine": "nibabel header.get_best_affine(): sform if sform_code != 0, else qform if qform_code != 0, else base affine.",
            "samples": "xyz = nibabel.affines.apply_affine(affine, ijk).",
            "null": "NaN or infinite header floats are serialized as null.",
            "reference_note": "Present only on cases nibabel cannot load; explains where the expected values come from instead.",
        },
        "cases": entries,
    }
    out = OUT_DIR / "manifest.json"
    out.write_text(json.dumps(manifest, indent=1) + "\n")
    total = sum(p.stat().st_size for p in OUT_DIR.rglob("*") if p.is_file())
    print(
        f"wrote {len(entries)} cases to {OUT_DIR.relative_to(ROOT)} ({total} bytes total)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
