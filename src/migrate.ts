/**
 * Legacy ASA migration helpers.
 *
 * Provides helpers to migrate legacy ASA metadata (ARC-3 / ARC-19 / ARC-69)
 * into the ARC-89 metadata registry, emitting an ARC-2 migration message.
 */

import { AddressWithSigners } from '@algorandfoundation/algokit-utils/transact'
import { Transaction } from '@algorandfoundation/algokit-utils/transact'
import { ARC2_ARC_NUMBER, ARC2_DATA_FORMAT_JSON, MAX_GROUP_SIZE, MAX_METADATA_SIZE } from './constants'
import { Arc90Compliance, Arc90Uri } from './codec'
import { MissingAppClientError } from './errors'
import { AssetMetadata, MetadataFlags } from './models'
import { concatBytes } from './internal/bytes'
import type { AsaMetadataRegistry } from './registry'
import { AsaMetadataRegistryWrite } from './write/writer'

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
  assetManager: AddressWithSigners
  metadataUri: string
}): Promise<Transaction> {
  let write: AsaMetadataRegistryWrite
  try {
    write = args.registry.write
  } catch (e) {
    if (e instanceof MissingAppClientError) {
      throw new Error('Building asset config requires registry constructed with write capabilities.')
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
 * in the ASA Metadata Registry, then emitting an ARC-2 migration message.
 *
 * Flow:
 * 1) Error if metadata already exists in the Registry for the given ASA.
 * 2) Error if metadata is flagged as ARC-89 native.
 * 3) Validate metadata size <= MAX_METADATA_SIZE (raw bytes after JSON encoding).
 * 4) Create metadata on the registry and emit the ARC-2 migration message.
 */
export async function migrateLegacyMetadataToRegistry(args: {
  registry: AsaMetadataRegistry
  assetManager: AddressWithSigners
  assetId: bigint | number
  metadata: Record<string, unknown>
  arc3Compliant: boolean
  flags?: MetadataFlags | null
}): Promise<void> {
  // Pre-flight: ensure not already migrated
  const existence = await args.registry.read.arc89CheckMetadataExists({ assetId: args.assetId })
  if (existence.metadataExists) {
    throw new Error(`ASA ${args.assetId} already has metadata in this registry; migration is not allowed`)
  }

  // Validate flags
  if (args.flags?.irreversible.arc89Native) {
    throw new Error('Cannot flag migrated metadata as ARC-89 native')
  }

  // Build AssetMetadata and enforce size bounds
  let assetMd: AssetMetadata
  try {
    assetMd = AssetMetadata.fromJson({
      assetId: args.assetId,
      jsonObj: args.metadata,
      flags: args.flags ?? undefined,
      arc3Compliant: args.arc3Compliant,
    })
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error(
        `Legacy metadata is too large to migrate into ARC-89 registry, ` +
          `MAX_METADATA_SIZE=${MAX_METADATA_SIZE}. Consider hosting a smaller ` +
          `JSON document or storing a pointer in short metadata.`,
      )
    }
    throw e
  }

  // Derive migration URI
  const metadataUri = deriveMigrationUri({
    registry: args.registry,
    assetId: args.assetId,
    arc3: args.arc3Compliant,
  })

  // Build ARC-2 txn
  const arc2Txn = await buildArc2MigrationMessageTxn({
    registry: args.registry,
    assetId: args.assetId,
    assetManager: args.assetManager,
    metadataUri,
  })

  // Build create group
  const migrateGroup = await args.registry.write.buildCreateMetadataGroup({
    assetManager: args.assetManager,
    metadata: assetMd,
  })

  // Decide send strategy based on group size
  const underlyingComposer = await migrateGroup.composer()
  if (underlyingComposer.count() < MAX_GROUP_SIZE) {
    // Atomic: add ARC-2 txn to the create group
    migrateGroup.addTransaction(arc2Txn)
    await migrateGroup.send()
  } else {
    // Sequential: send create first, then ARC-2 separately
    await migrateGroup.send()
    await args.registry.write.client.algorand.newGroup().addTransaction(arc2Txn).send()
  }
}
