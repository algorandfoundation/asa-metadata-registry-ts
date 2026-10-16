/**
 * Legacy ASA migration helpers.
 *
 * Provides helpers to migrate legacy ASA metadata (ARC-3 / ARC-19 / ARC-69)
 * into the ARC-89 metadata registry, optionally emitting an ARC-2 migration message.
 *
 * Ported from Python `asa_metadata_registry/migrate.py`.
 */

import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import type { Transaction } from 'algosdk'
import { ARC2_ARC_NUMBER, ARC2_DATA_FORMAT_JSON, MAX_GROUP_SIZE, MAX_METADATA_SIZE } from './constants.js'
import { Arc90Compliance, Arc90Uri, b64Decode } from './codec.js'
import { MetadataHashMismatchError, MissingAppClientError } from './errors.js'
import { MASK_IRR_IMMUTABLE } from './bitmasks.js'
import { computeArc3MetadataHash } from './hashing.js'
import { AssetMetadata, MetadataBody, MetadataFlags } from './models.js'
import { decodeMetadataJson } from './validation.js'
import { bytesEqual, concatBytes } from './internal/bytes.js'
import type { AsaMetadataRegistry } from './registry.js'
import { AsaMetadataRegistryWrite } from './write/writer.js'

// ---------------------------------------------------------------------------
// ARC-2 migration message helpers (JSON only)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder()

/**
 * Encode an ARC-2 message advertising the metadata URI for ARC-89 migration.
 *
 * This SDK encodes JSON only (j) payload (recommended by ARC-89 specs):
 *   b"arc89:j<payload>"
 *
 * where payload is UTF-8 JSON of: {"uri": <asset_metadata_uri>}.
 *
 * @returns Bytes suitable for setting as `note` on an AssetConfig transaction.
 */
export function encodeArc2MigrationMessage(uri: string): Uint8Array {
  const payload = textEncoder.encode(JSON.stringify({ uri }))
  return concatBytes([ARC2_ARC_NUMBER, ARC2_DATA_FORMAT_JSON, payload])
}

/**
 * Build an AssetConfig txn that publishes the ARC-2 migration message as note.
 *
 * WARNING: Preserves all role addresses to avoid irreversibly disabling ASA RBAC.
 *
 * @returns The underlying unsigned transaction object.
 */
export async function buildArc2MigrationMessageTxn(args: {
  registry: AsaMetadataRegistry
  assetId: bigint | number
  assetManager: TransactionSignerAccount
  metadataUri: string
}): Promise<Transaction> {
  let write: AsaMetadataRegistryWrite
  try {
    write = args.registry.write
  } catch (e) {
    if (e instanceof MissingAppClientError) {
      throw new Error('Building asset config requires registry constructed with write capabilities.', { cause: e })
    }
    throw e
  }

  const info = await write.client.algorand.asset.getById(BigInt(args.assetId))
  const note = encodeArc2MigrationMessage(args.metadataUri)

  return await write.client.algorand.createTransaction.assetConfig({
    sender: args.assetManager.addr,
    assetId: BigInt(args.assetId),
    manager: args.assetManager.addr,
    reserve: info.reserve,
    freeze: info.freeze,
    clawback: info.clawback,
    note,
  })
}

// ---------------------------------------------------------------------------
// High-level migration helpers
// ---------------------------------------------------------------------------

/** Normalize the ASA `am` (Algod's base64 string or bytes) to bytes. */
const asaMetadataHash = (value: unknown): Uint8Array => {
  if (typeof value === 'string') return b64Decode(value)
  return value instanceof Uint8Array ? value : new Uint8Array()
}

const isZeroOrEmptyAm = (am: Uint8Array): boolean => am.length === 0 || (am.length === 32 && am.every((b) => b === 0))

/**
 * Derive the ARC-90 registry URI to be published inside the ARC-2 migration message.
 *
 * Uses the SDK's ARC-90 URI helper with the registry's configured `netauth` and `appId`.
 *
 * Enforces ARC-90 rule that ARC-3 must be the sole compliance fragment.
 */
export function deriveMigrationUri(args: {
  registry: AsaMetadataRegistry
  assetId: bigint | number
  arc3: boolean
}): string {
  const base = args.registry.arc90Uri({ assetId: args.assetId })
  return new Arc90Uri({
    netauth: base.netauth,
    appId: base.appId,
    boxName: base.boxName,
    compliance: args.arc3 ? new Arc90Compliance([3]) : new Arc90Compliance(),
  }).toUri()
}

/**
 * Migrate a legacy ASA (e.g., ARC-3 / ARC-19 / ARC-69) metadata by replicating it
 * in the ASA Metadata Registry, where it takes precedence over the Asset URL. The
 * informational ARC-2 announcement is sent only if `publishArc2Message` is true.
 *
 * Pass the original file bytes (`Uint8Array`) to store them verbatim (an object is re-encoded
 * compactly). When the ASA has a nonzero `am` and is ARC-3 compliant, the ARC-3 hash
 * of the stored bytes MUST equal `am` (checked unless `verifyAm: false`).
 *
 * Flow:
 * 1) Error if metadata already exists in the Registry for the given ASA; error if the ASA does not exist.
 * 2) Error if metadata is flagged as ARC-89 native.
 * 3) If the ASA has a non-zero asset metadata hash (am): auto-set immutable when no flags provided,
 *    or error early if flags are provided without immutable: true.
 * 4) Validate metadata size <= MAX_METADATA_SIZE (raw bytes after JSON encoding).
 * 5) Create metadata on the registry (and, on request, emit the ARC-2 message).
 *
 * @throws {MetadataHashMismatchError} If `am` does not match the ARC-3 hash of the metadata bytes.
 */
export async function migrateLegacyMetadataToRegistry(args: {
  registry: AsaMetadataRegistry
  assetManager: TransactionSignerAccount
  assetId: bigint | number
  metadata: Record<string, unknown> | Uint8Array
  arc3Compliant: boolean
  flags?: MetadataFlags | null
  verifyAm?: boolean
  publishArc2Message?: boolean
}): Promise<void> {
  // Pre-flight: ensure ASA exists and is not already migrated
  const existence = await args.registry.read.arc89CheckMetadataExists({ assetId: args.assetId })
  if (!existence.asaExists) {
    throw new Error(`ASA ${args.assetId} does not exist`)
  }
  if (existence.metadataExists) {
    throw new Error(`ASA ${args.assetId} already has metadata in this registry; migration is not allowed`)
  }

  if (args.flags?.irreversible.arc89Native) throw new Error('Cannot flag migrated metadata as ARC-89 native')

  // Pre-flight: fetch ASA info to check metadata hash and decide on flags
  const assetInfo = await args.registry.write.client.algorand.asset.getById(BigInt(args.assetId))
  const onChainAm = asaMetadataHash(assetInfo.metadataHash)
  const hasOnChainAm = !isZeroOrEmptyAm(onChainAm)
  if (hasOnChainAm && args.flags != null && !args.flags.irreversible.immutable) {
    throw new Error(
      `ASA ${args.assetId} has a metadata hash (am) set on-chain, hence the registry ` +
        `requires the IMMUTABLE flag for this migration. Either omit flags to set it ` +
        `automatically, or pass flags with immutable: true.`,
    )
  }

  // Build AssetMetadata, resolve flags if not provided and enforce size bounds
  let raw: Uint8Array | null = null
  let jsonObj: Record<string, unknown>
  if (args.metadata instanceof Uint8Array) {
    raw = args.metadata
    jsonObj = decodeMetadataJson(raw)
  } else {
    jsonObj = args.metadata
  }

  let assetMd: AssetMetadata
  try {
    assetMd = AssetMetadata.fromJson({
      assetId: args.assetId,
      jsonObj,
      flags: args.flags ?? undefined,
      arc3Compliant: args.arc3Compliant,
    })
    if (raw !== null) {
      assetMd = new AssetMetadata({
        assetId: assetMd.assetId,
        body: new MetadataBody(raw),
        flags: assetMd.flags,
        deprecatedBy: assetMd.deprecatedBy,
      })
      assetMd.body.validateSize()
    }
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error(
        `Legacy metadata is too large to migrate into ARC-89 registry, ` +
          `MAX_METADATA_SIZE=${MAX_METADATA_SIZE}. Consider hosting a smaller ` +
          `JSON document or storing a pointer in short metadata.`,
        { cause: e },
      )
    }
    throw e
  }
  // Set immutable flag after derivation to preserve auto-detected reversible flags (e.g. ARC-20/ARC-62)
  if (hasOnChainAm && args.flags == null) {
    assetMd = new AssetMetadata({
      assetId: assetMd.assetId,
      body: assetMd.body,
      flags: MetadataFlags.fromBytes(assetMd.flags.reversibleByte, assetMd.flags.irreversibleByte | MASK_IRR_IMMUTABLE),
      deprecatedBy: assetMd.deprecatedBy,
    })
  }

  if (hasOnChainAm && (args.verifyAm ?? true) && args.arc3Compliant) {
    const expectedAm = computeArc3MetadataHash(assetMd.body.rawBytes)
    if (!bytesEqual(expectedAm, onChainAm)) {
      throw new MetadataHashMismatchError(
        `ASA ${args.assetId} am does not match the ARC-3 hash of the metadata bytes to ` +
          'migrate; pass the original file bytes, or verifyAm: false.',
      )
    }
  }

  // Build create group
  const migrateGroup = await args.registry.write.buildCreateMetadataGroup({
    assetManager: args.assetManager,
    metadata: assetMd,
  })
  if (!(args.publishArc2Message ?? false)) {
    await migrateGroup.send()
    return
  }

  // Build ARC-2 txn
  const arc2Txn = await buildArc2MigrationMessageTxn({
    registry: args.registry,
    assetId: args.assetId,
    assetManager: args.assetManager,
    metadataUri: deriveMigrationUri({ registry: args.registry, assetId: args.assetId, arc3: args.arc3Compliant }),
  })

  // Decide send strategy based on group size
  const underlyingComposer = await migrateGroup.composer()
  if ((await underlyingComposer.count()) < MAX_GROUP_SIZE) {
    // Atomic: add ARC-2 txn to the create group
    migrateGroup.addTransaction(arc2Txn, args.assetManager.signer)
    await migrateGroup.send()
  } else {
    // Sequential: send create first, then ARC-2 separately
    await migrateGroup.send()
    await args.registry.write.client.algorand.newGroup().addTransaction(arc2Txn, args.assetManager.signer).send()
  }
}
