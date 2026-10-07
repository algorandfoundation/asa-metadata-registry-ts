import { beforeAll, describe, expect, test } from 'vitest'
import { algo, Config } from '@algorandfoundation/algokit-utils'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { nullLogger } from '@algorandfoundation/algokit-utils/types/logging'
import { LogicError } from '@algorandfoundation/algokit-utils/types/logic-error'
import { generateAccount, getApplicationAddress, makeBasicAccountTransactionSigner, TransactionType } from 'algosdk'
import type { Address, modelsv2 } from 'algosdk'
import {
  ARC3_NAME_SUFFIX,
  Arc90Compliance,
  Arc90Uri,
  AsaMetadataRegistry,
  AssetMetadata,
  IrreversibleFlags,
  MAX_METADATA_SIZE,
  MetadataFlags,
  MetadataHashMismatchError,
  ReversibleFlags,
  SHORT_METADATA_SIZE,
  buildArc2MigrationMessageTxn,
  computeArc3MetadataHash,
  deriveMigrationUri,
  encodeArc2MigrationMessage,
  encodeMetadataJson,
  migrateLegacyMetadataToRegistry,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import type { AsaMetadataRegistryClient } from '@/generated'
import {
  ARC90_NETAUTH,
  createArc3Payload,
  createArc69Asa,
  createFactory,
  createFundedAccount,
  deployRegistry,
  getDeployer,
} from './helpers'
import type { AddressWithSigners } from './helpers'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const ARC2_PREFIX = 'arc89:j'

/** Split an ARC-2 migration message into its `arc89:j` prefix and its JSON payload text. */
const splitArc2Message = (message: Uint8Array): readonly [string, string] => [
  textDecoder.decode(message.slice(0, ARC2_PREFIX.length)),
  textDecoder.decode(message.slice(ARC2_PREFIX.length)),
]

/** The ARC-3 `am` of the bytes the SDK stores when migrating an object. */
const arc3Am = (obj: Record<string, unknown>): Uint8Array => computeArc3MetadataHash(encodeMetadataJson(obj))

const parseJsonBytes = (bytes: Uint8Array) => JSON.parse(textDecoder.decode(bytes))

/** Minimal valid ARC-3/ARC-69 metadata JSON. */
const minimalMetadata: Record<string, unknown> = {
  name: 'Test Asset',
  description: 'A test asset for migration',
}

/** ARC-3 compliant metadata with standard properties. */
const arc3Metadata: Record<string, unknown> = createArc3Payload({
  name: 'ARC-3 Token',
  description: 'ARC-3 compliant token',
  image: 'https://example.com/image.png',
  externalUrl: 'https://example.com',
  properties: {
    simple_property: 'example value',
    rich_property: {
      name: 'Name',
      value: '123',
      display_value: '123 Example Value',
    },
    array_property: {
      name: 'Rarities',
      value: [1, 2, 3, 4],
    },
  },
})

// ================================================================
// Fixtures
// ================================================================

const fixture = algorandFixture()
let algorand: AlgorandClient
let client: AsaMetadataRegistryClient
let assetManager: AddressWithSigners
let registry: AsaMetadataRegistry

beforeAll(async () => {
  await fixture.newScope()
  algorand = fixture.algorand
  const deployer = getDeployer(fixture)
  assetManager = await createFundedAccount(fixture)

  client = await deployRegistry({ factory: createFactory({ algorand, deployer }), deployer })

  // Registry configured for write operations
  registry = AsaMetadataRegistry.fromAppClient(client, { algod: algorand.client.algod, netauth: ARC90_NETAUTH })
})

/** Create a legacy ARC-69 ASA with `minimalMetadata` in the note field. */
const createLegacyArc69Asa = (): Promise<bigint> =>
  createArc69Asa({ assetManager, appClient: client, metadata: minimalMetadata })

/**
 * Create a legacy ARC-3 ASA.
 *
 * Pass `withMetadataHash: true` to include a non-zero metadata hash (32 bytes of 0xAB, which is not an
 * ARC-3 hash), or `metadataHash` to set a specific `am` (e.g. the ARC-3 hash of the metadata to migrate).
 */
const createLegacyArc3Asa = async (args?: {
  withMetadataHash?: boolean
  defaultFrozen?: boolean
  clawback?: string | Address
  metadataHash?: Uint8Array
}): Promise<bigint> => {
  const result = await algorand.send.assetCreate({
    sender: assetManager.addr,
    total: 1000n,
    assetName: `Legacy NFT${textDecoder.decode(ARC3_NAME_SUFFIX)}`,
    unitName: 'LNFT',
    url: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    decimals: 0,
    defaultFrozen: args?.defaultFrozen ?? false,
    manager: assetManager.addr,
    reserve: assetManager.addr,
    freeze: assetManager.addr,
    clawback: args?.clawback ?? assetManager.addr,
    metadataHash: args?.metadataHash ?? (args?.withMetadataHash ? new Uint8Array(32).fill(0xab) : undefined),
  })
  return result.assetId
}

/** Run `fn` and return the confirmed transactions it sent through the fixture's algod. */
const sentTransactions = async (fn: () => Promise<unknown>): Promise<modelsv2.PendingTransactionResponse[]> => {
  const { transactionLogger } = fixture.context
  const start = transactionLogger.sentTransactionIds.length
  await fn()
  const txIds = transactionLogger.sentTransactionIds.slice(start)
  return await Promise.all(txIds.map((txId) => algorand.client.algod.pendingTransactionInformation(txId).do()))
}

// ================================================================
// ARC-2 Message Encoding Tests
// ================================================================

describe('arc-2 message encoding', () => {
  test('encode basic uri', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM'
    const [prefix, payload] = splitArc2Message(encodeArc2MigrationMessage(uri))

    // Should start with arc89:j prefix
    expect(prefix).toBe(ARC2_PREFIX)

    // Extract and decode JSON payload
    expect(JSON.parse(payload)).toEqual({ uri })
  })

  test('encode with compliance fragment', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM#arc3'
    const [prefix, payload] = splitArc2Message(encodeArc2MigrationMessage(uri))

    expect(prefix).toBe(ARC2_PREFIX)
    expect(JSON.parse(payload).uri).toBe(uri)
  })

  test('encode compact json', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM'
    const [, payload] = splitArc2Message(encodeArc2MigrationMessage(uri))

    // Should have compact separators (no extra whitespace)
    expect(payload).toBe(JSON.stringify({ uri }))
    expect(payload).not.toContain(' ')
  })

  test('encode unicode uri', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM&tag=测试'
    const [, payload] = splitArc2Message(encodeArc2MigrationMessage(uri))

    expect(JSON.parse(payload).uri).toBe(uri)
    // Non-ASCII characters are UTF-8 encoded, not escaped
    expect(payload).toContain('测试')
  })
})

// ================================================================
// Migration URI Derivation Tests
// ================================================================

describe('migration uri derivation', () => {
  test('derive basic uri without compliance fragments', async () => {
    const assetId = await createLegacyArc69Asa()

    const uri = deriveMigrationUri({ registry, assetId, arc3: false })
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe(ARC90_NETAUTH)
    expect(parsed.appId).toBe(registry.config.appId)
    expect(parsed.boxName).not.toBeNull()
    expect(parsed.assetId).toBe(assetId)
    expect(parsed.compliance).toEqual(new Arc90Compliance([]))
  })

  test('derive uri with arc3 flag', async () => {
    const assetId = await createLegacyArc3Asa()

    const uri = deriveMigrationUri({ registry, assetId, arc3: true })
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.compliance).toEqual(new Arc90Compliance([3]))
  })
})

// ================================================================
// Transaction Building Tests
// ================================================================

describe('build arc2 migration message txn', () => {
  const metadataUri = 'arc90://net:testnet/123?box=AAAAAAAAAAM'

  test('build txn basic', async () => {
    const assetId = await createLegacyArc69Asa()

    const txn = await buildArc2MigrationMessageTxn({ registry, assetId, assetManager, metadataUri })

    // Verify transaction type and basic fields
    expect(txn.type).toBe(TransactionType.acfg)
    expect(txn.sender.toString()).toBe(assetManager.addr.toString())
    // Verify it's an asset config transaction for the right asset
    expect(txn.assetConfig?.assetIndex).toBe(assetId)

    // Verify note contains the ARC-2 message
    const [prefix, payload] = splitArc2Message(txn.note)
    expect(prefix).toBe(ARC2_PREFIX)

    // Decode and verify the message
    expect(JSON.parse(payload).uri).toBe(metadataUri)
  })

  test('build txn preserves manager', async () => {
    const assetId = await createLegacyArc69Asa()

    const txn = await buildArc2MigrationMessageTxn({ registry, assetId, assetManager, metadataUri })

    // Verify transaction was built with the migration message
    expect(splitArc2Message(txn.note)[0]).toBe(ARC2_PREFIX)
    expect(txn.assetConfig?.manager?.toString()).toBe(assetManager.addr.toString())
  })

  test('build txn preserves all roles', async () => {
    const assetId = await createLegacyArc69Asa()
    const info = await algorand.asset.getById(assetId)

    const txn = await buildArc2MigrationMessageTxn({ registry, assetId, assetManager, metadataUri })

    expect(txn.type).toBe(TransactionType.acfg)
    expect(txn.sender.toString()).toBe(assetManager.addr.toString())
    expect(txn.note.length).toBeGreaterThan(0)
    expect(txn.assetConfig?.manager?.toString()).toBe(info.manager)
    expect(txn.assetConfig?.reserve?.toString()).toBe(info.reserve)
    expect(txn.assetConfig?.freeze?.toString()).toBe(info.freeze)
    expect(txn.assetConfig?.clawback?.toString()).toBe(info.clawback)
  })

  test('build txn without write capability error', async () => {
    const assetId = await createLegacyArc69Asa()

    // Create read-only registry (no appClient)
    const readOnlyRegistry = AsaMetadataRegistry.fromAlgod({
      algod: algorand.client.algod,
      appId: client.appId,
    })

    await expect(
      buildArc2MigrationMessageTxn({ registry: readOnlyRegistry, assetId, assetManager, metadataUri }),
    ).rejects.toThrow('write capabilities')
  })
})

// ================================================================
// Migration Pre-flight Checks Tests
// ================================================================

describe('pre-flight checks', () => {
  test('asset not existing throws', async () => {
    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId: 2n ** 63n - 1n,
        metadata: minimalMetadata,
        arc3Compliant: false,
      }),
    ).rejects.toThrow('does not exist')
  })

  test('asset without metadata passes', async () => {
    const assetId = await createLegacyArc69Asa()

    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.asaExists).toBe(true)
    expect(existence.metadataExists).toBe(false)
  })

  test('asset with existing metadata throws', async () => {
    const assetId = await createLegacyArc69Asa()

    // Create metadata first
    const metadata = AssetMetadata.fromJson({
      assetId,
      jsonObj: { name: 'Existing Metadata' },
    })
    await registry.write.createMetadata({ assetManager, metadata })

    // Now migration should fail
    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
      }),
    ).rejects.toThrow('already has metadata')
  })
})

// ================================================================
// Full Migration Flow Tests (LocalNet Integration)
// ================================================================

describe('migrate legacy metadata', () => {
  test('migrate minimal metadata', async () => {
    const assetId = await createLegacyArc69Asa()

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
    })

    // Verify metadata was created in registry
    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)

    // Verify metadata content
    const stored = await registry.read.getAssetMetadata({ assetId })
    expect(parseJsonBytes(stored.body.rawBytes)).toEqual(minimalMetadata)
  })

  test('migrate arc3 metadata', async () => {
    const assetId = await createLegacyArc3Asa()

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: arc3Metadata,
      arc3Compliant: true,
    })

    // Verify metadata exists
    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)

    // Verify ARC-3 flag is set
    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.arc3).toBe(true)
  })

  test('migrate arc3 asa with metadataHash auto-sets immutable', async () => {
    const assetId = await createLegacyArc3Asa({ metadataHash: arc3Am(arc3Metadata) })

    // No flags provided - SDK should auto-set immutable and arc3
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: arc3Metadata,
      arc3Compliant: true,
    })

    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.immutable).toBe(true)
    expect(header.flags.irreversible.arc3).toBe(true)
  })

  test('migrate arc3 asa with metadataHash and explicit immutable=false throws readable error', async () => {
    const assetId = await createLegacyArc3Asa({ metadataHash: arc3Am(arc3Metadata) })

    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ immutable: false }),
    })

    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: arc3Metadata,
        arc3Compliant: true,
        flags,
      }),
    ).rejects.toThrow('IMMUTABLE flag')
  })

  test('migrate arc3 asa with metadataHash and arc20 properties preserves arc20 flag', async () => {
    // ARC-20 requires DefaultFrozen and the controlling App account as Clawback
    const arc3WithArc20: Record<string, unknown> = {
      name: 'ARC-20 Token',
      properties: { 'arc-20': { 'application-id': 999 } },
    }
    const assetId = await createLegacyArc3Asa({
      metadataHash: arc3Am(arc3WithArc20),
      defaultFrozen: true,
      clawback: getApplicationAddress(999),
    })

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: arc3WithArc20,
      arc3Compliant: true,
    })

    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.immutable).toBe(true)
    expect(header.flags.irreversible.arc3).toBe(true)
    expect(header.flags.reversible.arc20).toBe(true)
  })

  test('migrate arc69 preserves exact metadata', async () => {
    // Create original ARC-69 metadata with various data types
    const originalMetadata: Record<string, unknown> = {
      standard: 'arc69',
      name: 'Test Token',
      description: 'A test token for migration verification',
      image: 'https://example.com/image.png',
      image_integrity: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      image_mimetype: 'image/png',
      properties: {
        string_prop: 'value',
        number_prop: 42,
        boolean_prop: true,
        null_prop: null,
        array_prop: [1, 2, 3],
        nested_object: { key: 'nested_value' },
      },
      external_url: 'https://example.com',
      attributes: [
        { trait_type: 'Color', value: 'Blue' },
        { trait_type: 'Size', value: 10 },
      ],
    }

    // Create ARC-69 ASA with metadata in note field
    const assetId = await createArc69Asa({ assetManager, appClient: client, metadata: originalMetadata })

    // Migrate using the original metadata
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: originalMetadata,
      arc3Compliant: false,
    })

    // Verify metadata exists in registry
    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)

    // Verify stored metadata exactly matches original
    const stored = await registry.read.getAssetMetadata({ assetId })
    const storedJson = parseJsonBytes(stored.body.rawBytes)
    expect(storedJson).toEqual(originalMetadata)

    // Verify specific fields to ensure data types are preserved
    expect(storedJson.standard).toBe('arc69')
    expect(storedJson.properties.number_prop).toBe(42)
    expect(storedJson.properties.boolean_prop).toBe(true)
    expect(storedJson.properties.null_prop).toBeNull()
    expect(storedJson.properties.array_prop).toEqual([1, 2, 3])
    expect(storedJson.properties.nested_object.key).toBe('nested_value')
    expect(storedJson.attributes[0].value).toBe('Blue')
    expect(storedJson.attributes[1].value).toBe(10)

    // Verify RBAC roles are preserved
    const assetInfo = await algorand.asset.getById(assetId)
    expect(assetInfo.manager).toBe(assetManager.addr.toString())
    expect(assetInfo.reserve).toBe(assetManager.addr.toString())
    expect(assetInfo.freeze).toBe(assetManager.addr.toString())
    expect(assetInfo.clawback).toBe(assetManager.addr.toString())
  })

  test('migrate with custom flags', async () => {
    const assetId = await createLegacyArc69Asa()

    // Note: arc89Native=false is appropriate for migrated metadata
    const flags = new MetadataFlags({
      reversible: new ReversibleFlags({ reserved3: true }),
      irreversible: new IrreversibleFlags({ arc89Native: false }),
    })

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
      flags,
    })

    // Verify flags were applied (arc89Native should be false for migrated metadata)
    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.arc89Native).toBe(false)
    expect(header.flags.reversible.reserved3).toBe(true)
  })

  test('migrate with arc89 native flag throws', async () => {
    const assetId = await createLegacyArc69Asa()

    const flags = new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true }),
    })

    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
        flags,
      }),
    ).rejects.toThrow('Cannot flag migrated metadata as ARC-89 native')
  })

  test('migrate already migrated throws', async () => {
    const assetId = await createLegacyArc69Asa()

    // First migration
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
    })

    // Second migration should fail
    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
      }),
    ).rejects.toThrow('already has metadata')
  })

  test('migrate oversized metadata throws', async () => {
    const assetId = await createLegacyArc69Asa()

    // Exceeds MAX_METADATA_SIZE once JSON encoded
    const oversizedMetadata = {
      name: 'Oversized Asset',
      description: 'x'.repeat(MAX_METADATA_SIZE),
    }

    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: oversizedMetadata,
        arc3Compliant: false,
      }),
    ).rejects.toThrow('too large to migrate')
  })

  test('migrate max size metadata', async () => {
    const assetId = await createLegacyArc69Asa()

    // Create metadata that fits within MAX_METADATA_SIZE
    const contentSize = MAX_METADATA_SIZE - 20 // Leave room for JSON structure
    const maxSizeMetadata = { data: 'x'.repeat(contentSize) }

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: maxSizeMetadata,
      arc3Compliant: false,
    })

    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)
  })
})

// ================================================================
// RBAC Preservation Tests
// ================================================================

describe('rbac preservation', () => {
  test('preserve all roles after migration', async () => {
    const assetId = await createLegacyArc69Asa()

    // Get original asset info
    const originalInfo = await algorand.asset.getById(assetId)

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
      publishArc2Message: true,
    })

    // Get updated asset info
    const updatedInfo = await algorand.asset.getById(assetId)

    // Verify all roles are unchanged
    expect(updatedInfo.manager).toBe(originalInfo.manager)
    expect(updatedInfo.reserve).toBe(originalInfo.reserve)
    expect(updatedInfo.freeze).toBe(originalInfo.freeze)
    expect(updatedInfo.clawback).toBe(originalInfo.clawback)
  })

  test('preserve roles with different addresses', async () => {
    // Create ASA with distinct role addresses
    const reserveAccount = await createFundedAccount(fixture, algo(1))
    const freezeAccount = algorand.account.random()
    const untrustedAccount = await createFundedAccount(fixture, algo(10))

    const result = await algorand.send.assetCreate({
      sender: assetManager.addr,
      total: 1000n,
      assetName: 'Multi-Role ASA',
      manager: assetManager.addr,
      reserve: reserveAccount.addr,
      freeze: freezeAccount.addr,
      clawback: untrustedAccount.addr,
    })
    const assetId = result.assetId

    // Get original info
    const originalInfo = await algorand.asset.getById(assetId)

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
      publishArc2Message: true,
    })

    // Get updated info
    const updatedInfo = await algorand.asset.getById(assetId)

    // Verify all distinct roles are preserved
    expect(updatedInfo.manager).toBe(originalInfo.manager)
    expect(updatedInfo.manager).toBe(assetManager.addr.toString())
    expect(updatedInfo.reserve).toBe(originalInfo.reserve)
    expect(updatedInfo.reserve).toBe(reserveAccount.addr.toString())
    expect(updatedInfo.freeze).toBe(originalInfo.freeze)
    expect(updatedInfo.freeze).toBe(freezeAccount.addr.toString())
    expect(updatedInfo.clawback).toBe(originalInfo.clawback)
    expect(updatedInfo.clawback).toBe(untrustedAccount.addr.toString())
  })

  test('preserve empty/disabled roles', async () => {
    // Create ASA with only manager set, no reserve/freeze/clawback (disabled)
    const result = await algorand.send.assetCreate({
      sender: assetManager.addr,
      total: 1000n,
      assetName: 'Minimal Roles ASA',
      manager: assetManager.addr,
    })
    const assetId = result.assetId

    // Get original info
    const originalInfo = await algorand.asset.getById(assetId)

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
      publishArc2Message: true,
    })

    // Get updated info
    const updatedInfo = await algorand.asset.getById(assetId)

    // Verify manager preserved and empty roles remain empty
    expect(updatedInfo.manager).toBe(originalInfo.manager)
    expect(updatedInfo.reserve).toBe(originalInfo.reserve)
    expect(updatedInfo.freeze).toBe(originalInfo.freeze)
    expect(updatedInfo.clawback).toBe(originalInfo.clawback)
    expect(updatedInfo.reserve).toBeUndefined()
    expect(updatedInfo.freeze).toBeUndefined()
    expect(updatedInfo.clawback).toBeUndefined()
  })
})

// ================================================================
// Error Handling Tests
// ================================================================

describe('migration error handling', () => {
  test('migrate empty metadata', async () => {
    const assetId = await createLegacyArc69Asa()

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: {},
      arc3Compliant: false,
    })

    // Should succeed - empty metadata is valid
    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)
  })

  test('migrate without manager throws', async () => {
    const assetId = await createLegacyArc69Asa()
    const untrustedAccount = await createFundedAccount(fixture, algo(10))
    const prevLogger = Config.logger
    Config.configure({ logger: nullLogger })
    try {
      const error = await migrateLegacyMetadataToRegistry({
        registry,
        assetManager: untrustedAccount,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
      }).catch((e: unknown) => e)

      // Rejected by the registry: only the ASA Manager can create the Asset Metadata
      expect(error).toBeInstanceOf(LogicError)
      expect((error as LogicError).message).toContain('ERR:unauthorized')
    } finally {
      Config.configure({ logger: prevLogger })
    }
  })
})

// ================================================================
// Integration Tests
// ================================================================

describe('migration integration', () => {
  test('full migration workflow', async () => {
    const assetId = await createLegacyArc3Asa()

    // 1. Verify asset has no metadata initially
    const existenceBefore = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existenceBefore.metadataExists).toBe(false)

    // 2. Perform migration
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: arc3Metadata,
      arc3Compliant: true,
    })

    // 3. Verify metadata now exists
    const existenceAfter = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existenceAfter.metadataExists).toBe(true)

    // 4. Verify metadata content
    const stored = await registry.read.getAssetMetadata({ assetId })
    expect(parseJsonBytes(stored.body.rawBytes)).toEqual(arc3Metadata)

    // 5. Verify ARC-3 flag
    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.arc3).toBe(true)

    // 6. Verify RBAC unchanged
    const assetInfo = await algorand.asset.getById(assetId)
    expect(assetInfo.manager).toBe(assetManager.addr.toString())

    // 7. Verify we can read the metadata hash
    const [metadataHash] = await registry.read.arc89GetMetadataHash({ assetId })
    expect(metadataHash.length).toBe(32)
  })

  test('migration with subsequent updates', async () => {
    const assetId = await createLegacyArc69Asa()

    // 1. Migrate
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
    })

    // 2. Update the metadata
    const updatedMetadata = AssetMetadata.fromJson({
      assetId,
      jsonObj: { name: 'Updated Asset', version: 2 },
    })

    await registry.write.replaceMetadata({
      assetManager,
      metadata: updatedMetadata,
    })

    // 3. Verify the update
    const stored = await registry.read.getAssetMetadata({ assetId })
    const storedJson = parseJsonBytes(stored.body.rawBytes)
    expect(storedJson.name).toBe('Updated Asset')
    expect(storedJson.version).toBe(2)
  })

  test('migration metadata size boundary', async () => {
    const assetId = await createLegacyArc69Asa()

    // Test short metadata
    const shortMeta = { x: 'a'.repeat(100) }
    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: shortMeta,
      arc3Compliant: false,
    })

    const pagination = await registry.read.arc89GetMetadataPagination({ assetId })
    expect(pagination.metadataSize).toBeGreaterThan(0)
    expect(pagination.metadataSize).toBeLessThanOrEqual(SHORT_METADATA_SIZE)
  })
})

// ================================================================
// ASA Metadata Hash (am) Verification Tests
// ================================================================

describe('migrate am verification', () => {
  test('mismatching am throws', async () => {
    const assetId = await createLegacyArc3Asa({ withMetadataHash: true }) // 0xAB.. is not the ARC-3 hash

    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: arc3Metadata,
        arc3Compliant: true,
      }),
    ).rejects.toThrow(MetadataHashMismatchError)
  })

  test('raw bytes are stored verbatim', async () => {
    const raw = textEncoder.encode(JSON.stringify(arc3Metadata, null, 2)) // pretty-printed legacy file
    const assetId = await createLegacyArc3Asa({ metadataHash: computeArc3MetadataHash(raw) })

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: raw,
      arc3Compliant: true,
    })

    const record = await registry.read.getAssetMetadata({ assetId })
    expect(record.body.rawBytes).toEqual(raw)
    expect(record.header.metadataHash).toEqual(computeArc3MetadataHash(raw))
  })

  test('verifyAm false skips the am check', async () => {
    const am = new Uint8Array(32).fill(0xab) // not the ARC-3 hash
    const assetId = await createLegacyArc3Asa({ metadataHash: am })

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: arc3Metadata,
      arc3Compliant: true,
      verifyAm: false,
    })

    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.immutable).toBe(true)
    expect(header.flags.irreversible.arc3).toBe(true)
    // The registry adopts the ASA `am` as Metadata Hash
    expect(header.metadataHash).toEqual(am)
  })

  test('migrate oversized raw bytes throws', async () => {
    const assetId = await createLegacyArc69Asa()

    // The compact re-encoding fits, but the raw bytes (stored verbatim) exceed MAX_METADATA_SIZE
    const data = 'x'.repeat(MAX_METADATA_SIZE - 50)
    const raw = textEncoder.encode(`{${' '.repeat(100)}"data":"${data}"}`)
    expect(encodeMetadataJson({ data }).length).toBeLessThanOrEqual(MAX_METADATA_SIZE)
    expect(raw.length).toBeGreaterThan(MAX_METADATA_SIZE)

    await expect(
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: raw,
        arc3Compliant: false,
      }),
    ).rejects.toThrow('too large to migrate')
  })
})

// ================================================================
// ARC-2 Message Publishing Tests
// ================================================================

describe('arc-2 message publishing', () => {
  test('publishArc2Message defaults to false', async () => {
    const assetId = await createLegacyArc69Asa()

    const sent = await sentTransactions(() =>
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
      }),
    )

    // Only the migration group is sent: no ARC-2 AssetConfig
    expect(sent.some((p) => p.txn.txn.type === TransactionType.appl)).toBe(true)
    expect(sent.filter((p) => p.txn.txn.type === TransactionType.acfg)).toHaveLength(0)
    expect((await registry.read.arc89CheckMetadataExists({ assetId })).metadataExists).toBe(true)
  })

  test('publishArc2Message true publishes the message atomically with the migration', async () => {
    const assetId = await createLegacyArc3Asa()

    const sent = await sentTransactions(() =>
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager,
        assetId,
        metadata: arc3Metadata,
        arc3Compliant: true,
        publishArc2Message: true,
      }),
    )

    const arc2Txns = sent.filter((p) => p.txn.txn.type === TransactionType.acfg)
    expect(arc2Txns).toHaveLength(1)
    const arc2Txn = arc2Txns[0]!.txn.txn
    expect(arc2Txn.sender.toString()).toBe(assetManager.addr.toString())
    expect(arc2Txn.assetConfig?.assetIndex).toBe(assetId)
    expect(arc2Txn.note).toEqual(encodeArc2MigrationMessage(deriveMigrationUri({ registry, assetId, arc3: true })))

    // Confirmed in the same group as the metadata creation
    expect(sent.some((p) => p.txn.txn.type === TransactionType.appl)).toBe(true)
    expect(sent.every((p) => p.txn.txn.group !== undefined && (p.confirmedRound ?? 0n) > 0n)).toBe(true)
    const groups = new Set(sent.map((p) => Buffer.from(p.txn.txn.group!).toString('base64')))
    expect(groups.size).toBe(1)
    expect((await registry.read.arc89CheckMetadataExists({ assetId })).metadataExists).toBe(true)
  })

  test('publishArc2Message true signs with an asset manager signer unknown to the algorand client', async () => {
    const account = generateAccount()
    const manager = { addr: account.addr, signer: makeBasicAccountTransactionSigner(account) }
    await algorand.send.payment({ sender: assetManager.addr, receiver: manager.addr, amount: algo(10) })
    const { assetId } = await algorand.send.assetCreate({
      sender: manager.addr,
      signer: manager.signer,
      total: 1n,
      assetName: 'Legacy Token',
      manager: manager.addr,
      reserve: manager.addr,
      freeze: manager.addr,
      clawback: manager.addr,
    })

    const sent = await sentTransactions(() =>
      migrateLegacyMetadataToRegistry({
        registry,
        assetManager: manager,
        assetId,
        metadata: minimalMetadata,
        arc3Compliant: false,
        publishArc2Message: true,
      }),
    )

    const arc2Txns = sent.filter((p) => p.txn.txn.type === TransactionType.acfg)
    expect(arc2Txns).toHaveLength(1)
    expect(arc2Txns[0]!.txn.txn.sender.toString()).toBe(manager.addr.toString())
    expect((await registry.read.arc89CheckMetadataExists({ assetId })).metadataExists).toBe(true)
  })
})
