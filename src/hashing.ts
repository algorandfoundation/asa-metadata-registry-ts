/**
 * Hashing utilities for ARC-89/ARC-3.
 *
 * Ported from Python `asa_metadata_registry/hashing.py`.
 */

import { createHash, getHashes } from 'crypto'
import * as constants from './constants'
import { assetIdToBoxName } from './codec'
import { InvalidPageIndexError } from './errors'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MAX_UINT8 = 0xff
const MAX_UINT16 = 0xffff

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

const uint16ToBytesBE = (n: number): Uint8Array => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT16) throw new RangeError('metadata_size must fit in uint16')
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff])
}

const uint8ToByte = (n: number, name: string): Uint8Array => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT8) throw new RangeError(`${name} must fit in byte`)
  return new Uint8Array([n])
}

const sha = (algo: string, data: Uint8Array): Uint8Array => {
  // Ensure algorithm exists (for clearer errors, and parity with Python's explicit check).
  const available = getHashes()
  if (!available.includes(algo)) {
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
  // Reject impossible padding patterns (e.g. '=' in the middle)
  const firstPad = s.indexOf('=')
  if (firstPad !== -1 && firstPad < s.length - 2) throw new Error('Could not base64-decode "extra_metadata".')
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
 * Compute hh = SHA-512/256("arc0089/header" || asset_id || identifiers || rev_flags || irr_flags || metadata_size)
 */
export const computeHeaderHash = (args: {
  assetId: bigint | number
  metadataIdentifiers: number
  reversibleFlags: number
  irreversibleFlags: number
  metadataSize: number
}): Uint8Array => {
  const { assetId, metadataIdentifiers, reversibleFlags, irreversibleFlags, metadataSize } = args

  const data = concatBytes(
    constants.HASH_DOMAIN_HEADER,
    assetIdToBoxName(assetId),
    uint8ToByte(metadataIdentifiers, 'metadata_identifiers'),
    uint8ToByte(reversibleFlags, 'reversible_flags'),
    uint8ToByte(irreversibleFlags, 'irreversible_flags'),
    uint16ToBytesBE(metadataSize),
  )

  return sha512_256(data)
}

/** Split metadata bytes into ARC-89 pages. */
export const paginate = (metadata: Uint8Array, pageSize: number): Uint8Array[] => {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new RangeError('page_size must be > 0')
  if (metadata.length === 0) return []
  const out: Uint8Array[] = []
  for (let i = 0; i < metadata.length; i += pageSize) {
    out.push(metadata.slice(i, i + pageSize))
  }
  return out
}

/**
 * Compute ph[i] = SHA-512/256("arc0089/page" || asset_id || page_index || page_size || page_content)
 */
export const computePageHash = (args: {
  assetId: bigint | number
  pageIndex: number
  pageContent: Uint8Array
}): Uint8Array => {
  const { assetId, pageIndex, pageContent } = args

  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > MAX_UINT8) {
    throw new InvalidPageIndexError('page_index must fit in uint8')
  }
  if (pageContent.length < 0 || pageContent.length > MAX_UINT16) {
    throw new RangeError('page_content length must fit in uint16')
  }

  const data = concatBytes(
    constants.HASH_DOMAIN_PAGE,
    assetIdToBoxName(assetId),
    new Uint8Array([pageIndex]),
    uint16ToBytesBE(pageContent.length),
    pageContent,
  )

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
  let data = concatBytes(constants.HASH_DOMAIN_METADATA, hh)
  for (let i = 0; i < pages.length; i++) {
    const ph = computePageHash({ assetId, pageIndex: i, pageContent: pages[i] })
    data = concatBytes(data, ph)
  }

  return sha512_256(data)
}

/**
 * Compute the ARC-3 metadata hash:
 * - If JSON object contains "extra_metadata": am = SHA-512/256("arc0003/am" || sha512_256("arc0003/amj"||json) || extra)
 * - Else: sha256(json_bytes)
 */
export const computeArc3MetadataHash = (jsonBytes: Uint8Array): Uint8Array => {
  // UTF-8 decode (fatal, to mirror Python exceptions).
  let jsonText: string
  try {
    jsonText = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)
  } catch (e) {
    throw new Error('Metadata file must be UTF-8 encoded JSON.')
  }

  let obj: unknown
  try {
    obj = JSON.parse(jsonText)
  } catch (e) {
    throw new Error('Invalid JSON metadata file.')
  }

  if (obj && typeof obj === 'object' && !Array.isArray(obj) && 'extra_metadata' in obj) {
    const extraB64 = (obj as Record<string, unknown>)['extra_metadata']
    if (typeof extraB64 !== 'string') {
      throw new Error('"extra_metadata" must be a base64 string when present.')
    }

    const extra = base64DecodeStrict(extraB64)

    const jsonH = sha512_256(concatBytes(constants.ARC3_HASH_AMJ_PREFIX, jsonBytes))
    const am = sha512_256(concatBytes(constants.ARC3_HASH_AM_PREFIX, jsonH, extra))
    return am
  }

  return sha256(jsonBytes)
}
