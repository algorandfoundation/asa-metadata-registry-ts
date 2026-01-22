/**
 * Algod helpers (Phase 5).
 *
 * Ported from Python `asa_metadata_registry/algod.py`.
 *
 * The SDK intentionally depends on the *minimal* subset of Algod required to
 * read application boxes and ASA params.
 *
 * The JS Algod client (algosdk.Algodv2) uses a request-builder pattern:
 * `algod.getX(...).do()`.
 *
 * This module accepts either that pattern or plain async functions to keep the
 * dependency surface flexible for testing/mocking.
 */

import { Arc90Uri, assetIdToBoxName, b64_decode, completePartialAssetUrl } from './codec'
import { AsaNotFoundError, BoxNotFoundError, InvalidArc90UriError } from './errors'
import { AssetMetadataBox, AssetMetadataRecord, RegistryParameters, getDefaultRegistryParams } from './models'

type Mapping = Record<string, unknown>

type Doable<T> = { do(): Promise<T> }

const isMapping = (v: unknown): v is Mapping => typeof v === 'object' && v !== null

const asErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  try {
    return String(e)
  } catch {
    return ''
  }
}

const looksNotFound = (e: unknown): boolean => {
  const msg = asErrorMessage(e).toLowerCase()
  return msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')
}

const resolveDo = async <T>(maybe: T | Promise<T> | Doable<T>): Promise<T> => {
  if (isMapping(maybe) && typeof (maybe as Doable<T>).do === 'function') {
    return (maybe as Doable<T>).do()
  }
  return await Promise.resolve(maybe as T)
}

/**
 * Minimal shape needed from an Algod client.
 *
 * Supports either:
 * - algosdk.Algodv2 (`getApplicationBoxByName`, `getAssetByID` returning `.do()` builders)
 * - or mock clients exposing async methods that directly return results.
 */
export interface AlgodClientLike {
  // Application box read
  getApplicationBoxByName?: (appId: number, boxName: Uint8Array) => Doable<unknown> | Promise<unknown> | unknown
  applicationBoxByName?: (appId: number, boxName: Uint8Array) => Doable<unknown> | Promise<unknown> | unknown

  // ASA info
  getAssetByID?: (assetId: number) => Doable<unknown> | Promise<unknown> | unknown
  assetInfo?: (assetId: number) => Doable<unknown> | Promise<unknown> | unknown
}

/**
 * Read ARC-89 metadata by directly reading the registry application box via Algod.
 *
 * This avoids transactions entirely and is usually the fastest read path.
 */
export class AlgodBoxReader {
  public readonly algod: AlgodClientLike

  constructor(algod: AlgodClientLike) {
    this.algod = algod
  }

  /** Fetch a raw box value. Throws BoxNotFoundError if the box doesn't exist. */
  async getBoxValue(args: { appId: bigint | number; boxName: Uint8Array }): Promise<Uint8Array> {
    const appId = Number(args.appId)

    const fn = this.algod.getApplicationBoxByName ?? this.algod.applicationBoxByName
    if (!fn) throw new Error('Algod client does not support application box reads')

    let resp: unknown
    try {
      resp = await resolveDo(fn.call(this.algod, appId, args.boxName))
    } catch (e) {
      if (looksNotFound(e)) throw new BoxNotFoundError('Box not found', { cause: e })
      throw e
    }

    // Common response shapes:
    // - { name: string, value: string }
    // - { box: { name: string, value: string } }
    // - (rare) { value: Uint8Array }
    let value: unknown = undefined
    if (isMapping(resp)) {
      if ('value' in resp) value = resp.value
      else if ('box' in resp && isMapping(resp.box) && 'value' in resp.box) value = resp.box.value
    }

    if (typeof value === 'string') return b64_decode(value)
    if (value instanceof Uint8Array) return value

    throw new Error('Unexpected algod response shape for application box read')
  }

  /** Return the parsed metadata box, or null if the box doesn't exist. */
  async tryGetMetadataBox(args: {
    appId: bigint | number
    assetId: bigint | number
    params?: RegistryParameters
  }): Promise<AssetMetadataBox | null> {
    let value: Uint8Array
    try {
      value = await this.getBoxValue({ appId: args.appId, boxName: assetIdToBoxName(args.assetId) })
    } catch (e) {
      if (e instanceof BoxNotFoundError) return null
      throw e
    }

    const p = args.params ?? getDefaultRegistryParams()
    return AssetMetadataBox.parse({ assetId: args.assetId, value, headerSize: p.headerSize, maxMetadataSize: p.maxMetadataSize })
  }

  /** Retrieve the parsed metadata box, throwing if it does not exist. */
  async getMetadataBox(args: {
    appId: bigint | number
    assetId: bigint | number
    params?: RegistryParameters
  }): Promise<AssetMetadataBox> {
    const box = await this.tryGetMetadataBox(args)
    if (!box) throw new BoxNotFoundError('Metadata box not found')
    return box
  }

  /** Retrieve the ARC-89 asset metadata box and return it as an AssetMetadataRecord. */
  async getAssetMetadataRecord(args: {
    appId: bigint | number
    assetId: bigint | number
    params?: RegistryParameters
  }): Promise<AssetMetadataRecord> {
    const box = await this.getMetadataBox(args)
    return new AssetMetadataRecord({
      appId: args.appId,
      assetId: args.assetId,
      header: box.header,
      body: box.body,
    })
  }

  // ---------------------------------------------------------------------
  // ASA lookups (optional)
  // ---------------------------------------------------------------------

  async getAssetInfo(assetId: bigint | number): Promise<Mapping> {
    const id = Number(assetId)
    const fn = this.algod.getAssetByID ?? this.algod.assetInfo
    if (!fn) throw new Error('Algod client does not support asset info reads')

    let resp: unknown
    try {
      resp = await resolveDo(fn.call(this.algod, id))
    } catch (e) {
      if (looksNotFound(e)) throw new AsaNotFoundError(`ASA ${id} not found`, { cause: e })
      throw e
    }

    if (!isMapping(resp)) throw new Error('Unexpected algod response for asset info')
    return resp
  }

  /** Return the ASA's URL field, or null if no URL is present. */
  async getAssetUrl(assetId: bigint | number): Promise<string | null> {
    const info = await this.getAssetInfo(assetId)

    // Common shapes:
    // - Python algod: { params: { url: ... } }
    // - JS algod: { asset: { params: { url: ... } } }
    const params = isMapping(info.params) ? (info.params as Mapping) : isMapping(info.asset) && isMapping((info.asset as Mapping).params) ? ((info.asset as Mapping).params as Mapping) : null
    const url = params && 'url' in params ? params.url : null
    return url == null ? null : String(url)
  }

  /**
   * Resolve an ARC-89 Asset Metadata URI from the ASA's `url` field.
   *
   * Throws InvalidArc90UriError if the URL is not ARC-89-compatible.
   */
  async resolveMetadataUriFromAsset(args: { assetId: bigint | number }): Promise<Arc90Uri> {
    const url = await this.getAssetUrl(args.assetId)
    if (!url) {
      throw new InvalidArc90UriError('ASA has no url field; cannot resolve ARC-89 metadata URI')
    }

    try {
      const full = completePartialAssetUrl(url, args.assetId)
      return Arc90Uri.parse(full)
    } catch (e) {
      throw new InvalidArc90UriError('Failed to resolve ARC-89 URI from ASA url', { cause: e })
    }
  }
}
