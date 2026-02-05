/**
 * Hashing utilities for ARC-89/ARC-3.
 *
 * Ported from Python `asa_metadata_registry/hashing.py`.
 */

import { createHash, getHashes } from 'crypto'
import * as constants from './constants'
import { assetIdToBoxName } from './codec'
import { InvalidPageIndexError } from './errors'
import { concatBytes } from './internal/bytes'
import { MAX_UINT8, MAX_UINT16 } from './internal/numbers'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const uint16ToBytesBE = (n: number, name: string): Uint8Array => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT16) throw new RangeError(`${name} must fit in uint16`)
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff])
}

const uint8ToByte = (n: number, name: string): Uint8Array => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT8) throw new RangeError(`${name} must fit in byte`)
  return new Uint8Array([n])
}

/** Cached set of available hash algorithms for O(1) lookup */
const availableHashes = new Set(getHashes())

/** Reusable UTF-8 decoder with fatal error handling */
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const sha = (algo: string, data: Uint8Array): Uint8Array => {
  // Ensure algorithm exists (for clearer errors, and parity with Python's explicit check).
  if (!availableHashes.has(algo)) {
    throw new Error(`crypto does not support ${algo} on this Node build`)
  }
  const h = createHash(algo)
  h.update(Buffer.from(data))
  return new Uint8Array(h.digest())
}

const base64DecodeStrict = (s: string): Uint8Array => {
  // Mimic Python's base64.b64decode(..., validate=True)
  // - only base64 alphabet characters
  // - proper padding
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('Could not base64-decode "extra_metadata".')
  if (s.length % 4 !== 0) throw new Error('Could not base64-decode "extra_metadata".')
  return new Uint8Array(Buffer.from(s, 'base64'))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** SHA-512/256 digest. */
export const sha512_256 = (data: Uint8Array): Uint8Array => sha('sha512-256', data)

/** SHA-256 digest. */
export const sha256 = (data: Uint8Array): Uint8Array => sha('sha256', data)

/**
 * Compute hh = SHA-512/256("arc0089/header" || assetId || identifiers || revFlags || irrFlags || metadataSize)
 */
export const computeHeaderHash = (args: {
  assetId: bigint | number
  metadataIdentifiers: number
  reversibleFlags: number
  irreversibleFlags: number
  metadataSize: number
}): Uint8Array => {
  const { assetId, metadataIdentifiers, reversibleFlags, irreversibleFlags, metadataSize } = args

  const data = concatBytes([
    constants.HASH_DOMAIN_HEADER,
    assetIdToBoxName(assetId),
    uint8ToByte(metadataIdentifiers, 'metadataIdentifiers'),
    uint8ToByte(reversibleFlags, 'reversibleFlags'),
    uint8ToByte(irreversibleFlags, 'irreversibleFlags'),
    uint16ToBytesBE(metadataSize, 'metadataSize'),
  ])

  return sha512_256(data)
}

/** Split metadata bytes into ARC-89 pages. */
export const paginate = (metadata: Uint8Array, pageSize: number): Uint8Array[] => {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new RangeError('pageSize must be > 0')
  if (metadata.length === 0) return []
  const out: Uint8Array[] = []
  for (let i = 0; i < metadata.length; i += pageSize) {
    out.push(metadata.slice(i, i + pageSize))
  }
  return out
}

/**
 * Compute ph[i] = SHA-512/256("arc0089/page" || assetId || pageIndex || pageSize || pageContent)
 */
export const computePageHash = (args: {
  assetId: bigint | number
  pageIndex: number
  pageContent: Uint8Array
}): Uint8Array => {
  const { assetId, pageIndex, pageContent } = args

  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > MAX_UINT8) {
    throw new InvalidPageIndexError('pageIndex must fit in uint8')
  }

  const data = concatBytes([
    constants.HASH_DOMAIN_PAGE,
    assetIdToBoxName(assetId),
    new Uint8Array([pageIndex]),
    uint16ToBytesBE(pageContent.length, 'pageContent length'),
    pageContent,
  ])

  return sha512_256(data)
}

/**
 * Compute the ARC-89 Metadata Hash:
 *   am = SHA-512/256("arc0089/am" || hh || ph[0] || ...)
 */
export const computeMetadataHash = (args: {
  assetId: bigint | number
  metadataIdentifiers: number
  reversibleFlags: number
  irreversibleFlags: number
  metadata: Uint8Array
  pageSize: number
}): Uint8Array => {
  const { assetId, metadataIdentifiers, reversibleFlags, irreversibleFlags, metadata, pageSize } = args

  const hh = computeHeaderHash({
    assetId,
    metadataIdentifiers,
    reversibleFlags,
    irreversibleFlags,
    metadataSize: metadata.length,
  })

  const pages = paginate(metadata, pageSize)
  const pageHashes: Uint8Array[] = new Array(pages.length)
  for (let i = 0; i < pages.length; i++) {
    pageHashes[i] = computePageHash({ assetId, pageIndex: i, pageContent: pages[i] })
  }
  const data = concatBytes([constants.HASH_DOMAIN_METADATA, hh, ...pageHashes])

  return sha512_256(data)
}

/**
 * Compute the ARC-3 metadata hash:
 * - If JSON object contains "extra_metadata": am = SHA-512/256("arc0003/am" || sha512256("arc0003/amj"||json) || extra)
 * - Else: sha256(json_bytes)
 */
export const computeArc3MetadataHash = (jsonBytes: Uint8Array): Uint8Array => {
  // UTF-8 decode (fatal, to mirror Python exceptions).
  let jsonText: string
  try {
    jsonText = utf8Decoder.decode(jsonBytes)
  } catch {
    throw new Error('Metadata file must be UTF-8 encoded JSON.')
  }

  let obj: unknown
  try {
    obj = JSON.parse(jsonText)
  } catch {
    throw new Error('Invalid JSON metadata file.')
  }

  if (obj && typeof obj === 'object' && !Array.isArray(obj) && 'extra_metadata' in obj) {
    const extraB64 = (obj as Record<string, unknown>)['extra_metadata']
    if (typeof extraB64 !== 'string') {
      throw new Error('"extra_metadata" must be a base64 string when present.')
    }

    const extra = base64DecodeStrict(extraB64)

    const jsonH = sha512_256(concatBytes([constants.ARC3_HASH_AMJ_PREFIX, jsonBytes]))
    const am = sha512_256(concatBytes([constants.ARC3_HASH_AM_PREFIX, jsonH, extra]))
    return am
  }

  return sha256(jsonBytes)
}
