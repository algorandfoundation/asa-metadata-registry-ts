/**
 * Extensive tests for src/write/writer module.
 *
 * Tests cover:
 * - WriteOptions configuration (mock)
 * - AsaMetadataRegistryWrite initialization and validation (mock when possible)
 * - Group building methods
 * - High-level send methods
 * - Flag management methods (mock when possible)
 * - Utility methods (mock)
 * - Fee pooling and padding
 * - Extra resources handling (mock)
 * - Error handling and edge cases
 */

import { describe, expect, test, vi, beforeAll, beforeEach } from 'vitest'
import { Address, type TransactionSigner, modelsv2 } from 'algosdk'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { microAlgo, type AlgorandClient } from '@algorandfoundation/algokit-utils'
import type { SimulateOptions } from '@algorandfoundation/algokit-utils/types/composer'
import {
  InvalidArc3PropertiesError,
  InvalidFlagIndexError,
  MissingAppClientError,
  getDefaultRegistryParams,
  RegistryParameters,
  flags,
  AssetMetadata,
  MbrDelta,
  AsaMetadataRegistryRead,
  AlgodBoxReader,
  // writer
  AsaMetadataRegistryWrite,
  WriteOptions,
  writeOptionsDefault,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import {
  AsaMetadataRegistryClient,
  AsaMetadataRegistryComposer,
  AsaMetadataRegistryFactory,
  AsaMetadataRegistryComposerResults,
} from '@/generated'
import { parseMbrDelta } from '@/internal/avm'
import {
  appendExtraResources,
  chunksForSlice,
  isPositiveUint64,
  toArcPropertyKey,
  validateArcProperty,
} from '@/internal/writer'
import {
  deployRegistry,
  getDeployer,
  createFactory,
  createFundedAccount,
  createArc89Asa,
  buildEmptyMetadata,
  buildShortMetadata,
  buildMaxedMetadata,
  uploadMetadata,
} from './helpers'

// ================================================================
// Mocks
// ================================================================

const createMockAppClient = (): AsaMetadataRegistryClient => {
  return {
    appClient: { appId: 12345n },
    appId: 12345n,
    appAddress: 'IEEMEG2UHU5HZZ4AWTKJ4ZQCBX3LBZQBE7YYGLPOT5G4HHCXNPFP47DKCM',
    clone: vi.fn(),
    newGroup: vi.fn(),
    algorand: {
      getSuggestedParams: vi.fn(),
      createTransaction: { payment: vi.fn() },
    },
  } as unknown as AsaMetadataRegistryClient
}

const createMockSigningAccount = (): TransactionSignerAccount => ({
  addr: Address.fromString('IIOWCOZ6GR5KX23BOV5EAPJ7SI3LVN6BBNEIUGFUYX4X2W65H5UXCMIZKU'),
  signer: vi.fn() as unknown as TransactionSigner,
})

const createMockComposer = (): AsaMetadataRegistryComposer<unknown[]> => {
  return {
    send: vi.fn(),
    simulate: vi.fn(),
  } as unknown as AsaMetadataRegistryComposer<unknown[]>
}

// ================================================================
// AsaMetadataRegistryWrite (a.k.a. writer) Tests
// ================================================================

// mock
let mockClient: AsaMetadataRegistryClient

// on-chain
const fixture = algorandFixture()
let algorand: AlgorandClient
let client: AsaMetadataRegistryClient
let factory: AsaMetadataRegistryFactory
let deployer: TransactionSignerAccount

beforeAll(async () => {
  await fixture.newScope()
  algorand = fixture.algorand
  deployer = getDeployer(fixture)
  factory = createFactory({ algorand, deployer })
  client = await deployRegistry({ factory, deployer })
})

beforeEach(() => {
  vi.resetAllMocks()
  mockClient = createMockAppClient()
})

// ================================================================
// WriteOptions Tests
// ================================================================

describe('write options', () => {
  // Test WriteOptions interface and its expected defaults.
  test('default options', () => {
    // Test default WriteOptions values.
    expect(writeOptionsDefault.extraResources).toBe(0)
    expect(writeOptionsDefault.feePaddingTxns).toBe(0)
    expect(writeOptionsDefault.coverAppCallInnerTransactionFees).toBe(true)
    expect(writeOptionsDefault.populateAppCallResources).toBe(true)
  })

  test('custom options', () => {
    // Test custom WriteOptions configuration.
    const opts: WriteOptions = {
      extraResources: 5,
      feePaddingTxns: 2,
      coverAppCallInnerTransactionFees: false,
      populateAppCallResources: false,
    }
    expect(opts.extraResources).toBe(5)
    expect(opts.feePaddingTxns).toBe(2)
    expect(opts.coverAppCallInnerTransactionFees).toBe(false)
    expect(opts.populateAppCallResources).toBe(false)
  })
})

// ================================================================
// Private Helper Functions Tests
// ================================================================

describe('chunking helpers', () => {
  // Tests for module-level internal chunksForSlice function.
  test('chunks for slice single', () => {
    // Test slicing a small payload into single chunk.
    const payload = new TextEncoder().encode('slice')
    const chunks = chunksForSlice(payload, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(payload)
  })

  test('chunks for slice multiple', () => {
    // Tests slicing a large payload into multiple chunks.
    const payload = new Uint8Array(250).fill(0x78) // b"x" * 250
    const chunks = chunksForSlice(payload, 100)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
    expect(chunks[1]).toHaveLength(100)
    expect(chunks[2]).toHaveLength(50)
    // Concatenated chunks must equal original payload
    const reassembled = new Uint8Array([...chunks[0], ...chunks[1], ...chunks[2]])
    expect(reassembled).toEqual(payload)
  })

  test('chunks for slice empty', () => {
    // Test slicing empty payload.
    const chunks = chunksForSlice(new Uint8Array(), 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(new Uint8Array())
  })

  test('chunks for slice invalid max size', () => {
    // Test slicing with invalid max size.
    const payload = new TextEncoder().encode('test')
    expect(() => chunksForSlice(payload, 0)).toThrow(RangeError)
    expect(() => chunksForSlice(payload, -1)).toThrow(RangeError)
  })
})

describe('composer helpers', () => {
  // Tests composer helper functions (mocked).
  test('append extra resources zero', () => {
    // Test that no extra resources are appended when count is 0.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: 0, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).not.toHaveBeenCalled()
  })

  test('append extra resources negative', () => {
    // Test that negative count doesn't append extra resources.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: -5, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).not.toHaveBeenCalled()
  })

  test('append extra resources multiple', () => {
    // Test appending multiple extra resource calls.
    const composer = { extraResources: vi.fn() } as unknown as AsaMetadataRegistryComposer<unknown[]>
    const account = createMockSigningAccount()
    appendExtraResources(composer, { count: 3, sender: account.addr, signer: account.signer })
    expect(composer.extraResources).toHaveBeenCalledTimes(3)
  })
})

describe('arc property helpers', () => {
  // Tests for module-level internal ARC-3 compliance helpers.
  test('to arc property key maps known indices and rejects unknown', () => {
    // Test that toArcPropertyKey correctly maps known flag indices and throws on unknown.
    expect(toArcPropertyKey(flags.REV_FLG_ARC20)).toBe('arc-20')
    expect(toArcPropertyKey(flags.REV_FLG_ARC62)).toBe('arc-62')
    expect(() => toArcPropertyKey(flags.REV_FLG_NTT)).toThrow()
  })

  test.each([
    [1, true],
    [Number.MAX_SAFE_INTEGER, true],
    [Number.MAX_SAFE_INTEGER + 1, false],
    [0, false],
    [-1, false],
    [1n, false],
    ['1', false],
    [null, false],
  ])('isPositiveUint64(%p) === %p', (value, expected) => {
    // Test isPositiveUint64 accepts safe positive integers and rejects all other values.
    expect(isPositiveUint64(value)).toBe(expected)
  })

  test.each(['arc-20', 'arc-62'] as const)('validateArcProperty invalid body throws for %s', (arcKey) => {
    // Test that validateArcProperty throws InvalidArc3PropertiesError for all invalid body shapes.
    const invalidBodies: Record<string, unknown>[] = [
      {},
      { properties: 'not-a-dict' },
      { properties: { 'other-key': 1 } },
      { properties: { 'arc-20': 'not-a-dict', 'arc-62': 'not-a-dict' } },
      { properties: { 'arc-20': {}, 'arc-62': {} } },
      {
        properties: {
          'arc-20': { 'application-id': 0 },
          'arc-62': { 'application-id': 0 },
        },
      },
      {
        properties: {
          'arc-20': { 'application-id': -1 },
          'arc-62': { 'application-id': -1 },
        },
      },
      {
        properties: {
          'arc-20': { 'application-id': '123' },
          'arc-62': { 'application-id': '123' },
        },
      },
      {
        properties: {
          'arc-20': { 'application-id': 2n ** 64n },
          'arc-62': { 'application-id': 2n ** 64n },
        },
      },
    ]

    for (const body of invalidBodies) {
      expect(() => validateArcProperty(body, arcKey)).toThrow(InvalidArc3PropertiesError)
    }
  })

  test.each(['arc-20', 'arc-62'] as const)('validateArcProperty valid body passes for %s', (arcKey) => {
    // Test that validateArcProperty does not throw for a well-formed body.
    const body = { properties: { [arcKey]: { 'application-id': 123456 } } }
    expect(() => validateArcProperty(body, arcKey)).not.toThrow()
  })
})

// ================================================================
// Send Group Helper Tests
// ================================================================

describe('send group helper', () => {
  // Test sendGroup helper behavior (mocked).
  let composer: AsaMetadataRegistryComposer<unknown[]>
  let sendResult: AsaMetadataRegistryComposerResults<unknown[]>

  beforeEach(() => {
    vi.resetAllMocks()
    composer = createMockComposer()
    sendResult = { groupId: 'group-id', txIds: ['tx-id'], returns: [], confirmations: [], transactions: [] }
  })

  test('build send params from options', async () => {
    // Test sendGroup derives SendParams from WriteOptions.
    composer.send = vi.fn().mockResolvedValue(sendResult)
    const options: WriteOptions = {
      extraResources: 0,
      feePaddingTxns: 0,
      coverAppCallInnerTransactionFees: false,
      populateAppCallResources: false,
    }

    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      sendParams: null,
      options,
    })

    expect(result).toBe(sendResult)
    expect(composer.simulate).not.toHaveBeenCalled()
    expect(composer.send).toHaveBeenCalledTimes(1)
    expect(composer.send).toHaveBeenCalledWith({
      coverAppCallInnerTransactionFees: false,
      populateAppCallResources: false,
    })
  })

  test('use provided send params', async () => {
    // Test sendGroup uses provided SendParams.
    const send = vi.fn().mockResolvedValue(sendResult)
    composer.send = send
    const sendParams = {
      coverAppCallInnerTransactionFees: false,
      populateAppCallResources: false,
    }

    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      sendParams,
      options: {
        extraResources: 0,
        feePaddingTxns: 0,
        coverAppCallInnerTransactionFees: true,
        populateAppCallResources: true,
      } satisfies WriteOptions,
    })

    expect(result).toBe(sendResult)
    expect(composer.simulate).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe(sendParams)
  })

  test('build send params with default options', async () => {
    // Test sendGroup derives default SendParams when options are omitted.
    composer.send = vi.fn().mockResolvedValue(sendResult)

    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      sendParams: null,
      options: null,
    })

    expect(result).toBe(sendResult)
    expect(composer.simulate).not.toHaveBeenCalled()
    expect(composer.send).toHaveBeenCalledTimes(1)
    expect(composer.send).toHaveBeenCalledWith({
      coverAppCallInnerTransactionFees: true,
      populateAppCallResources: true,
    })
  })

  test('simulate over send', async () => {
    // Test sendGroup uses simulate when SimulateOptions is provided.
    composer.simulate = vi.fn().mockResolvedValue(sendResult)
    const simulateOptions: SimulateOptions = {
      allowMoreLogging: true,
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      extraOpcodeBudget: 4567,
      execTraceConfig: { enable: true } as modelsv2.SimulateTraceConfig,
      round: 999,
      skipSignatures: false,
    }

    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      options: writeOptionsDefault,
      simulate: simulateOptions,
    })

    expect(result).toBe(sendResult)
    expect(composer.send).not.toHaveBeenCalled()
    expect(composer.simulate).toHaveBeenCalledTimes(1)
    expect(composer.simulate).toHaveBeenCalledWith(simulateOptions)
  })
})

describe('send group helper simulate', () => {
  // Test sendGroup helper for simulation.
  let assetManager: TransactionSignerAccount
  let writer: AsaMetadataRegistryWrite
  let boxReader: AlgodBoxReader
  let reader: AsaMetadataRegistryRead
  let assetId: bigint

  beforeEach(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    boxReader = new AlgodBoxReader(algorand.client.algod)
    reader = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
    assetManager = await createFundedAccount(fixture)
    assetId = await createArc89Asa({ assetManager, appClient: client })
  })

  test('simulate create metadata', async () => {
    // Test simulating a create metadata transaction group.
    const metadata = buildShortMetadata(assetId)
    await expect(reader.box.getAssetMetadataRecord({ assetId })).rejects.toThrow()

    const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
    // Any custom simulate options can go here
    const simulateOptions: SimulateOptions = {
      allowEmptySignatures: true,
      skipSignatures: true,
      allowUnnamedResources: true,
    }

    // Simulate
    const simulateResult = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      simulate: simulateOptions,
    })

    expect(simulateResult).not.toBeNull()
    expect(simulateResult.returns).toHaveLength(1)
    const mbrDelta = parseMbrDelta(simulateResult.returns[0])
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)

    await expect(reader.box.getAssetMetadataRecord({ assetId })).rejects.toThrow()
  })
})

// ================================================================
// AsaMetadataRegistryWrite Initialization Tests
// ================================================================

describe('writer initialization', () => {
  // Test AsaMetadataRegistryWrite constructor.
  test('init with client', () => {
    // Test successful initialization with client.
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    expect(writer.client).toBe(mockClient)
    expect(writer.params).toBeNull()
  })

  test('init with client and params', () => {
    // Test initialization with both client and params.
    const params = getDefaultRegistryParams()
    const writer = new AsaMetadataRegistryWrite({ client: mockClient, params })
    expect(writer.client).toBe(mockClient)
    expect(writer.params).toBe(params)
  })

  test('init with null client raises error', () => {
    // Test that initializing with null client raises MissingAppClientError.
    expect(() => new AsaMetadataRegistryWrite({ client: null as unknown as AsaMetadataRegistryClient })).toThrow(
      MissingAppClientError,
    )
  })

  test('_params returns cached params', async () => {
    // Test that _params() returns cached params if available.
    const params = getDefaultRegistryParams()
    const writer = new AsaMetadataRegistryWrite({ client: mockClient, params })
    const result = await (writer as any)._params()
    expect(result).toBe(params)
  })

  test('_params fetches from on-chain if not cached', async () => {
    // Test that _params() fetches from on-chain if not cached.
    const writer = new AsaMetadataRegistryWrite({ client })
    const result = await (writer as any)._params()
    expect(result).toBeInstanceOf(RegistryParameters)
    expect(result.headerSize).toBeGreaterThan(0)
  })
})

// ================================================================
// High-Level Send Method Tests
// ================================================================

describe('high-level send methods', () => {
  let assetManager: TransactionSignerAccount
  let writer: AsaMetadataRegistryWrite
  let boxReader: AlgodBoxReader
  let reader: AsaMetadataRegistryRead

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    boxReader = new AlgodBoxReader(algorand.client.algod)
    reader = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
    assetManager = await createFundedAccount(fixture)
  })

  describe('create metadata', () => {
    // Test createMetadata high-level method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('create metadata returns mbr delta', async () => {
      // Test creating metadata returns MbrDelta.
      const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Test', description: 'Test metadata' } })
      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })

    test('create empty metadata returns mbr delta', async () => {
      // Test creating empty metadata returns MbrDelta.
      const metadata = buildEmptyMetadata(assetId)
      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })

    test('create short metadata', async () => {
      // Test creating short metadata.
      const metadata = buildShortMetadata(assetId)
      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
      const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
      expect(boxValue).not.toBeNull()
    })

    test('create large metadata', async () => {
      // Test creating large metadata.
      const metadata = buildMaxedMetadata(assetId)
      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
      const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
      expect(boxValue).not.toBeNull()
    })

    test('create with custom send params', async () => {
      // Test creating metadata with custom SendParams.
      const metadata = buildShortMetadata(assetId)
      const mbrDelta = await writer.createMetadata({
        assetManager,
        metadata,
        sendParams: { coverAppCallInnerTransactionFees: false },
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      const boxValue = await reader.box.getAssetMetadataRecord({ assetId })
      expect(boxValue).not.toBeNull()
    })
  })

  describe('delete metadata', () => {
    // Test deleteMetadata high-level method.
    test('delete existing metadata', async () => {
      // Test deleting existing metadata.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const mbrDelta = await writer.deleteMetadata({ assetManager, assetId: metadata.assetId })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isNegative).toBe(true)
      // TODO: replace with reader when refactored
      await expect(client.state.box.assetMetadata.value(metadata.assetId)).rejects.toThrow()
    })
  })

  describe('set reversible flag', () => {
    // Test setReversibleFlag method.
    // Flag index validation (unit-testable, throws before chain interaction).
    test('rejects negative flag index', async () => {
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(
        writer.setReversibleFlag({ assetManager: account, assetId: 123, flagIndex: -1, value: true }),
      ).rejects.toThrow(InvalidFlagIndexError)
    })

    test('rejects flag index > 7', async () => {
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(
        writer.setReversibleFlag({ assetManager: account, assetId: 123, flagIndex: 8, value: true }),
      ).rejects.toThrow(InvalidFlagIndexError)
    })

    // On-chain tests.
    test('set reversible flag true', async () => {
      // Test setting a reversible flag to true.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await writer.setReversibleFlag({
        assetManager,
        assetId: metadata.assetId,
        flagIndex: flags.REV_FLG_ARC20,
        value: true,
      })
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.isArc20SmartAsa).toBe(true)
    })

    test('set reversible flag false', async () => {
      // Test setting a reversible flag to false.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      // First set to true
      await writer.setReversibleFlag({
        assetManager,
        assetId: metadata.assetId,
        flagIndex: flags.REV_FLG_ARC62,
        value: true,
      })

      let record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.isArc62CirculatingSupply).toBe(true)

      // Then set to false
      await writer.setReversibleFlag({
        assetManager,
        assetId: metadata.assetId,
        flagIndex: flags.REV_FLG_ARC62,
        value: false,
      })
      record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.isArc62CirculatingSupply).toBe(false)
    })
  })

  describe('set irreversible flag', () => {
    // Test setIrreversibleFlag method.

    // Flag index validation (unit-testable, throws before chain interaction).
    test('rejects creation-only indices (0, 1)', async () => {
      // Flags 0 (ARC3) and 1 (ARC89_NATIVE) are creation-only.
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(
        writer.setIrreversibleFlag({
          assetManager: account,
          assetId: 123,
          flagIndex: flags.IRR_FLG_ARC3,
        }),
      ).rejects.toThrow(InvalidFlagIndexError)

      await expect(
        writer.setIrreversibleFlag({
          assetManager: account,
          assetId: 123,
          flagIndex: flags.IRR_FLG_ARC89,
        }),
      ).rejects.toThrow(InvalidFlagIndexError)
    })

    test('rejects flag index > 7', async () => {
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(writer.setIrreversibleFlag({ assetManager: account, assetId: 123, flagIndex: 8 })).rejects.toThrow(
        InvalidFlagIndexError,
      )
    })

    // On-chain tests.
    test('set irreversible flag', async () => {
      // Test setting an irreversible flag.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await writer.setIrreversibleFlag({
        assetManager,
        assetId: metadata.assetId,
        flagIndex: flags.IRR_FLG_RESERVED_3,
      })
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.flags.irreversible.reserved3).toBe(true)
    })
  })

  describe('set immutable', () => {
    // Test setImmutable method.
    test('set immutable', async () => {
      // Test setting metadata as immutable.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await writer.setImmutable({ assetManager, assetId: metadata.assetId })
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.isImmutable).toBe(true)
    })
  })

  describe('edge cases', () => {
    // Test edge cases and error handling.
    test('create with large fee padding', async () => {
      // Test creating with large fee padding.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const options: WriteOptions = { ...writeOptionsDefault, feePaddingTxns: 10 }
      const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Large Fee Pad' } })
      const mbrDelta = await writer.createMetadata({ assetManager, metadata, options })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
    })

    test('create with extra resources', async () => {
      // Test creating with extra resources.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 3 }
      const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Extra Resources' } })
      const mbrDelta = await writer.createMetadata({ assetManager, metadata, options })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
    })
  })

  describe('integration workflows', () => {
    // Integration-style tests for complete workflows.
    test('create then delete workflow', async () => {
      // Test complete create -> delete workflow.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Will be deleted' } })

      // Create
      const createDelta = await writer.createMetadata({ assetManager, metadata })
      expect(createDelta.isPositive).toBe(true)

      // Delete
      const deleteDelta = await writer.deleteMetadata({ assetManager, assetId })
      expect(deleteDelta.isNegative).toBe(true)
    })

    test('create set flags workflow', async () => {
      // Test create -> set flags workflow.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Test flags' } })

      // Create
      await writer.createMetadata({ assetManager, metadata })

      // Set flags
      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.REV_FLG_ARC20,
        value: true,
      })
      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.REV_FLG_RESERVED_3,
        value: true,
      })
      await writer.setIrreversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.IRR_FLG_RESERVED_3,
      })

      // Verify both flags are set
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record.header.isArc20SmartAsa).toBe(true)
      expect(record.header.flags.reversible.arc20).toBe(true)
      expect(record.header.flags.irreversible.reserved3).toBe(true)
      expect(record.header.flags.reversible.reserved3).toBe(true)
    })
  })
})

// ================================================================
// Single Transaction Compose Simulation Tests
// ================================================================

describe('write single transaction simulation', () => {
  // Test direct composer.simulate() usage for single-transaction writer flows.
  let assetManager: TransactionSignerAccount
  let writer: AsaMetadataRegistryWrite
  let boxReader: AlgodBoxReader
  let reader: AsaMetadataRegistryRead
  let assetId: bigint

  beforeEach(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    boxReader = new AlgodBoxReader(algorand.client.algod)
    reader = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
    assetManager = await createFundedAccount(fixture)
    assetId = await createArc89Asa({ assetManager, appClient: client })
  })

  test('simulate set reversible flag single transaction', async () => {
    // Test simulating setReversibleFlag via direct composer.simulate().
    const metadata = buildShortMetadata(assetId)
    await uploadMetadata({ writer, assetManager, appClient: client, metadata })

    const before = await reader.box.getAssetMetadataRecord({ assetId })
    const suggestedParams = await client.algorand.getSuggestedParams()
    const composer = writer.client.newGroup()
    composer.arc89SetReversibleFlag({
      args: { assetId: metadata.assetId, flag: flags.REV_FLG_ARC20, value: true },
      sender: assetManager.addr,
      signer: assetManager.signer,
      staticFee: microAlgo(Number(suggestedParams.minFee)),
    })
    // Any custom simulate options can go here
    const simulateOptions: SimulateOptions = {
      allowEmptySignatures: true,
      skipSignatures: true,
      allowUnnamedResources: true,
    }
    const simulateResult = await composer.simulate(simulateOptions)

    expect(simulateResult).not.toBeNull()
    expect(simulateResult.simulateResponse).toBeDefined()
    expect(simulateResult.returns).toHaveLength(1)
    expect(simulateResult.returns[0]).toBeUndefined()

    const after = await reader.box.getAssetMetadataRecord({ assetId })
    expect(after).toEqual(before)
  })
})

// ================================================================
// Group Builder Tests
// ================================================================

describe('group builder methods', () => {
  let assetManager: TransactionSignerAccount
  let writer: AsaMetadataRegistryWrite

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    assetManager = await createFundedAccount(fixture)
  })

  describe('build create metadata group', () => {
    // Test buildCreateMetadataGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('build create empty metadata', async () => {
      // Test building create group for empty metadata.
      const metadata = buildEmptyMetadata(assetId)
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
      expect(composer).not.toBeNull()
    })

    test('build create short metadata', async () => {
      // Test building create group for short metadata.
      const metadata = buildShortMetadata(assetId)
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
      expect(composer).not.toBeNull()
    })

    test('build create with custom options', async () => {
      // Test building create group with custom WriteOptions.
      const metadata = buildShortMetadata(assetId)
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 2, feePaddingTxns: 1 }
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata, options })
      expect(composer).not.toBeNull()
    })

    test('build create large metadata', async () => {
      // Test building create group for large metadata (multiple chunks).
      const metadata = buildMaxedMetadata(assetId)
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
      expect(composer).not.toBeNull()
    })
  })

  describe('build replace metadata group', () => {
    // Test buildReplaceMetadataGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('build replace smaller metadata', async () => {
      // Test building replace group when new metadata is smaller/equal.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      // Replace with empty (smaller)
      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new Uint8Array(),
        validateJsonObject: false,
      })
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
      })
      expect(composer).not.toBeNull()
    })

    test('build replace larger metadata', async () => {
      // Test building replace group when new metadata is larger.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      // Replace with larger content
      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new Uint8Array(metadata.size + 1000).fill(120),
        validateJsonObject: false,
      })
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
      })
      expect(composer).not.toBeNull()
    })

    test('build replace auto detect size', async () => {
      // Test replace group auto-detects current size when not provided.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new TextEncoder().encode('new'),
        validateJsonObject: false,
      })
      // Don't pass assumeCurrentSize, should fetch from chain
      const composer = await writer.buildReplaceMetadataGroup({ assetManager, metadata: newMetadata })
      expect(composer).not.toBeNull()
    })

    test('build replace with options', async () => {
      // Test building replace group with custom options.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new TextEncoder().encode('updated'),
        validateJsonObject: false,
      })
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 2, feePaddingTxns: 1 }
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
        options,
      })
      expect(composer).not.toBeNull()
    })
  })

  describe('build replace metadata slice group', () => {
    // Test buildReplaceMetadataSliceGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('build slice small payload', async () => {
      // Test building slice group with small payload (single chunk).
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId,
        offset: 0,
        payload: new TextEncoder().encode('slice'),
      })
      expect(composer).not.toBeNull()
    })

    test('build slice large payload', async () => {
      // Test building slice group with large payload (multiple chunks).
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      // Create payload larger than replacePayloadMaxSize
      const params = getDefaultRegistryParams()
      const largePayload = new Uint8Array(params.replacePayloadMaxSize * 2 + 100).fill(120)
      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId: metadata.assetId,
        offset: 0,
        payload: largePayload,
      })
      expect(composer).not.toBeNull()
    })

    test('build slice with options', async () => {
      // Test building slice group with custom options.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 3 }
      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId: metadata.assetId,
        offset: 0,
        payload: new TextEncoder().encode('updated slice'),
        options,
      })
      expect(composer).not.toBeNull()
    })
  })

  describe('build delete metadata group', () => {
    // Test buildDeleteMetadataGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('build delete', async () => {
      // Test building delete group.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId })
      expect(composer).not.toBeNull()
    })

    test('build delete with options', async () => {
      // Test building delete group with custom options.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 1, feePaddingTxns: 2 }
      const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId, options })
      expect(composer).not.toBeNull()
    })
  })
})

// ================================================================
// High-Level Send Method Tests (Replace)
// ================================================================

describe('high-level replace methods', () => {
  let assetManager: TransactionSignerAccount
  let writer: AsaMetadataRegistryWrite
  let boxReader: AlgodBoxReader
  let reader: AsaMetadataRegistryRead

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    boxReader = new AlgodBoxReader(algorand.client.algod)
    reader = new AsaMetadataRegistryRead({ appId: client.appId, algod: boxReader })
    assetManager = await createFundedAccount(fixture)
  })

  describe('replace metadata', () => {
    // Test replaceMetadata high-level method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('replace with smaller metadata', async () => {
      // Test replacing with smaller metadata.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new TextEncoder().encode('small'),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      // Should be negative or zero since smaller
      expect(mbrDelta.isNegative || mbrDelta.isZero).toBe(true)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.body.rawBytes).toEqual(new TextEncoder().encode('small'))
      expect(record.body.size).toBe(5)
    })

    test('replace with larger metadata', async () => {
      // Test replacing with larger metadata.
      const metadata = buildEmptyMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new Uint8Array(1000).fill(120),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: 0,
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.body.size).toBe(1000)
      expect(record.body.rawBytes).toEqual(new Uint8Array(1000).fill(120))
    })

    test('replace auto detect current size', async () => {
      // Test replace auto-detects current size.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      const newMetadata = AssetMetadata.fromBytes({
        assetId: metadata.assetId,
        metadataBytes: new TextEncoder().encode('replacement'),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({ assetManager, metadata: newMetadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.body.rawBytes).toEqual(new TextEncoder().encode('replacement'))
    })
  })

  describe('replace metadata slice', () => {
    // Test replaceMetadataSlice high-level method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
    })

    test('replace slice', async () => {
      // Test replacing a slice of metadata.
      const metadata = buildShortMetadata(assetId)
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await writer.replaceMetadataSlice({
        assetManager,
        assetId,
        offset: 0,
        payload: new TextEncoder().encode('patch'),
      })
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      // Verify the slice was written at offset 0
      const body = record.body.rawBytes
      expect(new TextDecoder().decode(body.slice(0, 5))).toBe('patch')
    })
  })
})
