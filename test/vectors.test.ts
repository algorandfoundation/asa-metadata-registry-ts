/**
 * The SDK reproduces the published ARC-89 conformance vectors.
 *
 * Ported from Python `tests/sdk/test_vectors.py`. The vectors are read from the `arc89` git
 * submodule (`arc89/tests/vectors/arc89_vectors.json`).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import {
  AssetMetadata,
  codec,
  constants as c,
  MbrDeltaSign,
  MetadataBody,
  MetadataFlags,
  MetadataHeader,
} from '@algorandfoundation/asa-metadata-registry-sdk'

interface BoxNameVector {
  /** uint64, read exactly (the vectors include 2^63 - 1 and 2^64 - 1). */
  asset_id: bigint
  box_name_hex: string
  arc90_box_param: string
  algod_box_name: string
  algod_box_name_query: string
}

interface MetadataVector {
  name: string
  body: string
  metadata_size: number
  identifiers: number
  reversible_flags: number
  irreversible_flags: number
  header_hash: string
  page_hashes: string[]
  metadata_hash: string
  revision: number
  deprecated_by: number
  header_hex: string
  box_mbr: number
}

interface Arc89Vectors {
  description: string
  parameters: {
    box_key_size: number
    header_size: number
    page_size: number
    short_metadata_size: number
    max_metadata_size: number
    flat_mbr: number
    byte_mbr: number
  }
  hash_domains: { header: string; page: string; metadata: string }
  box_names: BoxNameVector[]
  metadata: MetadataVector[]
}

const VECTORS_PATH = resolve(__dirname, '../arc89/tests/vectors/arc89_vectors.json')

/** `asset_id` values exceed 2^53 - 1: read them exactly from the JSON source text. */
const readAssetIdExactly = (key: string, value: unknown, context?: { source?: string }): unknown => {
  if (key !== 'asset_id') return value
  if (context?.source === undefined) throw new Error('JSON.parse source text access is required to read asset_id')
  return BigInt(context.source)
}

const VECTORS = JSON.parse(readFileSync(VECTORS_PATH, 'utf8'), readAssetIdExactly) as Arc89Vectors

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** Strict hex decoding (like Python's `bytes.fromhex`, unlike `Buffer.from(..., 'hex')`). */
const fromHex = (h: string): Uint8Array => {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error(`Invalid hex string: ${h}`)
  return new Uint8Array(Buffer.from(h, 'hex'))
}

test('parameters', () => {
  const p = VECTORS.parameters
  expect(p.header_size).toBe(c.HEADER_SIZE)
  expect(p.page_size).toBe(c.PAGE_SIZE)
  expect(p.short_metadata_size).toBe(c.SHORT_METADATA_SIZE)
  expect(p.max_metadata_size).toBe(c.MAX_METADATA_SIZE)
  expect([p.flat_mbr, p.byte_mbr]).toEqual([c.FLAT_MBR, c.BYTE_MBR])

  // TS addition: the other published parameters
  expect(p.box_key_size).toBe(c.ASSET_METADATA_BOX_KEY_SIZE)
  const text = new TextDecoder()
  expect(VECTORS.hash_domains).toEqual({
    header: text.decode(c.HASH_DOMAIN_HEADER),
    page: text.decode(c.HASH_DOMAIN_PAGE),
    metadata: text.decode(c.HASH_DOMAIN_METADATA),
  })
})

test('box name vectors are read exactly', () => {
  // Guard for the exact `asset_id` parsing above (JSON numbers are only exact up to 2^53 - 1).
  expect(VECTORS.box_names.map((v) => v.asset_id)).toEqual([0n, 1n, 12345n, 2n ** 32n, 2n ** 63n - 1n, 2n ** 64n - 1n])
})

test.each(VECTORS.box_names)('box name vector $asset_id', (vector) => {
  const raw = codec.assetIdToBoxName(vector.asset_id)
  const std = codec.b64Encode(raw)
  expect(hex(raw)).toBe(vector.box_name_hex)
  expect(codec.b64UrlEncode(raw)).toBe(vector.arc90_box_param) // unpadded base64url
  expect(`b64:${std}`).toBe(vector.algod_box_name)
  // Python: `quote("b64:" + std, safe="")`, equivalent to `encodeURIComponent` on base64 text
  expect(encodeURIComponent(`b64:${std}`)).toBe(vector.algod_box_name_query)
})

test.each(VECTORS.metadata)('metadata vector $name', (vector) => {
  const md = new AssetMetadata({
    assetId: 0n,
    body: new MetadataBody(new TextEncoder().encode(vector.body)),
    flags: MetadataFlags.fromBytes(vector.reversible_flags, vector.irreversible_flags),
    deprecatedBy: 0n,
  })
  expect(md.body.size).toBe(vector.metadata_size)
  expect(md.identifiersByte).toBe(vector.identifiers)
  expect(hex(md.computeHeaderHash())).toBe(vector.header_hash)
  expect(Array.from({ length: md.body.totalPages() }, (_, i) => hex(md.computePageHash({ pageIndex: i })))).toEqual(
    vector.page_hashes,
  )
  expect(hex(md.computeArc89MetadataHash())).toBe(vector.metadata_hash)
  expect(md.getMbrDelta().amount).toBe(vector.box_mbr)
  expect(md.getDeleteMbrDelta().amount).toBe(vector.box_mbr)
  const header = fromHex(vector.header_hex)
  expect(header.length).toBe(c.HEADER_SIZE)
  expect(header.slice(0, 3 + 32)).toEqual(
    new Uint8Array([
      md.identifiersByte,
      vector.reversible_flags,
      vector.irreversible_flags,
      ...md.computeArc89MetadataHash(),
    ]),
  )

  // TS addition: Box MBR signs (creation delta POS, deletion delta NEG) and the whole header,
  // serialized by the SDK with the published revision and deprecated_by.
  expect(md.getMbrDelta().sign).toBe(MbrDeltaSign.POS)
  expect(md.getDeleteMbrDelta().sign).toBe(MbrDeltaSign.NEG)
  const serialized = new MetadataHeader({
    identifiers: md.identifiersByte,
    flags: md.flags,
    metadataHash: md.computeArc89MetadataHash(),
    revision: vector.revision,
    deprecatedBy: vector.deprecated_by,
  }).serialized
  expect(hex(serialized)).toBe(vector.header_hex)
})
