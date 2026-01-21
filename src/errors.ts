/**
 * SDK error hierarchy (ported from Python `asa_metadata_registry/errors.py`).
 *
 * Notes:
 * - In Python, several errors also inherit from `ValueError` / `LookupError` / `RuntimeError`.
 * - In TypeScript, we model the same taxonomy as distinct `Error` subclasses.
 */

export class AsaMetadataRegistryError extends Error {
  /** Optional underlying error/cause. */
  public readonly cause?: unknown

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message)
    this.name = new.target.name
    this.cause = options?.cause
    // Ensure `instanceof` works correctly when targeting older JS runtimes.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Raised when an operation requires the generated AppClient but none is configured. */
export class MissingAppClientError extends AsaMetadataRegistryError {}

/** Raised when an ARC-90 URI cannot be parsed or is not compatible with ARC-89. */
export class InvalidArc90UriError extends AsaMetadataRegistryError {}

/** Raised when an ASA is not found on-chain. */
export class AsaNotFoundError extends AsaMetadataRegistryError {}

/** Raised when the ASA exists but metadata is not present in the registry. */
export class MetadataNotFoundError extends AsaMetadataRegistryError {}

/** Raised when the expected metadata box does not exist. */
export class BoxNotFoundError extends AsaMetadataRegistryError {}

/** Raised when a metadata box value cannot be parsed according to ARC-89. */
export class BoxParseError extends AsaMetadataRegistryError {}

/** Raised when a flag index (reversible/irreversible) is out of bounds. */
export class InvalidFlagIndexError extends AsaMetadataRegistryError {}

/** Raised when a page index is out of bounds. */
export class InvalidPageIndexError extends AsaMetadataRegistryError {}

/** Raised when metadata bytes are not valid UTF-8 JSON object encoding (RFC 8259). */
export class MetadataEncodingError extends AsaMetadataRegistryError {}

/**
 * Raised when metadata bytes decode to valid UTF-8 JSON but the resulting object
 * does not conform to the ARC-3 JSON schema.
 */
export class MetadataArc3Error extends AsaMetadataRegistryError {}

/**
 * Raised when paginated metadata reads detect that metadata changed between pages
 * (last_modified_round mismatch).
 */
export class MetadataDriftError extends AsaMetadataRegistryError {}

/** Raised when the registry app id cannot be resolved from inputs. */
export class RegistryResolutionError extends AsaMetadataRegistryError {}

/**
 * Raised when the ASA metadata hash (am) does not match the computed hash.
 *
 * Per ARC-89: if an ASA has a non-zero metadata hash and is flagged as ARC89 native
 * but not ARC3 compliant, the ASA's metadata hash must match the computed hash.
 */
export class MetadataHashMismatchError extends AsaMetadataRegistryError {}
