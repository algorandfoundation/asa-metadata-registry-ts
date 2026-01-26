/**
 * Algod helpers (ARC-89 box reads).
 *
 * Ported from `asa_metadata_registry/algod.py`.
 * Uses the minimal Algod subset for box reads and ASA params.
 * algosdk.Algodv2 methods follow the request-builder pattern: getX(...).do().
 */

import type { Algodv2, modelsv2 } from 'algosdk'
import { Arc90Uri, assetIdToBoxName, completePartialAssetUrl } from './codec'
import { toBigInt } from './internal/numbers'
import { AsaNotFoundError, BoxNotFoundError, InvalidArc90UriError } from './errors'
import { AssetMetadataBox, AssetMetadataRecord, RegistryParameters, getDefaultRegistryParams } from './models'

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

export type AlgodClientSubset = Pick<Algodv2, 'getApplicationBoxByName' | 'getAssetByID'>

/**
 * Read ARC-89 metadata by directly reading the registry application box via Algod.
 *
 * This avoids transactions entirely and is usually the fastest read path.
 *
 * Required Algod methods:
 * - getApplicationBoxByName
 * - getAssetByID (for URI resolution)
 */
export class AlgodBoxReader {
  public readonly algod: AlgodClientSubset

  constructor(algod: AlgodClientSubset) {
    this.algod = algod
  }

  /**
   * Fetch a box by name.
   * @throws {BoxNotFoundError} If the box does not exist.
   */
  async getBoxValue(args: { appId: bigint | number; boxName: Uint8Array }): Promise<modelsv2.Box> {
    const appId = toBigInt(args.appId)

    try {
      return await this.algod.getApplicationBoxByName(appId, args.boxName).do()
    } catch (e) {
      if (looksNotFound(e)) throw new BoxNotFoundError('Box not found', { cause: e })
      throw e
    }
  }

  /**
   * Return the parsed metadata box, or null if the box doesn't exist.
   * @throws {BoxNotFoundError} If the box does not exist.
   */
  async tryGetMetadataBox(args: {
    appId: bigint | number
    assetId: bigint | number
    params?: RegistryParameters
  }): Promise<AssetMetadataBox | null> {
    let value: Uint8Array
    try {
      const box = await this.getBoxValue({ appId: args.appId, boxName: assetIdToBoxName(args.assetId) })
      value = box.value
    } catch (e) {
      if (e instanceof BoxNotFoundError) return null
      throw e
    }

    const p = args.params ?? getDefaultRegistryParams()
    return AssetMetadataBox.parse({ assetId: args.assetId, value, headerSize: p.headerSize, maxMetadataSize: p.maxMetadataSize })
  }

  /**
   * Return the parsed metadata box, or throw if missing.
   * @throws {BoxNotFoundError} If the box does not exist.
   */
  async getMetadataBox(args: {
    appId: bigint | number
    assetId: bigint | number
    params?: RegistryParameters
  }): Promise<AssetMetadataBox> {
    const box = await this.tryGetMetadataBox(args)
    if (!box) throw new BoxNotFoundError('Metadata box not found')
    return box
  }

  /**
   * Retrieve the ARC-89 asset metadata box and return it as an AssetMetadataRecord.
   * @param args - { appId, assetId, params }.
   * @returns An AssetMetadataRecord containing the parsed header and body of the asset's metadata box.
   * @throws {BoxNotFoundError} If the box does not exist.
   */
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

  /**
   * Fetch ASA info from Algod.
   * @throws {AsaNotFoundError} If the ASA does not exist.
   */
  async getAssetInfo(assetId: bigint | number): Promise<modelsv2.Asset> {
    const id = toBigInt(assetId)

    try {
      return await this.algod.getAssetByID(id).do()
    } catch (e) {
      if (looksNotFound(e)) throw new AsaNotFoundError(`ASA ${id} not found`, { cause: e })
      throw e
    }
  }

  /**
   * Return the ASA's URL as a string, or null if missing.
   * @param assetId - The ASA ID whose URL field should be retrieved.
   * @returns The URL string from `info.params.url`, or null if missing.
   * @throws {AsaNotFoundError} If the ASA does not exist.
   */
  async getAssetUrl(assetId: bigint | number): Promise<string | null> {
    const info = await this.getAssetInfo(assetId)
    const url = info?.params?.url ?? null
    return url == null ? null : String(url)
  }

  /**
   * Resolve an ARC-89 Asset Metadata URI from the ASA's URL.
   * @param args - { assetId }.
   * @returns Parsed ARC-90 URI.
   * @throws {InvalidArc90UriError} If the ASA has no URL or if the URL is not an ARC-89-compatible ARC-90 partial URI.
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
