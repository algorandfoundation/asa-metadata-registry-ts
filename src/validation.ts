/**
 * ARC-89 metadata JSON encode/decode and ARC-3 validation helpers.
 *
 * Ported from Python `asa_metadata_registry/validation.py`.
 */

import { MetadataArc3Error, MetadataEncodingError, InvalidArc3PropertiesError } from './errors'
import { REV_FLG_ARC20, REV_FLG_ARC62 } from './flags'
import { ARC3_PROPERTIES_KEY_ARC20, ARC3_PROPERTIES_KEY_ARC62, ARC3_PROPERTIES_KEYS } from './constants'
import { jsonIntegerMember, parseJsonStrict, stringifyJsonStrict } from './internal/json'

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean => {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const MAX_UINT64 = (1n << 64n) - 1n

/** JSON type name of a value that failed an integer check, for error messages. */
const jsonTypeName = (v: unknown): string => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  // A number failing the integer check is a non-integer, an unsafe integer or a float literal (`6.0`).
  if (typeof v === 'number') return 'float'
  return typeof v
}

/**
 * Validate a positive uint64 represented as a JSON-parsed number.
 * @remarks Since parsing from JSON, expect a `number` input. The ARC-3 validators check members
 * of decoded metadata exactly (integer literals, beyond 2^53 too) with Python's `int` semantics.
 *
 * @returns `true` if the value is type `number` and fits within the safe
 * integer range (2**53 - 1) and is greater than 0, `false` otherwise
 */
export const isPositiveUint64 = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Decode metadata bytes into UTF-8 text, rejecting a BOM and invalid UTF-8. */
const decodeMetadataText = (metadata: Uint8Array): string => {
  // Reject UTF-8 BOM
  if (startsWith(metadata, UTF8_BOM)) {
    throw new MetadataEncodingError('Metadata MUST NOT include a UTF-8 BOM')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(metadata)
  } catch (e) {
    throw new MetadataEncodingError('Metadata is not valid UTF-8', { cause: e })
  }
}

/**
 * Decode ARC-89 metadata bytes into a JS object.
 *
 * ARC-89 requires a UTF-8 JSON *object* (RFC 8259): duplicate object names, lone surrogate
 * escapes and non-finite numbers are rejected. Empty metadata bytes MUST be treated as `{}`.
 */
export const decodeMetadataJson = (metadata: Uint8Array): Record<string, unknown> => {
  if (metadata.length === 0) return {}

  const txt = decodeMetadataText(metadata)

  let parsed: ReturnType<typeof parseJsonStrict>
  try {
    parsed = parseJsonStrict(txt)
  } catch (e) {
    throw new MetadataEncodingError(`Metadata is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    })
  }
  if (parsed.scan.loneSurrogate) {
    throw new MetadataEncodingError('Metadata MUST NOT contain lone surrogate escapes')
  }

  if (!isPlainObject(parsed.value)) {
    throw new MetadataEncodingError('Metadata JSON MUST be an object')
  }
  return parsed.value
}

/**
 * Encode a JSON object to UTF-8 bytes without BOM.
 *
 * The encoding is compact (no whitespace) and not canonicalized further; ARC-89 hashing uses
 * raw bytes. Non-finite numbers and lone surrogates are rejected (RFC 8259). Numbers decoded by
 * {@link decodeMetadataJson} keep their source text (e.g. `1.0`, integers beyond 2^53) while
 * unchanged.
 */
export const encodeMetadataJson = (obj: Record<string, unknown>): Uint8Array => {
  let txt: string | undefined
  try {
    // JSON.stringify uses compact separators by default (no whitespace).
    txt = stringifyJsonStrict(obj)
  } catch (e) {
    throw new MetadataEncodingError('Object is not JSON-serializable', { cause: e })
  }

  // JSON.stringify returns undefined for a top-level `undefined`.
  if (txt === undefined) {
    throw new MetadataEncodingError('Object is not JSON-serializable')
  }

  const data = new TextEncoder().encode(txt)
  if (startsWith(data, UTF8_BOM)) {
    throw new MetadataEncodingError('Produced UTF-8 BOM; this should not happen')
  }
  return data
}

/**
 * Validate that a JSON object conforms to the ARC-3 JSON metadata schema according
 * to ARC-3.
 *
 * Raises MetadataArc3Error if validation fails.
 */
export const validateArc3Schema = (obj: Record<string, unknown>): void => {
  const stringFields = new Set([
    'name',
    'description',
    'image',
    'image_integrity',
    'image_mimetype',
    'background_color',
    'external_url',
    'external_url_integrity',
    'external_url_mimetype',
    'animation_url',
    'animation_url_integrity',
    'animation_url_mimetype',
    'unitName',
    'extra_metadata',
  ])

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'decimals') {
      const decimals = jsonIntegerMember(obj, key)
      if (decimals === undefined) {
        throw new MetadataArc3Error(`ARC-3 field 'decimals' must be an integer, got ${jsonTypeName(value)}`)
      }
      if (decimals < 0n) {
        throw new MetadataArc3Error(`ARC-3 field 'decimals' must be non-negative, got ${decimals}`)
      }
    } else if (key === 'properties') {
      if (!isPlainObject(value)) {
        throw new MetadataArc3Error(
          `ARC-3 field 'properties' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`,
        )
      }
    } else if (key === 'localization') {
      if (!isPlainObject(value)) {
        throw new MetadataArc3Error(
          `ARC-3 field 'localization' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`,
        )
      }
      const loc = value as Record<string, unknown>
      if (!('uri' in loc)) throw new MetadataArc3Error("ARC-3 'localization' object must have 'uri' field")
      if (!('default' in loc)) throw new MetadataArc3Error("ARC-3 'localization' object must have 'default' field")
      if (!('locales' in loc)) throw new MetadataArc3Error("ARC-3 'localization' object must have 'locales' field")

      if (typeof loc['uri'] !== 'string') throw new MetadataArc3Error("ARC-3 'localization.uri' must be a string")
      if (typeof loc['default'] !== 'string')
        throw new MetadataArc3Error("ARC-3 'localization.default' must be a string")
      if (!Array.isArray(loc['locales'])) throw new MetadataArc3Error("ARC-3 'localization.locales' must be an array")
      for (const locale of loc['locales']) {
        if (typeof locale !== 'string') {
          throw new MetadataArc3Error("ARC-3 'localization.locales' entries must be strings")
        }
      }
    } else if (stringFields.has(key)) {
      if (typeof value !== 'string') {
        throw new MetadataArc3Error(`ARC-3 field '${key}' must be a string, got ${typeof value}`)
      }
    }
    // Other fields are allowed (for extensibility) but are not validated.
  }
}

/**
 * Validate that ARC-3 metadata JSON object has valid values for ARC-3 fields.
 *
 * Currently validates that the `decimals` field (when present) matches the on-chain ASA decimals.
 */
export const validateArc3Values = (obj: Record<string, unknown>, asaDecimals: number): void => {
  if (!('decimals' in obj)) return // ARC-3 allows omission; only enforce when present

  const dec = jsonIntegerMember(obj, 'decimals')
  if (dec === undefined) {
    throw new MetadataArc3Error(`ARC-3 field 'decimals' must be an integer, got ${jsonTypeName(obj['decimals'])}`)
  }

  if (dec !== BigInt(asaDecimals)) {
    throw new MetadataArc3Error(`ARC-3 field 'decimals' must match ASA decimals (${asaDecimals}), got ${dec}`)
  }
}

/**
 * Check if a JSON object contains ARC-3 specific fields.
 *
 * Returns true if the object contains ARC-3 indicator fields like decimals,
 * properties, or localization.
 */
export const isArc3Metadata = (obj: Record<string, unknown>): boolean => {
  const indicator = new Set(['decimals', 'properties', 'localization'])
  return Object.keys(obj).some((k) => indicator.has(k))
}

/**
 * ARC-3 metadata `properties` keys for reversible flags.
 */
export type Arc3PropertiesKeys = (typeof ARC3_PROPERTIES_KEYS)[number]

/** Map a reversible flag index to the corresponding ARC-3 properties key. */
export const ARC3_PROPERTIES_FLAG_TO_KEY: Partial<Record<number, Arc3PropertiesKeys>> = {
  [REV_FLG_ARC20]: ARC3_PROPERTIES_KEY_ARC20,
  [REV_FLG_ARC62]: ARC3_PROPERTIES_KEY_ARC62,
}

/**
 * Enforce: if metadata is declared ARC-20 and/or ARC-62, then it must be ARC-3.
 *
 * Raises `MetadataArc3Error` if ARC-20 or ARC-62 is set without ARC-3.
 */
export const validateArc20Arc62RequireArc3 = (args: {
  revArc20: boolean
  revArc62: boolean
  irrArc3: boolean
}): void => {
  if ((args.revArc20 || args.revArc62) && !args.irrArc3) {
    throw new MetadataArc3Error('ARC-20 and ARC-62 require ARC-3 metadata')
  }
}

/**
 * Validate that ARC-3 metadata `body` has a valid `arcKey` entry in properties.
 *
 * Per ARC-20 and ARC-62, the value must be an object with an "application-id" key
 * whose value is a valid app ID (positive uint64).
 *
 * Raises `InvalidArc3PropertiesError` if validation fails.
 */
export const validateArc3Properties = (body: Record<string, unknown>, arcKey: Arc3PropertiesKeys): void => {
  const properties = body['properties']
  if (!isPlainObject(properties)) {
    throw new InvalidArc3PropertiesError(`${arcKey.toUpperCase()} metadata must have a valid 'properties' field`)
  }

  const arcValue = properties[arcKey]
  if (!isPlainObject(arcValue)) {
    throw new InvalidArc3PropertiesError(`properties['${arcKey}'] must be an object`)
  }

  const appId = jsonIntegerMember(arcValue, 'application-id')
  if (appId === undefined || appId <= 0n || appId > MAX_UINT64) {
    throw new InvalidArc3PropertiesError(`properties['${arcKey}']['application-id'] must be a positive uint64`)
  }
}
