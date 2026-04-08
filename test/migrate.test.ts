import { describe, expect, test, beforeAll } from 'vitest'
import { algo, Config } from '@algorandfoundation/algokit-utils'
import { nullLogger } from '@algorandfoundation/algokit-utils/logging'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { AddressWithSigners } from '@algorandfoundation/algokit-utils/transact'
import {
  Arc90Uri,
  AsaMetadataRegistry,
  AssetMetadata,
  IrreversibleFlags,
  MAX_METADATA_SIZE,
  MetadataFlags,
  ReversibleFlags,
  SHORT_METADATA_SIZE,
  encodeArc2MigrationMessage,
  buildArc2MigrationMessageTxn,
  deriveMigrationUri,
  migrateLegacyMetadataToRegistry,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { AsaMetadataRegistryClient, AsaMetadataRegistryFactory } from '@/generated'
import {
  deployRegistry,
  getDeployer,
  createFactory,
  createFundedAccount,
  createArc3Asa,
  createArc69Asa,
  createArc3Payload,
} from './helpers'

const ARC90_NETAUTH = process.env.ARC90_NETAUTH ?? 'net:localnet'

const minimalMetadata: Record<string, unknown> = {
  name: 'Test Asset',
  description: 'A test asset for migration',
}

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

describe('arc-2 message encoding', () => {
  test('encode basic uri', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM'
    const message = encodeArc2MigrationMessage(uri)

    // Should start with arc89:j prefix
    const prefix = new TextDecoder().decode(message.slice(0, 7))
    expect(prefix).toBe('arc89:j')

    // Extract and decode JSON payload
    const payload = new TextDecoder().decode(message.slice(7))
    const decoded = JSON.parse(payload)
    expect(decoded.uri).toBe(uri)
  })

  test('encode with compliance fragment', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM#arc3'
    const message = encodeArc2MigrationMessage(uri)

    const prefix = new TextDecoder().decode(message.slice(0, 7))
    expect(prefix).toBe('arc89:j')

    const payload = new TextDecoder().decode(message.slice(7))
    const decoded = JSON.parse(payload)
    expect(decoded.uri).toBe(uri)
  })

  test('encode compact json', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM'
    const message = encodeArc2MigrationMessage(uri)

    const payloadStr = new TextDecoder().decode(message.slice(7))

    // Should have compact separators (no extra whitespace)
    expect(payloadStr).toBe(JSON.stringify({ uri }))
    expect(payloadStr).not.toContain(' ')
  })

  test('encode unicode uri', () => {
    const uri = 'arc90://net:testnet/42?box=AAAAAAAAAAM&tag=测试'
    const message = encodeArc2MigrationMessage(uri)

    const payload = new TextDecoder().decode(message.slice(7))
    const decoded = JSON.parse(payload)
    expect(decoded.uri).toBe(uri)
  })
})

const fixture = algorandFixture()
let algorand: AlgorandClient
let client: AsaMetadataRegistryClient
let factory: AsaMetadataRegistryFactory
let deployer: AddressWithSigners
let assetManager: AddressWithSigners
let registry: AsaMetadataRegistry

beforeAll(async () => {
  await fixture.newScope()
  algorand = fixture.algorand
  deployer = getDeployer(fixture)
  assetManager = await createFundedAccount(fixture)

  factory = createFactory({ algorand, deployer })
  client = await deployRegistry({ factory, deployer })

  registry = AsaMetadataRegistry.fromAppClient(client, { netauth: ARC90_NETAUTH })
})

describe('migration uri derivation', () => {
  test('derive basic uri without compliance fragments', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

    const uri = deriveMigrationUri({ registry, assetId, arc3: false })
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.netauth).toBe(ARC90_NETAUTH)
    expect(parsed.appId).toBe(client.appId)
    expect(parsed.boxName).not.toBeNull()
    expect(parsed.compliance.arcs).toEqual([])
  })

  test('derive uri with arc3 flag', async () => {
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true })

    const uri = deriveMigrationUri({ registry, assetId, arc3: true })
    const parsed = Arc90Uri.parse(uri)

    expect(parsed.compliance.arcs).toEqual([3])
  })
})

describe('build arc2 migration message txn', () => {
  test('build txn basic', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })
    const metadataUri = 'arc90://net:testnet/123?box=AAAAAAAAAAM'

    const txn = await buildArc2MigrationMessageTxn({
      registry,
      assetId,
      assetManager,
      metadataUri,
    })

    // Verify transaction type
    expect(txn.type).toBe('acfg')

    // Verify note contains the ARC-2 message
    expect(txn.note).toBeDefined()
    const notePrefix = new TextDecoder().decode(txn.note!.slice(0, 7))
    expect(notePrefix).toBe('arc89:j')

    // Decode and verify the message
    const payload = new TextDecoder().decode(txn.note!.slice(7))
    const decoded = JSON.parse(payload)
    expect(decoded.uri).toBe(metadataUri)
  })

  test('build txn preserves manager', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })
    const metadataUri = 'arc90://net:testnet/123?box=AAAAAAAAAAM'

    const txn = await buildArc2MigrationMessageTxn({
      registry,
      assetId,
      assetManager,
      metadataUri,
    })

    expect(txn.note).toBeDefined()
    expect(new TextDecoder().decode(txn.note!.slice(0, 7))).toBe('arc89:j')
  })

  test('build txn preserves all roles', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })
    const metadataUri = 'arc90://net:testnet/123?box=AAAAAAAAAAM'

    const txn = await buildArc2MigrationMessageTxn({
      registry,
      assetId,
      assetManager,
      metadataUri,
    })

    expect(txn.type).toBe('acfg')
    expect(txn.note).toBeDefined()
    expect(new TextDecoder().decode(txn.note!.slice(0, 7))).toBe('arc89:j')
  })

  test('build txn without write capability error', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

    // Create read-only registry (no appClient)
    const readOnlyRegistry = AsaMetadataRegistry.fromAlgod({
      algod: algorand.client.algod,
      appId: client.appId,
    })

    await expect(
      buildArc2MigrationMessageTxn({
        registry: readOnlyRegistry,
        assetId,
        assetManager,
        metadataUri: 'arc90://net:testnet/123?box=AAAAAAAAAAM',
      }),
    ).rejects.toThrow('write capabilities')
  })
})

describe('pre-flight checks', () => {
  test('asset without metadata passes', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(false)
  })

  test('asset with existing metadata throws', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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

describe('migrate legacy metadata', () => {
  test('migrate minimal metadata', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
    const storedJson = JSON.parse(new TextDecoder().decode(stored.body.rawBytes))
    expect(storedJson).toEqual(minimalMetadata)
  })

  test('migrate arc3 metadata', async () => {
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true })

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
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true, withMetadataHash: true })

    // No flags provided - SDK should auto-set immutable
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
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true, withMetadataHash: true })

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
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true, withMetadataHash: true })

    const arc3WithArc20: Record<string, unknown> = {
      name: 'ARC-20 Token',
      properties: { 'arc-20': { 'application-id': 999 } },
    }

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

    const assetId = await createArc69Asa({
      assetManager,
      appClient: client,
      metadata: originalMetadata,
    })

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
    const storedJson = JSON.parse(new TextDecoder().decode(stored.body.rawBytes))
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
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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

    // Verify flags were applied
    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.arc89Native).toBe(false)
  })

  test('migrate with arc89 native flag throws', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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

describe('rbac preservation', () => {
  test('preserve all roles after migration', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

    // Get original asset info
    const originalInfo = await algorand.asset.getById(assetId)

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: minimalMetadata,
      arc3Compliant: false,
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
    // Create accounts with different roles
    const reserveAccount = await createFundedAccount(fixture, algo(10))
    const freezeAccount = await createFundedAccount(fixture, algo(10))
    const clawbackAccount = await createFundedAccount(fixture, algo(10))

    // Create ASA with distinct role addresses
    const result = await algorand.send.assetCreate({
      sender: assetManager.addr,
      total: 1000n,
      assetName: 'Multi-Role ASA',
      manager: assetManager.addr,
      reserve: reserveAccount.addr,
      freeze: freezeAccount.addr,
      clawback: clawbackAccount.addr,
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
    })

    // Get updated info
    const updatedInfo = await algorand.asset.getById(assetId)

    // Verify all distinct roles are preserved
    expect(updatedInfo.manager).toBe(originalInfo.manager)
    expect(updatedInfo.reserve).toBe(originalInfo.reserve)
    expect(updatedInfo.freeze).toBe(originalInfo.freeze)
    expect(updatedInfo.clawback).toBe(originalInfo.clawback)
  })

  test('preserve empty/disabled roles', async () => {
    // Create ASA with only manager set, no reserve/freeze/clawback
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
    })

    // Get updated info
    const updatedInfo = await algorand.asset.getById(assetId)

    // Verify manager preserved and empty roles remain empty
    expect(updatedInfo.manager).toBe(originalInfo.manager)
    expect(updatedInfo.reserve).toBe(originalInfo.reserve)
    expect(updatedInfo.freeze).toBe(originalInfo.freeze)
    expect(updatedInfo.clawback).toBe(originalInfo.clawback)
  })
})

describe('migration error handling', () => {
  test('migrate empty metadata', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

    await migrateLegacyMetadataToRegistry({
      registry,
      assetManager,
      assetId,
      metadata: {},
      arc3Compliant: false,
    })

    const existence = await registry.read.arc89CheckMetadataExists({ assetId })
    expect(existence.metadataExists).toBe(true)
  })

  test('migrate without manager throws', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })
    const untrustedAccount = await createFundedAccount(fixture, algo(10))
    const prevLogger = Config.logger
    Config.configure({ logger: nullLogger })
    try {
      await expect(
        migrateLegacyMetadataToRegistry({
          registry,
          assetManager: untrustedAccount,
          assetId,
          metadata: minimalMetadata,
          arc3Compliant: false,
        }),
      ).rejects.toThrow()
    } finally {
      Config.configure({ logger: prevLogger })
    }
  })
})

describe('migration integration', () => {
  test('full migration workflow', async () => {
    const assetId = await createArc3Asa({ assetManager, appClient: client, preRegistry: true })

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
    const storedJson = JSON.parse(new TextDecoder().decode(stored.body.rawBytes))
    expect(storedJson).toEqual(arc3Metadata)

    // 5. Verify ARC-3 flag
    const header = await registry.read.arc89GetMetadataHeader({ assetId })
    expect(header.flags.irreversible.arc3).toBe(true)

    // 6. Verify RBAC unchanged
    const assetInfo = await algorand.asset.getById(assetId)
    expect(assetInfo.manager).toBeDefined()

    // 7. Verify we can read the metadata hash
    const hashResult = await registry.read.arc89GetMetadataHash({ assetId })
    expect(hashResult.length).toBe(32)
  })

  test('migration with subsequent updates', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
    const storedJson = JSON.parse(new TextDecoder().decode(stored.body.rawBytes))
    expect(storedJson.name).toBe('Updated Asset')
    expect(storedJson.version).toBe(2)
  })

  test('migration metadata size boundary', async () => {
    const assetId = await createArc69Asa({ assetManager, appClient: client })

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
