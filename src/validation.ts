/**
 * ARC-89 metadata JSON encode/decode and ARC-3 validation helpers.
 *
 * Ported from Python `asa_metadata_registry/validation.py`.
 */

import { MetadataArc3Error, MetadataEncodingError, InvalidArc3PropertiesError } from './errors'
import { REV_FLG_ARC20, REV_FLG_ARC62 } from './flags'
import { ARC3_PROPERTIES_KEY_ARC20, ARC3_PROPERTIES_KEY_ARC62, ARC3_PROPERTIES_KEYS } from './constants'

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

const startsWith = (data: Uint8Array, prefix: Uint8Array): boolean => {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Validate a positive uint64 represented as a JSON-parsed number.
 * @remarks Since parsing from JSON, expect a `number` input.
 *
 * @returns `true` if the value is type `number` and fits within the safe
 * integer range (2**53 - 1) and is greater than 0, `false` otherwise
 */
export const isPositiveUint64 = (value: unknown): boolean => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Decode ARC-89 metadata bytes into a JS object.
 *
 * ARC-89 requires a UTF-8 JSON *object*. Empty metadata bytes MUST be treated as `{}`.
 */
export const decodeMetadataJson = (metadata: Uint8Array): Record<string, unknown> => {
  if (metadata.length === 0) return {}

  // Reject UTF-8 BOM
  if (startsWith(metadata, UTF8_BOM)) {
    throw new MetadataEncodingError('Metadata MUST NOT include a UTF-8 BOM')
  }

  let txt: string
  try {
    txt = new TextDecoder('utf-8', { fatal: true }).decode(metadata)
  } catch (e) {
    throw new MetadataEncodingError('Metadata is not valid UTF-8', { cause: e })
  }

  let obj: unknown
  try {
    obj = JSON.parse(txt)
  } catch (e) {
    throw new MetadataEncodingError('Metadata is not valid JSON', { cause: e })
  }

  if (!isPlainObject(obj)) {
    throw new MetadataEncodingError('Metadata JSON MUST be an object')
  }
  return obj
}

/**
 * Encode a JSON object to UTF-8 bytes without BOM.
 *
 * The encoding is not canonicalized beyond JSON.stringify defaults; ARC-89 hashing uses raw bytes.
 */
export const encodeMetadataJson = (obj: Record<string, unknown>): Uint8Array => {
  let txt: string | undefined
  try {
    // JSON.stringify uses compact separators by default (no whitespace).
    txt = JSON.stringify(obj)
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
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new MetadataArc3Error(`ARC-3 field 'decimals' must be an integer, got ${typeof value}`)
      }
      if (value < 0) {
        throw new MetadataArc3Error(`ARC-3 field 'decimals' must be non-negative, got ${value}`)
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

  if (!isPositiveUint64(arcValue['application-id'])) {
    throw new InvalidArc3PropertiesError(`properties['${arcKey}']['application-id'] must be a positive uint64`)
  }
}
