/**
 * Unit tests for src/registry module.
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
 */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
  AlgodBoxReader,
  AlgodClientSubset,
  Arc90Uri,
  AsaMetadataRegistryRead,
  AsaMetadataRegistryWrite,
  MissingAppClientError,
  RegistryConfig,
  RegistryResolutionError,
  AsaMetadataRegistry,
} from '@algorandfoundation/asa-metadata-registry-sdk'

import { AsaMetadataRegistryClient } from '@/generated'

// ================================================================
// Mocks
// ================================================================

const createMockAlgod = (): AlgodClientSubset => {
  return {
    getApplicationBoxByName: vi.fn(),
    getAssetByID: vi.fn(),
  } as AlgodClientSubset
}

const createMockAppClient = (appId?: bigint): AsaMetadataRegistryClient => {
  return {
    appClient: {
      appId: appId ?? 12345n,
      clone: vi.fn(),
    },
    clone: vi.fn().mockImplementation((params: { appId: bigint }) => {
      return createMockAppClient(params.appId)
    }),
  } as unknown as AsaMetadataRegistryClient
}

// ================================================================
// Unit Tests
// ================================================================

describe('asa metadata registry (unit)', () => {
  let algod: AlgodClientSubset
  let appClient: AsaMetadataRegistryClient

  beforeEach(() => {
    vi.resetAllMocks()
    algod = createMockAlgod()
    appClient = createMockAppClient()
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
      const config = new RegistryConfig({ appId: 12345 })
      expect(Object.isFrozen(config)).toBe(true)
      expect(() => ((config as any).appId = 54321n)).toThrow(TypeError)
      expect(config.appId).toBe(12345n)
    })

    test('config equality', () => {
      // Test RegistryConfig equality.
      const config1 = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      const config2 = new RegistryConfig({ appId: 12345, netauth: 'net:testnet' })
      const config3 = new RegistryConfig({ appId: 54321, netauth: 'net:testnet' })

      expect(config1.appId).toBe(config2.appId)
      expect(config1.netauth).toBe(config2.netauth)
      expect(config1.appId).not.toBe(config3.appId)
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
      expect(avmReader).toBeDefined()
      expect(appClient.clone).toHaveBeenCalledWith({ appId: 67890n })
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
      const client99999 = createMockAppClient(99999n)
      const registry = AsaMetadataRegistry.fromAppClient(client99999)

      expect(registry.config.appId).toBe(99999n)
    })

    test('from app client with zero app id becomes null', () => {
      // Test that appId of 0 from client becomes null.
      const client0 = createMockAppClient(0n)
      const registry = AsaMetadataRegistry.fromAppClient(client0)

      expect(registry.config.appId).toBeNull()
    })

    test('from app client with missing app id attribute', () => {
      // Test fromAppClient when client lacks appId on appClient.
      const clientNoAppId = {
        clone: vi.fn(),
      } as unknown as AsaMetadataRegistryClient
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
    test('factory creates client via clone', () => {
      // Test that factory creates clients using clone with correct appId.
      const config = new RegistryConfig({ appId: 12345 })
      const registry = new AsaMetadataRegistry({ config, appClient })

      const factory = (registry as any).generatedClientFactory as (appId: bigint) => AsaMetadataRegistryClient

      // Call factory with different appIds
      factory(12345n)
      factory(67890n)

      expect(appClient.clone).toHaveBeenCalledTimes(2)
      expect(appClient.clone).toHaveBeenCalledWith({ appId: 12345n })
      expect(appClient.clone).toHaveBeenCalledWith({ appId: 67890n })
    })

    test('factory raises on missing clone', () => {
      // Test factory raises MissingAppClientError if client lacks clone().
      const clientNoClone = {
        appClient: { appId: 12345n },
      } as unknown as AsaMetadataRegistryClient

      const config = new RegistryConfig({ appId: 12345 })
      expect(() => new AsaMetadataRegistry({ config, appClient: clientNoClone })).toThrow(MissingAppClientError)
      expect(() => new AsaMetadataRegistry({ config, appClient: clientNoClone })).toThrow(/does not support clone/)
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
    vi.resetAllMocks()
    algod = createMockAlgod()
    appClient = createMockAppClient()
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
