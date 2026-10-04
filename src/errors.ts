/**
 * Typed error hierarchy for neuroimjs.
 *
 * Every error the library raises deliberately is a {@link NeuroimError} with a
 * stable machine-readable {@link NeuroimError.code}. Branch on the code (or use
 * {@link isNeuroimError}) instead of matching message text: messages may be
 * reworded between releases, codes may not.
 *
 * @module errors
 */

/**
 * Stable error codes carried by {@link NeuroimError}.
 *
 * - `INVALID_ARGUMENT`: an argument has the wrong shape, type or value
 *   (e.g. a non-finite spacing, an unknown axis name, a singular affine).
 * - `OUT_OF_RANGE`: an index or coordinate lies outside the valid range
 *   (e.g. a volume index past the end of a 4D file).
 * - `GEOMETRY_MISMATCH`: two spaces, volumes or axis sets that must agree do
 *   not (e.g. combining volumes on different voxel grids).
 * - `UNSUPPORTED_FORMAT`: the file format, or a valid feature of it, is not
 *   supported (unknown extension, writing a non-NIfTI format, a 5D NIfTI).
 * - `UNSUPPORTED_DATATYPE`: the voxel data type is not supported.
 * - `CORRUPT_FILE`: the bytes do not decode as the expected format (bad magic,
 *   unreadable header, invalid dimensions, truncated image data).
 * - `NOT_IMPLEMENTED`: the operation exists in the API but has no
 *   implementation for this input.
 * - `IO_ERROR`: reading from or writing to storage failed.
 */
export type NeuroimErrorCode =
  | 'INVALID_ARGUMENT'
  | 'OUT_OF_RANGE'
  | 'GEOMETRY_MISMATCH'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_DATATYPE'
  | 'CORRUPT_FILE'
  | 'NOT_IMPLEMENTED'
  | 'IO_ERROR';

/** All {@link NeuroimErrorCode} values, in documentation order. */
export const NEUROIM_ERROR_CODES: readonly NeuroimErrorCode[] = Object.freeze([
  'INVALID_ARGUMENT',
  'OUT_OF_RANGE',
  'GEOMETRY_MISMATCH',
  'UNSUPPORTED_FORMAT',
  'UNSUPPORTED_DATATYPE',
  'CORRUPT_FILE',
  'NOT_IMPLEMENTED',
  'IO_ERROR',
]);

/** Options accepted by {@link NeuroimError} and its subclasses. */
export interface NeuroimErrorOptions {
  /** The underlying error, when this error wraps another (ES2022 `cause`). */
  cause?: unknown;
  /** Structured context for programmatic handling, e.g. `{ index, count }`. */
  details?: Readonly<Record<string, unknown>>;
}

/**
 * Cross-realm brand. `Symbol.for` returns the same symbol in every copy of the
 * library, so {@link isNeuroimError} recognises errors from a duplicate install
 * (e.g. the CJS and ESM builds loaded side by side), where `instanceof` cannot.
 */
const NEUROIM_ERROR_BRAND = Symbol.for('neuroimjs.NeuroimError');

/** Base class for every error neuroimjs throws deliberately. */
export class NeuroimError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: NeuroimErrorCode;
  /** Structured context for programmatic handling, if any. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** The underlying error, if this error wraps another. */
  declare readonly cause?: unknown;

  constructor(code: NeuroimErrorCode, message: string, options: NeuroimErrorOptions = {}) {
    super(message);
    // Keep `instanceof` working even if this file is ever down-levelled to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'NeuroimError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    if ('cause' in options) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

/**
 * True when `error` is a {@link NeuroimError}, optionally with a given code.
 *
 * Besides `instanceof`, this accepts errors that carry the library's
 * cross-realm brand and a known `code`, so it also recognises errors created
 * by a second copy of the library (e.g. the CJS and ESM builds loaded together).
 */
export function isNeuroimError(error: unknown, code?: NeuroimErrorCode): error is NeuroimError {
  if (error instanceof NeuroimError) {
    return code === undefined || error.code === code;
  }
  if (typeof error !== 'object' || error === null) return false;
  const candidate = (error as { code?: unknown }).code;
  if (typeof candidate !== 'string' || !(NEUROIM_ERROR_CODES as readonly string[]).includes(candidate)) {
    return false;
  }
  if ((error as unknown as Record<symbol, unknown>)[NEUROIM_ERROR_BRAND] !== true) return false;
  return code === undefined || candidate === code;
}

Object.defineProperty(NeuroimError.prototype, NEUROIM_ERROR_BRAND, { value: true });

/** Options for the deprecated {@link ValueError}. */
export interface ValueErrorOptions extends NeuroimErrorOptions {
  /** Specific code; defaults to `INVALID_ARGUMENT`. */
  code?: NeuroimErrorCode;
}

/**
 * Legacy "bad value" error.
 *
 * @deprecated Catch with {@link isNeuroimError} and branch on `code` instead.
 * Library functions that historically threw `ValueError` still throw
 * instances of it (now with a specific `code`, `INVALID_ARGUMENT` by default)
 * so existing `instanceof ValueError` checks keep working until 1.0.
 */
export class ValueError extends NeuroimError {
  constructor(message: string, options: ValueErrorOptions = {}) {
    super(options.code ?? 'INVALID_ARGUMENT', message, options);
    this.name = 'ValueError';
  }
}

/**
 * A neuroimjs argument-type error (code `INVALID_ARGUMENT`).
 *
 * Replaces the former `TypeError` export, which shadowed the global
 * `TypeError` for `import * as nij` and named-import consumers.
 */
export class NeuroimTypeError extends NeuroimError {
  constructor(message: string, options: NeuroimErrorOptions = {}) {
    super('INVALID_ARGUMENT', message, options);
    this.name = 'NeuroimTypeError';
  }
}

/** Raised for API surface that has no implementation yet (code `NOT_IMPLEMENTED`). */
export class NotImplementedError extends NeuroimError {
  constructor(message: string = 'Method not implemented', options: NeuroimErrorOptions = {}) {
    super('NOT_IMPLEMENTED', message, options);
    this.name = 'NotImplementedError';
  }
}

/** Raised when reading from or writing to storage fails (code `IO_ERROR`). */
export class IOError extends NeuroimError {
  constructor(message: string, options: NeuroimErrorOptions = {}) {
    super('IO_ERROR', message, options);
    this.name = 'IOError';
  }
}
