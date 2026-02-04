/**
 * ARC-89 / ARC-90 codec utilities.
 *
 * Ported from Python `asa_metadata_registry/codec.py`.
 */

import * as constants from './constants'
import { InvalidArc90UriError } from './errors'
import { asBigInt, toBigInt } from './internal/numbers'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MAX_UINT64 = (1n << 64n) - 1n

const textDecoder = new TextDecoder()

// Pre-decoded ARC-90 URI constants
const ARC90_SCHEME_STR = textDecoder.decode(constants.ARC90_URI_SCHEME_NAME)
const ARC90_APP_PATH_STR = textDecoder.decode(constants.ARC90_URI_APP_PATH_NAME)

const uint64ToBytesBE = (n: bigint): Uint8Array => {
  if (n < 0n || n > MAX_UINT64) throw new RangeError('value must fit in uint64')
  const out = new Uint8Array(8)
  let x = n
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

const bytesToUint64BE = (b: Uint8Array): bigint => {
  if (b.length !== 8) throw new RangeError('box_name must be 8 bytes')
  let out = 0n
  for (const byte of b) out = (out << 8n) | BigInt(byte)
  return out
}

const parseUint64Decimal = (s: string): bigint => {
  if (!/^[0-9]+$/.test(s)) throw new TypeError('value must be a base-10 unsigned integer string')
  const x = BigInt(s)
  if (x > MAX_UINT64) throw new RangeError('value must fit in uint64')
  return x
}

const parseQuery = (query: string): Map<string, string[]> => {
  // query comes without the leading '?'
  const out = new Map<string, string[]>()
  if (!query) return out
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const rawKey = eq >= 0 ? part.slice(0, eq) : part
    const rawVal = eq >= 0 ? part.slice(eq + 1) : ''
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, '%20'))
      const val = decodeURIComponent(rawVal.replace(/\+/g, '%20'))
      const arr = out.get(key)
      if (arr) arr.push(val)
      else out.set(key, [val])
    } catch (e) {
      throw new InvalidArc90UriError('Invalid percent-encoding in query string', { cause: e })
    }
  }
  return out
}

const splitUri = (uri: string): { scheme: string; netloc: string; path: string; query: string; fragment: string } => {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(uri)
  if (!m) throw new InvalidArc90UriError('Invalid URI')

  const scheme = m[1]
  let rest = m[2]

  let fragment = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    fragment = rest.slice(hashIdx + 1)
    rest = rest.slice(0, hashIdx)
  }

  let query = ''
  const qIdx = rest.indexOf('?')
  if (qIdx >= 0) {
    query = rest.slice(qIdx + 1)
    rest = rest.slice(0, qIdx)
  }

  const slashIdx = rest.indexOf('/')
  const netloc = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest
  const path = slashIdx >= 0 ? rest.slice(slashIdx) : ''

  return { scheme, netloc, path, query, fragment }
}

const _b64Encode = (data: Uint8Array): string => Buffer.from(data).toString('base64')

const _b64Decode = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'))

const _b64UrlEncode = (data: Uint8Array): string => {
  // Match Python's `base64.urlsafe_b64encode`: URL-safe alphabet AND padding.
  return _b64Encode(data).replace(/\+/g, '-').replace(/\//g, '_')
}

const _b64UrlDecode = (s: string): Uint8Array => {
  // Accept both padded and unpadded inputs.
  let x = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = x.length % 4
  if (pad === 2) x += '=='
  else if (pad === 3) x += '='
  else if (pad !== 0) throw new InvalidArc90UriError('Invalid base64url box name')
  return _b64Decode(x)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert an Asset ID (uint64) into the ARC-89 box key bytes (8-byte big-endian). */
export const assetIdToBoxName = (assetId: bigint | number): Uint8Array => {
  const id = toBigInt(assetId)
  return uint64ToBytesBE(id)
}

/** Convert an ARC-89 box key (8-byte big-endian) into an Asset ID (uint64). */
export const boxNameToAssetId = (boxName: Uint8Array): bigint => {
  if (boxName.length !== constants.ASSET_METADATA_BOX_KEY_SIZE) {
    throw new RangeError(`box_name must be ${constants.ASSET_METADATA_BOX_KEY_SIZE} bytes, got ${boxName.length}`)
  }
  return bytesToUint64BE(boxName)
}

/** Standard base64 (with padding). */
export const b64Encode = (data: Uint8Array): string => _b64Encode(data)

/** Standard base64 decode (accepts padding). */
export const b64Decode = (dataB64: string): Uint8Array => _b64Decode(dataB64)

/** URL-safe base64, per ARC-90 examples (padding preserved to match Python SDK). */
export const b64UrlEncode = (data: Uint8Array): string => _b64UrlEncode(data)

/** URL-safe base64 decode. */
export const b64UrlDecode = (dataB64Url: string): Uint8Array => _b64UrlDecode(dataB64Url)

/**
 * Represents the ARC-90 compliance fragment '#arc<A>+<B>+...'.
 *
 * Per ARC-90:
 * - Format: #arc<A>+<B>+<C> where A, B, C are decimal numbers
 * - First entry has 'arc' prefix, subsequent entries are bare numbers
 * - No leading zeros allowed
 * - Special case: ARC-3 must be sole entry (#arc3)
 * - Order is not enforced (clients MUST accept any order)
 */
export class Arc90Compliance {
  public readonly arcs: readonly number[]

  constructor(arcs: readonly number[] = []) {
    this.arcs = arcs
  }

  static parse(fragment?: string | null): Arc90Compliance {
    if (!fragment) return new Arc90Compliance([])

    const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment
    if (!frag) return new Arc90Compliance([])
    if (!frag.startsWith('arc')) return new Arc90Compliance([])

    const remainder = frag.slice(3)
    if (!remainder) return new Arc90Compliance([])

    const parts = remainder.split('+')
    const arcs: number[] = []

    for (const p of parts) {
      if (!p) return new Arc90Compliance([])
      if (p.length > 1 && p[0] === '0') return new Arc90Compliance([])
      const n = Number(p)
      if (!Number.isSafeInteger(n) || n < 0) return new Arc90Compliance([])
      arcs.push(n)
    }

    if (arcs.includes(3) && arcs.length > 1) return new Arc90Compliance([])
    return new Arc90Compliance(arcs)
  }

  toFragment(): string | null {
    if (!this.arcs.length) return null
    if (this.arcs.includes(3) && this.arcs.length > 1) {
      throw new Error('ARC-3 must be the sole entry in compliance fragment')
    }
    const parts: string[] = [`arc${this.arcs[0]}`]
    for (const n of this.arcs.slice(1)) parts.push(String(n))
    return `#${parts.join('+')}`
  }
}

/**
 * Parsed ARC-90 URI referencing an application box.
 *
 * ARC-89 uses URIs of the form:
 *   algorand://<netauth>/app/<app_id>?box=<base64url_box_name>#arc<A>+<B>...
 */
export class Arc90Uri {
  public readonly netauth: string | null
  public readonly appId: bigint
  public readonly boxName: Uint8Array | null
  public readonly compliance: Arc90Compliance

  constructor(args: {
    netauth: string | null
    appId: bigint | number
    boxName: Uint8Array | null
    compliance?: Arc90Compliance
  }) {
    this.netauth = args.netauth
    this.appId = asBigInt(args.appId, 'appId')
    this.boxName = args.boxName
    this.compliance = args.compliance ?? new Arc90Compliance([])
  }

  get assetId(): bigint | null {
    if (!this.boxName) return null
    return boxNameToAssetId(this.boxName)
  }

  get isPartial(): boolean {
    return this.boxName === null
  }

  withAssetId(assetId: bigint | number): Arc90Uri {
    return new Arc90Uri({
      netauth: this.netauth,
      appId: this.appId,
      boxName: assetIdToBoxName(assetId),
      compliance: this.compliance,
    })
  }

  /** Render the URI using ARC-89 conventions (base64url for box query parameter). */
  toUri(): string {
    const box = this.boxName ? _b64UrlEncode(this.boxName) : ''
    const frag = this.compliance.toFragment() ?? ''

    let netloc: string
    let path: string
    if (this.netauth) {
      netloc = this.netauth
      path = `${ARC90_APP_PATH_STR}/${this.appId.toString()}`
    } else {
      netloc = ARC90_APP_PATH_STR
      path = this.appId.toString()
    }

    const query = `box=${encodeURIComponent(box)}`
    const fragment = frag.startsWith('#') ? frag : frag ? `#${frag}` : ''
    return `${ARC90_SCHEME_STR}://${netloc}/${path}?${query}${fragment}`
  }

  /** The Algod `/box?name=` query parameter expects standard base64 (with padding). */
  toAlgodBoxNameB64(): string {
    if (!this.boxName) throw new Error('Cannot produce algod box name for a partial URI')
    return _b64Encode(this.boxName)
  }

  static parse(uri: string): Arc90Uri {
    const u = splitUri(uri)
    if (u.scheme !== 'algorand') {
      throw new InvalidArc90UriError(`Not an algorand:// URI`)
    }

    const compliance = Arc90Compliance.parse(u.fragment ? `#${u.fragment}` : null)
    const qs = parseQuery(u.query)
    if (!qs.has('box')) throw new InvalidArc90UriError("Missing 'box' query parameter")
    const boxValue = (qs.get('box') ?? [''])[0] ?? ''

    const pathSegs = u.path
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    let netauth: string | null = null
    let appId: bigint

    if (u.netloc.startsWith('net:')) {
      netauth = u.netloc
      if (pathSegs.length < 2 || pathSegs[0] !== 'app') {
        throw new InvalidArc90UriError("Expected path '/app/<app_id>' for net: URIs")
      }
      try {
        appId = parseUint64Decimal(pathSegs[1])
      } catch (e) {
        throw new InvalidArc90UriError('Invalid app id in path', { cause: e })
      }
    } else if (u.netloc === 'app' && pathSegs.length >= 1) {
      try {
        appId = parseUint64Decimal(pathSegs[0])
      } catch (e) {
        throw new InvalidArc90UriError('Invalid app id in path', { cause: e })
      }
    } else {
      throw new InvalidArc90UriError('Unrecognized ARC-90 app URI shape')
    }

    let boxName: Uint8Array | null
    if (boxValue === '') {
      boxName = null
    } else {
      let decoded: Uint8Array
      try {
        decoded = _b64UrlDecode(boxValue)
      } catch (e) {
        throw new InvalidArc90UriError('Invalid base64url box name', { cause: e })
      }
      if (decoded.length !== constants.ASSET_METADATA_BOX_KEY_SIZE) {
        throw new InvalidArc90UriError('ARC-89 expects an 8-byte box name (asset id)')
      }
      boxName = decoded
    }

    return new Arc90Uri({ netauth, appId, boxName, compliance })
  }
}

/**
 * Complete an ARC-89 partial Asset URL (Asset Params `url`) into a full Asset Metadata URI.
 */
export const completePartialAssetUrl = (assetUrl: string, assetId: bigint | number): string => {
  const parsed = Arc90Uri.parse(assetUrl)
  if (!parsed.isPartial) return parsed.toUri()
  return parsed.withAssetId(assetId).toUri()
}
