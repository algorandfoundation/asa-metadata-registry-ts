/**
 * ARC-89 / ARC-90 codec utilities.
 *
 * Ported from Python `asa_metadata_registry/codec.py`.
 */

import * as constants from './constants.js'
import { InvalidArc90UriError } from './errors.js'
import { asBigInt, toBigInt } from './internal/numbers.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MAX_UINT64 = (1n << 64n) - 1n

const textDecoder = new TextDecoder()

// Pre-decoded ARC-90 URI constants
const ARC90_SCHEME_STR = textDecoder.decode(constants.ARC90_URI_SCHEME) // "algorand://"
const ARC90_APP_PATH_STR = textDecoder.decode(constants.ARC90_URI_APP_PATH) // "app/"
const ARC90_BOX_QUERY_STR = textDecoder.decode(constants.ARC90_URI_BOX_QUERY) // "?box="
const ARC90_BOX_QUERY_NAME_STR = textDecoder.decode(constants.ARC90_URI_BOX_QUERY_NAME) // "box"

const FRAGMENT_RE = /^arc(0|[1-9][0-9]*)(\+(0|[1-9][0-9]*))*$/
const NETAUTH_RE = /^(net:[A-Za-z0-9._-]+|gh:[A-Za-z0-9_-]+)$/
const APP_ID_RE = /^(0|[1-9][0-9]*)$/
const BOX_VALUE_RE = /^[A-Za-z0-9_-]*$/

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
export const b64Encode = (data: Uint8Array): string => Buffer.from(data).toString('base64')

/** Standard base64 decode (accepts padding). */
export const b64Decode = (dataB64: string): Uint8Array => new Uint8Array(Buffer.from(dataB64, 'base64'))

/** Canonical unpadded URL-safe base64. */
export const b64UrlEncode = (data: Uint8Array): string => Buffer.from(data).toString('base64url')

/**
 * Decode canonical unpadded URL-safe base64.
 *
 * @throws {Error} If the input has padding, characters outside the URL-safe alphabet, or is not
 * the canonical encoding of the decoded bytes (e.g. non-zero trailing bits).
 */
export const b64UrlDecode = (dataB64Url: string): Uint8Array => {
  if (!BOX_VALUE_RE.test(dataB64Url) || dataB64Url.length % 4 === 1) {
    throw new Error('Invalid base64url')
  }
  const decoded = new Uint8Array(Buffer.from(dataB64Url, 'base64url'))
  if (b64UrlEncode(decoded) !== dataB64Url) throw new Error('Non-canonical base64url')
  return decoded
}

/**
 * The ARC-90 compliance fragment '#arc<A>+<B>+...': unpadded decimal ARC numbers in
 * strictly ascending order, 'arc' literal on the first entry only, ARC-3 sole entry.
 * Non-compliant fragments parse as empty (ignored), as ARC-90 requires.
 */
export class Arc90Compliance {
  public readonly arcs: readonly number[]

  constructor(arcs: readonly number[] = []) {
    this.arcs = arcs
  }

  static parse(fragment?: string | null): Arc90Compliance {
    if (!fragment) return new Arc90Compliance([])
    const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment
    if (!FRAGMENT_RE.test(frag)) return new Arc90Compliance([])
    const arcs = frag
      .slice(3)
      .split('+')
      .map((p) => Number(p))
    if (arcs.some((n) => !Number.isSafeInteger(n))) return new Arc90Compliance([])
    for (let i = 1; i < arcs.length; i++) {
      if (arcs[i]! <= arcs[i - 1]!) return new Arc90Compliance([])
    }
    if (arcs.includes(3) && arcs.length > 1) return new Arc90Compliance([])
    return new Arc90Compliance(arcs)
  }

  toFragment(): string | null {
    if (!this.arcs.length) return null
    const arcs = [...new Set(this.arcs)].sort((a, b) => a - b)
    if (arcs.includes(3) && arcs.length > 1) {
      throw new Error('ARC-3 must be the sole entry in compliance fragment')
    }
    return `#arc${arcs.join('+')}`
  }
}

/**
 * Parsed ARC-90 URI referencing an application box.
 *
 * ARC-89 uses URIs of the form:
 *   algorand://<netauth>/app/<app_id>?box=<base64url_box_name>#arc<A>+<B>...
 *
 * The URI can be *partial* (Asset URL field), where the `box` query parameter exists
 * but has an empty value; the SDK can complete it given an Asset ID.
 */
export class Arc90Uri {
  /** Network authority; examples: "net:testnet", "gh:<base64url>", null (mainnet / unspecified). */
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
    if (this.boxName === null) return null
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

  /** Render the URI (canonical unpadded base64url box value). */
  toUri(): string {
    const box = this.boxName !== null ? b64UrlEncode(this.boxName) : ''
    const fragment = this.compliance.toFragment() ?? ''
    const authority = this.netauth ? `${this.netauth}/` : ''
    return `${ARC90_SCHEME_STR}${authority}${ARC90_APP_PATH_STR}${this.appId.toString()}${ARC90_BOX_QUERY_STR}${box}${fragment}`
  }

  /** The Algod `/box?name=` query parameter expects standard base64 (with padding). */
  toAlgodBoxNameB64(): string {
    if (this.boxName === null) throw new Error('Cannot produce algod box name for a partial URI')
    return b64Encode(this.boxName)
  }

  /**
   * Parse an ARC-89 Asset Metadata URI, with the exact shape the registry enforces:
   *
   *   algorand://[<netauth>/]app/<app_id>?box=<base64url>[#arc<A>+<B>...]
   *
   * where <netauth> is `net:<label>` or `gh:<base64url>` (absent on MainNet), <app_id>
   * is an unpadded decimal, `box` is the only query parameter and its value is empty
   * (partial URI) or the canonical unpadded base64url of the 8-byte Asset ID.
   */
  static parse(uri: string): Arc90Uri {
    if (!uri.startsWith(ARC90_SCHEME_STR)) {
      throw new InvalidArc90UriError(`Not an ${ARC90_SCHEME_STR} URI`)
    }
    let rest = uri.slice(ARC90_SCHEME_STR.length)

    let fragment = ''
    const hashIdx = rest.indexOf('#')
    if (hashIdx >= 0) {
      fragment = rest.slice(hashIdx + 1)
      rest = rest.slice(0, hashIdx)
    }
    if (fragment.includes('#')) throw new InvalidArc90UriError("Unexpected '#' in fragment")
    const compliance = Arc90Compliance.parse(fragment ? `#${fragment}` : null)

    const qIdx = rest.indexOf('?')
    let path = qIdx >= 0 ? rest.slice(0, qIdx) : rest
    const query = qIdx >= 0 ? rest.slice(qIdx + 1) : ''
    const boxPrefix = `${ARC90_BOX_QUERY_NAME_STR}=`
    if (qIdx < 0 || !query.startsWith(boxPrefix)) {
      throw new InvalidArc90UriError(`Missing '${ARC90_BOX_QUERY_NAME_STR}' query parameter`)
    }
    const boxValue = query.slice(boxPrefix.length)
    if (boxValue.includes('&')) throw new InvalidArc90UriError('Unexpected query parameter')
    if (!BOX_VALUE_RE.test(boxValue)) throw new InvalidArc90UriError('Invalid base64url box name')

    let netauth: string | null = null
    if (!path.startsWith(ARC90_APP_PATH_STR)) {
      const slashIdx = path.indexOf('/')
      const authority = slashIdx >= 0 ? path.slice(0, slashIdx) : path
      if (slashIdx < 0 || !NETAUTH_RE.test(authority)) {
        throw new InvalidArc90UriError('Unrecognized ARC-90 app URI shape')
      }
      path = path.slice(slashIdx + 1)
      if (!path.startsWith(ARC90_APP_PATH_STR)) {
        throw new InvalidArc90UriError(`Expected path '/${ARC90_APP_PATH_STR}<app_id>'`)
      }
      netauth = authority
    }
    const appIdStr = path.slice(ARC90_APP_PATH_STR.length)
    if (!APP_ID_RE.test(appIdStr) || BigInt(appIdStr) > MAX_UINT64) {
      throw new InvalidArc90UriError('Invalid app id in path')
    }

    let boxName: Uint8Array | null = null
    if (boxValue) {
      try {
        boxName = b64UrlDecode(boxValue)
      } catch (e) {
        throw new InvalidArc90UriError('Invalid base64url box name', { cause: e })
      }
      if (boxName.length !== constants.ASSET_METADATA_BOX_KEY_SIZE) {
        throw new InvalidArc90UriError('ARC-89 expects an 8-byte box name (asset id)')
      }
    }

    return new Arc90Uri({ netauth, appId: BigInt(appIdStr), boxName, compliance })
  }
}

/**
 * Complete an ARC-89 partial Asset URL (Asset Params `url`) into a full Asset Metadata URI.
 *
 * The partial URL is expected to include the registry app reference and `box=` query key, but
 * not the box value itself.
 *
 * Example (partial):
 *   algorand://net:testnet/app/772968354?box=#arc89
 *
 * Output (complete):
 *   algorand://net:testnet/app/772968354?box=<base64url(asset_id_bytes)>#arc89
 *
 * @throws {InvalidArc90UriError} If the Asset URL is not an ARC-89 partial URI (non-empty box value).
 */
export const completePartialAssetUrl = (assetUrl: string, assetId: bigint | number): string => {
  const parsed = Arc90Uri.parse(assetUrl)
  if (!parsed.isPartial) throw new InvalidArc90UriError('Asset URL MUST have an empty box value')
  return parsed.withAssetId(assetId).toUri()
}
