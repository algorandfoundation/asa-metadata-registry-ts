/**
 * Unit tests for src/registry module.
 *
 * Ported from Python `arc89/tests/sdk/test_registry.py` (v1.0.0).
 *
 * Tests cover:
 * - RegistryConfig class
 * - AsaMetadataRegistry initialization
 * - fromAlgod constructor
 * - fromAppClient constructor with various configurations
 * - arc90Uri helper method
 * - write property access (with/without appClient)
 * - makeGeneratedClientFactory internals
 * - Error handling and edge cases
 * - Read/write workflows against a registry deployed on LocalNet
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { generateAccount, makeBasicAccountTransactionSigner, type Algodv2 } from 'algosdk'
import {
  AlgodBoxReader,
  type AlgodClientSubset,
  Arc90Uri,
  AsaMetadataRegistry,
  AsaMetadataRegistryAvmRead,
  AsaMetadataRegistryRead,
  AsaMetadataRegistryWrite,
  MetadataSource,
  MissingAppClientError,
  RegistryConfig,
  RegistryResolutionError,
  assetIdToBoxName,
  completePartialAssetUrl,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { AsaMetadataRegistryClient } from '@/generated'
import {
  ARC90_NETAUTH,
  type AddressWithSigners,
  buildShortMetadata,
  createArc89Asa,
  createFactory,
  createFundedAccount,
  deployRegistry,
  getDeployer,
  sampleJsonObj,
} from './helpers'

// ================================================================
// Mocks
// ================================================================

/** An algosdk request object: the Algod HTTP call happens on `.do()`. */
type AlgodRequest = { do: () => Promise<unknown> }

/** Mock of the algosdk `Algodv2` subset wrapped by `AlgodBoxReader`. */
const createMockAlgod = () => ({
  getApplicationBoxByName: vi.fn<(appId: bigint, boxName: Uint8Array) => AlgodRequest>(),
  getAssetByID: vi.fn<(assetId: bigint) => AlgodRequest>(),
})

type MockAlgod = ReturnType<typeof createMockAlgod>

/**
 * Mock of the generated AsaMetadataRegistryClient: `appId` (0n = unbound, also on the underlying
 * `appClient`) and `clone({ appId })`, returning a mock bound to the new app id (the generated client
 * clone keeps the Algorand client and the default sender/signer).
 */
const createMockAppClient = (appId: bigint = 12345n): AsaMetadataRegistryClient =>
  ({
    appId,
    appClient: { appId },
    clone: vi.fn((params: { appId?: bigint }) => createMockAppClient(params.appId ?? appId)),
  }) as unknown as AsaMetadataRegistryClient

/** The (private) `AsaMetadataRegistry.makeGeneratedClientFactory`. */
const makeGeneratedClientFactory = (
  baseClient: AsaMetadataRegistryClient,
): ((appId: bigint) => AsaMetadataRegistryClient) =>
  (AsaMetadataRegistry as any).makeGeneratedClientFactory({ baseClient })

// ================================================================
// Unit Tests
// ================================================================

describe('asa metadata registry (unit)', () => {
  let algodMock: MockAlgod
  let algod: AlgodClientSubset
  let appClient: AsaMetadataRegistryClient

  beforeEach(() => {
    algodMock = createMockAlgod()
    algod = algodMock as unknown as AlgodClientSubset
    appClient = createMockAppClient(12345n)
  })

  describe('registry config', () => {
    // Tests for RegistryConfig class.
    test('default config', () => {
      // Test default RegistryConfig values.
      const config = new RegistryConfig()
      expect(config.appId).toBeNull()
      expect(config.netauth).toBeNull()
    })

    test('config with app id', () => {
      // Test RegistryConfig with appId.
      const config = new RegistryConfig({ appId: 12345 })
      expect(config.appId).toBe(12345n)
      expect(config.netauth).toBeNull()
    })

    test('config with netauth', () => {
      // Test RegistryConfig with netauth.
      const config = new RegistryConfig({ netauth: 'net:testnet' })
      expect(config.appId).toBeNull()
      expect(config.netauth).toBe('net:testnet')
    })

    test('config with all params', () => {
      // Test RegistryConfig with all parameters.
      const config = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      expect(config.appId).toBe(12345n)
      expect(config.netauth).toBe('net:testnet')
    })

    test('config is frozen', () => {
      // Test that RegistryConfig is immutable.
      const config = new RegistryConfig({ appId: 12345 })
      expect(Object.isFrozen(config)).toBe(true)
      expect(() => ((config as any).appId = 54321n)).toThrow(TypeError)
      expect(config.appId).toBe(12345n)
    })

    test('config equality', () => {
      // Test RegistryConfig equality.
      const config1 = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      const config2 = new RegistryConfig({ appId: 12345n, netauth: 'net:testnet' })
      const config3 = new RegistryConfig({ appId: 54321, netauth: 'net:testnet' })

      expect(config1).toStrictEqual(config2)
      expect(config1).not.toStrictEqual(config3)
    })
  })

  describe('registry initialization', () => {
    // Tests for AsaMetadataRegistry constructor.
    test('init minimal', () => {
      // Test initialization with minimal config.
      const config = new RegistryConfig()
      const registry = new AsaMetadataRegistry({ config })
      expect(registry.config).toBe(config)
      expect((registry as any).algodReader).toBeNull()
      expect((registry as any).baseGeneratedClient).toBeNull()
      expect((registry as any).generatedClientFactory).toBeNull()
      expect((registry as any).avmReaderFactory).toBeNull()
      expect((registry as any)._write).toBeNull()
      expect(registry.read).toBeInstanceOf(AsaMetadataRegistryRead)
    })

    test('init with algod', () => {
      // Test initialization with algod client.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, algod })
      expect(registry.config).toBe(config)
      expect((registry as any).algodReader).not.toBeNull()
      expect((registry as any).algodReader).toBeInstanceOf(AlgodBoxReader)
      expect((registry as any).algodReader.algod).toBe(algod)
    })

    test('init with app client', () => {
      // Test initialization with appClient.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, appClient })

      expect((registry as any).baseGeneratedClient).toBe(appClient)
      expect((registry as any).generatedClientFactory).not.toBeNull()
      expect((registry as any).avmReaderFactory).not.toBeNull()
      expect((registry as any)._write).not.toBeNull()
      expect((registry as any)._write).toBeInstanceOf(AsaMetadataRegistryWrite)
      // The appClient is bound to config.appId: writes use it as is
      expect(registry.write.client).toBe(appClient)
      expect(appClient.clone).not.toHaveBeenCalled()
    })

    test('init with algod and app client', () => {
      // Test initialization with both algod and appClient.
      const config = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      const registry = new AsaMetadataRegistry({ config, algod, appClient })

      expect((registry as any).algodReader).not.toBeNull()
      expect((registry as any).baseGeneratedClient).toBe(appClient)
      expect((registry as any)._write).not.toBeNull()
    })

    test('avm reader factory creates avm read', () => {
      // Test that avmReaderFactory creates AsaMetadataRegistryAvmRead instances.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, appClient })

      expect((registry as any).avmReaderFactory).not.toBeNull()
      const avmReader = (registry as any).avmReaderFactory(67890n)
      expect(avmReader).toBeInstanceOf(AsaMetadataRegistryAvmRead)
      expect(avmReader.client.appId).toBe(67890n)
      expect(appClient.clone).toHaveBeenCalledExactlyOnceWith({ appId: 67890n })
    })
  })

  describe('write property', () => {
    // Tests for AsaMetadataRegistry.write property.
    test('write property without app client raises', () => {
      // Test that accessing write without appClient raises MissingAppClientError.
      const config = new RegistryConfig()
      const registry = new AsaMetadataRegistry({ config })

      expect(() => registry.write).toThrow(MissingAppClientError)
      expect(() => registry.write).toThrow(/Write operations require/)
    })

    test('write property with app client returns writer', () => {
      // Test that accessing write with appClient returns AsaMetadataRegistryWrite.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, appClient })

      const writer = registry.write
      expect(writer).toBeInstanceOf(AsaMetadataRegistryWrite)
      // Subsequent calls should return the same instance
      expect(registry.write).toBe(writer)
    })
  })

  describe('from algod', () => {
    // Tests for AsaMetadataRegistry.fromAlgod constructor.
    test('from algod with app id', () => {
      // Test fromAlgod with appId.
      const registry = AsaMetadataRegistry.fromAlgod({ algod, appId: 12345 })

      expect(registry.config.appId).toBe(12345n)
      expect(registry.config.netauth).toBeNull()
      expect((registry as any).algodReader).not.toBeNull()
      expect((registry as any).baseGeneratedClient).toBeNull()
      expect((registry as any)._write).toBeNull()
    })

    test('from algod without app id', () => {
      // Test fromAlgod without appId.
      const registry = AsaMetadataRegistry.fromAlgod({ algod, appId: null })

      expect(registry.config.appId).toBeNull()
      expect((registry as any).algodReader).not.toBeNull()
    })

    test('from algod creates algod reader', () => {
      // Test that fromAlgod creates AlgodBoxReader.
      const registry = AsaMetadataRegistry.fromAlgod({ algod, appId: 12345 })

      expect((registry as any).algodReader).toBeInstanceOf(AlgodBoxReader)
      expect((registry as any).algodReader.algod).toBe(algod)
    })
  })

  describe('from app client', () => {
    // Tests for AsaMetadataRegistry.fromAppClient constructor.
    test('from app client minimal', () => {
      // Test fromAppClient with minimal arguments.
      const registry = AsaMetadataRegistry.fromAppClient(appClient)

      expect(registry.config.appId).toBe(12345n)
      expect(registry.config.netauth).toBeNull()
      expect((registry as any).algodReader).toBeNull()
      expect((registry as any).baseGeneratedClient).toBe(appClient)
    })

    test('from app client with explicit app id', () => {
      // Test fromAppClient with explicit appId overrides client's appId.
      const registry = AsaMetadataRegistry.fromAppClient(appClient, { appId: 67890 })

      expect(registry.config.appId).toBe(67890n)
    })

    test('from app client with netauth', () => {
      // Test fromAppClient with netauth.
      const registry = AsaMetadataRegistry.fromAppClient(appClient, { netauth: 'net:testnet' })

      expect(registry.config.netauth).toBe('net:testnet')
    })

    test('from app client with algod', () => {
      // Test fromAppClient with optional algod client.
      const registry = AsaMetadataRegistry.fromAppClient(appClient, { algod })

      expect((registry as any).algodReader).not.toBeNull()
      expect((registry as any).algodReader).toBeInstanceOf(AlgodBoxReader)
    })

    test('from app client infers app id from client', () => {
      // Test that appId is inferred from client if not provided.
      const registry = AsaMetadataRegistry.fromAppClient(createMockAppClient(99999n))

      expect(registry.config.appId).toBe(99999n)
    })

    test('from app client with zero app id becomes null', () => {
      // Test that appId of 0 from client becomes null.
      const registry = AsaMetadataRegistry.fromAppClient(createMockAppClient(0n))

      expect(registry.config.appId).toBeNull()
    })

    test('from app client with missing app id attribute', () => {
      // Test fromAppClient when client lacks appId.
      const clientNoAppId = { clone: vi.fn() } as unknown as AsaMetadataRegistryClient
      const registry = AsaMetadataRegistry.fromAppClient(clientNoAppId)

      expect(registry.config.appId).toBeNull()
    })

    test('from app client all params', () => {
      // Test fromAppClient with all parameters.
      const registry = AsaMetadataRegistry.fromAppClient(appClient, {
        algod,
        appId: 12345,
        netauth: 'net:testnet',
      })

      expect(registry.config.appId).toBe(12345n)
      expect(registry.config.netauth).toBe('net:testnet')
      expect((registry as any).algodReader).not.toBeNull()
      expect((registry as any).baseGeneratedClient).toBe(appClient)
    })
  })

  describe('arc90 uri', () => {
    // Tests for AsaMetadataRegistry.arc90Uri method.
    test('arc90 uri with config app id', () => {
      // Test arc90Uri using appId from config.
      const config = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      const registry = new AsaMetadataRegistry({ config })

      const uri = registry.arc90Uri({ assetId: 999 })

      expect(uri).toBeInstanceOf(Arc90Uri)
      expect(uri.appId).toBe(12345n)
      expect(uri.netauth).toBe('net:testnet')
      // Verify the assetId was applied to boxName
      expect(uri.boxName).not.toBeNull()
      expect(uri.boxName).toEqual(assetIdToBoxName(999))
      expect(uri.assetId).toBe(999n)
    })

    test('arc90 uri with explicit app id', () => {
      // Test arc90Uri with explicit appId parameter.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config })

      const uri = registry.arc90Uri({ assetId: 999, appId: 67890 })

      expect(uri.appId).toBe(67890n)
    })

    test('arc90 uri without app id raises', () => {
      // Test arc90Uri raises RegistryResolutionError when no appId available.
      const config = new RegistryConfig() // No appId
      const registry = new AsaMetadataRegistry({ config })

      expect(() => registry.arc90Uri({ assetId: 999 })).toThrow(RegistryResolutionError)
      expect(() => registry.arc90Uri({ assetId: 999 })).toThrow(/Cannot build ARC-90 URI/)
    })

    test('arc90 uri with no config app id but explicit', () => {
      // Test arc90Uri works with explicit appId even if config has none.
      const config = new RegistryConfig()
      const registry = new AsaMetadataRegistry({ config })

      const uri = registry.arc90Uri({ assetId: 999, appId: 12345 })

      expect(uri.appId).toBe(12345n)
    })

    test('arc90 uri preserves netauth', () => {
      // Test arc90Uri preserves netauth from config.
      const config = new RegistryConfig({ appId: 12345, netauth: 'net:betanet' })
      const registry = new AsaMetadataRegistry({ config })

      const uri = registry.arc90Uri({ assetId: 777 })

      expect(uri.netauth).toBe('net:betanet')
    })

    test('arc90 uri with none netauth', () => {
      // Test arc90Uri with null netauth (mainnet).
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config })

      const uri = registry.arc90Uri({ assetId: 777 })

      expect(uri.netauth).toBeNull()
    })
  })

  describe('make generated client factory', () => {
    // Tests for AsaMetadataRegistry.makeGeneratedClientFactory (private static).
    test('factory creates client with correct params', () => {
      // Test that factory creates clients bound to the requested appIds (via clone).
      const factory = makeGeneratedClientFactory(appClient)

      // Call factory with different appIds
      const client1 = factory(12345n)
      const client2 = factory(67890n)

      expect(appClient.clone).toHaveBeenCalledTimes(2)
      expect(appClient.clone).toHaveBeenNthCalledWith(1, { appId: 12345n })
      expect(appClient.clone).toHaveBeenNthCalledWith(2, { appId: 67890n })
      expect(client1.appId).toBe(12345n)
      expect(client2.appId).toBe(67890n)
    })

    test('factory keeps algorand client and default sender and signer', async () => {
      // Python extracts the Algorand client and default sender/signer from the base client:
      // the generated TS client clone() keeps them.
      const algorand = AlgorandClient.defaultLocalNet()
      const sender = generateAccount()
      const signer = makeBasicAccountTransactionSigner(sender)
      const baseClient = new AsaMetadataRegistryClient({
        algorand,
        appId: 12345n,
        defaultSender: sender.addr,
        defaultSigner: signer,
      })

      const client = makeGeneratedClientFactory(baseClient)(67890n)

      expect(client).toBeInstanceOf(AsaMetadataRegistryClient)
      expect(client).not.toBe(baseClient)
      expect(client.appId).toBe(67890n)
      expect(baseClient.appId).toBe(12345n)
      expect(client.algorand).toBe(algorand)
      // App calls default to the base client's sender and signer (no network access needed)
      const call = await client.params.arc89GetMetadataRegistryParameters()
      expect(call.appId).toBe(67890n)
      expect(call.sender.toString()).toBe(sender.addr.toString())
      expect(call.signer).toBe(signer)
    })

    test('factory raises on missing clone', () => {
      // Python raises MissingAppClientError if the generated client class or the Algorand client
      // cannot be located: the TS factory requires the generated client clone().
      const clientNoClone = { appId: 12345n } as unknown as AsaMetadataRegistryClient

      expect(() => makeGeneratedClientFactory(clientNoClone)).toThrow(MissingAppClientError)
      expect(() => makeGeneratedClientFactory(clientNoClone)).toThrow(/does not support clone/)

      const config = new RegistryConfig({ appId: 12345 })
      expect(() => new AsaMetadataRegistry({ config, appClient: clientNoClone })).toThrow(MissingAppClientError)
    })

    test('factory converts app id to bigint', () => {
      // AVM readers are bound to bigint appIds, whatever the numeric type of the requested appId.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, appClient })

      const avmReader = registry.read.avm({ appId: 67890 })

      expect(avmReader).toBeInstanceOf(AsaMetadataRegistryAvmRead)
      expect(avmReader.client.appId).toBe(67890n)
      expect(appClient.clone).toHaveBeenCalledExactlyOnceWith({ appId: 67890n })
    })
  })
})

// ================================================================
// Workflow Tests
// ================================================================

describe('asa metadata registry (workflow)', () => {
  // Workflow tests combining multiple components.
  let algod: AlgodClientSubset
  let appClient: AsaMetadataRegistryClient

  beforeEach(() => {
    algod = createMockAlgod() as unknown as AlgodClientSubset
    appClient = createMockAppClient(12345n)
  })

  test('read only workflow', () => {
    // Test read-only workflow using fromAlgod.
    const registry = AsaMetadataRegistry.fromAlgod({ algod, appId: 12345 })

    // Should have read access
    expect(registry.read).toBeInstanceOf(AsaMetadataRegistryRead)

    // Should not have write access
    expect(() => registry.write).toThrow(MissingAppClientError)

    // Should be able to create URIs
    const uri = registry.arc90Uri({ assetId: 999 })
    expect(uri.appId).toBe(12345n)
  })

  test('read write workflow', () => {
    // Test read-write workflow using fromAppClient.
    const registry = AsaMetadataRegistry.fromAppClient(appClient)

    // Should have both read and write access
    expect(registry.read).toBeInstanceOf(AsaMetadataRegistryRead)
    expect(registry.write).toBeInstanceOf(AsaMetadataRegistryWrite)

    // Should be able to create URIs
    const uri = registry.arc90Uri({ assetId: 999 })
    expect(uri.appId).toBe(12345n)
  })

  test('hybrid workflow with algod and app client', () => {
    // Test workflow with both algod (for fast reads) and appClient (for writes).
    const registry = AsaMetadataRegistry.fromAppClient(appClient, { algod })

    // Should have algod reader for fast box reads
    expect((registry as any).algodReader).not.toBeNull()

    // Should have write access
    expect(registry.write).toBeInstanceOf(AsaMetadataRegistryWrite)

    // Should have read access that can use both algod and avm
    expect(registry.read).toBeInstanceOf(AsaMetadataRegistryRead)
  })
})

// ================================================================
// LocalNet Workflow Tests
// ================================================================

describe('asa metadata registry (localnet)', () => {
  // Facade workflows against a registry deployed on LocalNet. LocalNet is not a known deployment:
  // the facade pins the ARC-90 netauth the registry was deployed with (ARC90_NETAUTH).
  const fixture = algorandFixture()
  let algod: Algodv2
  let client: AsaMetadataRegistryClient
  let assetManager: AddressWithSigners

  beforeAll(async () => {
    await fixture.newScope()
    algod = fixture.context.algod
    const deployer = getDeployer(fixture)
    client = await deployRegistry({ factory: createFactory({ algorand: fixture.algorand, deployer }), deployer })
    assetManager = await createFundedAccount(fixture)
  })

  test('localnet read write workflow', async () => {
    // fromAppClient + algod: writes with the bound client, reads from BOX and AVM.
    const registry = AsaMetadataRegistry.fromAppClient(client, { algod, netauth: ARC90_NETAUTH })
    expect(registry.write.client).toBe(client)

    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await registry.write.createMetadata({ assetManager, metadata: buildShortMetadata(assetId) })

    const boxRecord = await registry.read.getAssetMetadata({ assetId, source: MetadataSource.BOX })
    const avmRecord = await registry.read.getAssetMetadata({ assetId, source: MetadataSource.AVM })
    expect(boxRecord.appId).toBe(client.appId)
    expect(boxRecord.assetId).toBe(assetId)
    expect(boxRecord.json).toStrictEqual(sampleJsonObj)
    expect(avmRecord.body.rawBytes).toEqual(boxRecord.body.rawBytes)
    expect(avmRecord.header.revision).toBe(boxRecord.header.revision)

    // The off-chain URI helper matches the resolved URI, the on-chain partial URI and the ASA URL
    const uri = registry.arc90Uri({ assetId }).toUri()
    expect((await registry.read.resolveArc90Uri({ assetId })).toUri()).toBe(uri)
    expect(completePartialAssetUrl(await registry.read.arc89GetMetadataPartialUri(), assetId)).toBe(uri)
    const assetUrl = await new AlgodBoxReader(algod).getAssetUrl(assetId)
    expect(completePartialAssetUrl(assetUrl!, assetId)).toBe(uri)
  })
})
