/**
 * Extensive tests for src/write/writer module.
 *
 * Tests cover:
 * - WriteOptions configuration
 * - AsaMetadataRegistryWrite initialization and validation
 * - Group building methods (group composition and pooled fees)
 * - High-level send methods (e.g., createMetadata, replaceMetadata)
 * - Flag management methods
 * - Utility methods
 * - Fee pooling and padding (opcode budget, Box I/O resources, app args surcharge)
 * - Extra resources handling
 * - Error handling and edge cases
 */

import { describe, expect, test, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { Address, TransactionType, getApplicationAddress, modelsv2, type TransactionSigner } from 'algosdk'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { microAlgo, type AlgorandClient } from '@algorandfoundation/algokit-utils'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import {
  ARC3_NAME_SUFFIX,
  AsaNotFoundError,
  DEFAULT_SIMULATE_OPTIONS,
  InvalidArc3PropertiesError,
  InvalidFlagIndexError,
  MAX_BOX_SIZE,
  MAX_METADATA_SIZE,
  MAX_PAGES,
  MetadataArc3Error,
  MissingAppClientError,
  getDefaultRegistryParams,
  RegistryParameters,
  flags,
  AssetMetadata,
  AssetMetadataBox,
  MbrDelta,
  AsaMetadataRegistryRead,
  AlgodBoxReader,
  MetadataFlags,
  ReversibleFlags,
  IrreversibleFlags,
  // writer
  AsaMetadataRegistryWrite,
  type SimulateOptions,
  type WriteOptions,
  writeOptionsDefault,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import type {
  AsaMetadataRegistryClient,
  AsaMetadataRegistryComposer,
  AsaMetadataRegistryComposerResults,
  AsaMetadataRegistryFactory,
} from '@/generated'
import { parseMbrDelta } from '@/internal/avm'
import * as validation from '@/validation'
import {
  ARC89_CREATE_METADATA_FIXED_SIZE,
  ARC89_EXTRA_PAYLOAD_FIXED_SIZE,
  ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE,
  appArgsSurchargeFee,
  appendExtraResources,
  boxIoExtraResources,
  chunksForSlice,
  hashBudgetTxns,
  tailBudgetTxns,
} from '@/internal/writer'
import {
  ARC90_NETAUTH,
  type AddressWithSigners,
  deployRegistry,
  getDeployer,
  createFactory,
  createFundedAccount,
  createArc89Asa,
  buildEmptyMetadata,
  buildShortMetadata,
  buildMaxedMetadata,
  uploadMetadata,
  createArc3Asa,
  createArc3Payload,
} from './helpers'

const encode = (s: string): Uint8Array => new TextEncoder().encode(s)

// ================================================================
// Mocks
// ================================================================

const createMockAppClient = (): AsaMetadataRegistryClient => {
  return {
    appId: 12345n,
    appAddress: getApplicationAddress(12345n),
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
// Group composition helpers
// ================================================================

const PAY = TransactionType.pay
const CREATE = 'arc89_create_metadata'
const REPLACE = 'arc89_replace_metadata'
const REPLACE_LARGER = 'arc89_replace_metadata_larger'
const REPLACE_SLICE = 'arc89_replace_metadata_slice'
const DELETE = 'arc89_delete_metadata'
const EXTRA_PAYLOAD = 'arc89_extra_payload'
const EXTRA_RESOURCES = 'extra_resources'

const repeat = <T>(count: number, value: T): T[] => Array.from({ length: count }, () => value)

/**
 * Build (without sending) a writer group and assert its composition: the transaction sequence (ABI
 * method name, or transaction type) and the fee pool, pooled on the first app call (all others are fee-less).
 */
const expectGroup = async (
  composer: AsaMetadataRegistryComposer,
  expected: { txns: readonly string[]; feePool: number },
) => {
  const { transactions, methodCalls } = await (await composer.composer()).buildTransactions()
  expect(transactions.map((txn, i) => methodCalls.get(i)?.name ?? txn.type)).toEqual(expected.txns)
  const head = transactions.findIndex((txn) => txn.type === TransactionType.appl)
  expect(transactions.map((txn) => txn.fee)).toEqual(
    transactions.map((_, i) => (i === head ? BigInt(expected.feePool) : 0n)),
  )
  return transactions
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
let deployer: AddressWithSigners

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

afterEach(() => {
  vi.restoreAllMocks()
})

/** Box reader bound to the test registry (Python `reader_with_algod`). */
const createReader = (): AsaMetadataRegistryRead =>
  new AsaMetadataRegistryRead({
    appId: client.appId,
    algod: new AlgodBoxReader(algorand.client.algod),
    netauth: ARC90_NETAUTH,
  })

/** Read and parse the metadata box via the generated client (throws if the box does not exist). */
const getMetadataBox = async (assetId: bigint): Promise<AssetMetadataBox> => {
  const value = await client.state.box.assetMetadata.value(assetId)
  expect(value).toBeDefined()
  return AssetMetadataBox.parse({ assetId, value: value! })
}

/** Create an ARC-3 ASA (`@arc3` name suffix). ARC-20 also requires DefaultFrozen and a Clawback address. */
const createArc3TestAsa = async (args: {
  assetManager: AddressWithSigners
  defaultFrozen?: boolean
  clawback?: Address
}): Promise<bigint> => {
  const result = await algorand.send.assetCreate({
    sender: args.assetManager.addr,
    manager: args.assetManager.addr,
    total: 42n,
    assetName: `ARC3 Test${new TextDecoder().decode(ARC3_NAME_SUFFIX)}`,
    defaultFrozen: args.defaultFrozen ?? false,
    clawback: args.clawback,
  })
  return result.assetId
}

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
    const payload = encode('slice')
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
    // Test that invalid max size raises RangeError.
    const payload = encode('test')
    expect(() => chunksForSlice(payload, 0)).toThrow(new RangeError('maxSize must be > 0'))
    expect(() => chunksForSlice(payload, -1)).toThrow(new RangeError('maxSize must be > 0'))
  })

  test('app args surcharge fee', () => {
    // Test exact pooled fee rounding for oversized application arguments.
    expect(appArgsSurchargeFee(1000, [2048])).toBe(0)
    expect(appArgsSurchargeFee(1000, [4112])).toBe(207)
    expect(appArgsSurchargeFee(1000, [4112, 4108])).toBe(413)
  })
})

describe('resource sizing helpers', () => {
  // Tests for the fee pool and resource sizing helpers (Python private helpers, reference values).
  test('app call fixed sizes', () => {
    // Aggregate encoded size of the non-payload arguments (method selector and payload length prefix included).
    expect(ARC89_CREATE_METADATA_FIXED_SIZE).toBe(18)
    expect(ARC89_EXTRA_PAYLOAD_FIXED_SIZE).toBe(14)
    expect(ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE).toBe(16)
  })

  test('box io extra resources', () => {
    // The head call covers 7 box references (one slot is spent on the asset), every other app call 8.
    expect(boxIoExtraResources(0)).toBe(0)
    expect(boxIoExtraResources(7 * 2048)).toBe(0)
    expect(boxIoExtraResources(7 * 2048 + 1)).toBe(1)
    expect(boxIoExtraResources(15 * 2048)).toBe(1)
    expect(boxIoExtraResources(15 * 2048 + 1)).toBe(2)
    expect(boxIoExtraResources(MAX_BOX_SIZE)).toBe(2)
    // Other app calls in the group (extra payloads, extra resources) already add box references.
    expect(boxIoExtraResources(MAX_BOX_SIZE, 1)).toBe(1)
    expect(boxIoExtraResources(MAX_BOX_SIZE, 2)).toBe(0)
    expect(boxIoExtraResources(MAX_BOX_SIZE, 7)).toBe(0)
  })

  test('hash budget txns', () => {
    // Metadata Hash opcode budget: the first inner transaction at two pages, then one every five pages.
    expect([0, 1, 2, 6, 7, 11, 12, MAX_PAGES].map((pages) => hashBudgetTxns(pages))).toEqual([0, 0, 1, 1, 2, 2, 3, 7])
  })

  test('tail budget txns', () => {
    // Opcode budget reserved by the head call for the calls after it (none without trailing calls).
    expect([0, 1, 4, 5, 9, 10, 14].map((calls) => tailBudgetTxns(calls))).toEqual([0, 1, 1, 2, 2, 3, 4])
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

// ================================================================
// Send Group Helper Tests
// ================================================================

describe('send group helper', () => {
  // Test sendGroup helper behavior (mocked).
  let composer: AsaMetadataRegistryComposer<unknown[]>
  let sendResult: AsaMetadataRegistryComposerResults<unknown[]>

  beforeEach(() => {
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
      execTraceConfig: new modelsv2.SimulateTraceConfig({ enable: true }),
      round: 999n,
      skipSignatures: false,
    }

    const result = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      sendParams: { coverAppCallInnerTransactionFees: false, populateAppCallResources: false },
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
  test('send group simulate', async () => {
    // Test simulating a create metadata transaction group.
    const writer = new AsaMetadataRegistryWrite({ client })
    const assetManager = await createFundedAccount(fixture)
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    const metadata = buildShortMetadata(assetId)

    const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
    const simulate: SimulateOptions = { ...DEFAULT_SIMULATE_OPTIONS } // Any custom options can go here
    const simulateResult = await AsaMetadataRegistryWrite.sendGroup({
      composer,
      sendParams: null,
      options: null,
      simulate,
    })

    expect(simulateResult).toBeDefined()
    // arc89_create_metadata + the extra_resources call appended for non-empty metadata
    expect(simulateResult.returns).toHaveLength(2)

    // Example of inspecting a return value from simulate
    const mbrDelta = parseMbrDelta(simulateResult.returns[0])
    expect(mbrDelta).toBeInstanceOf(MbrDelta)
    expect(mbrDelta.isPositive).toBe(true)

    // Simulate must not persist metadata
    await expect(client.state.box.assetMetadata.value(assetId)).rejects.toThrow(/box not found/)
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
    const result = await writer['_params']()
    expect(result).toBe(params)
  })

  test('_params fetches from on-chain if not cached', async () => {
    // Test that _params() fetches from on-chain if not cached.
    const writer = new AsaMetadataRegistryWrite({ client })
    const result = await writer['_params']()
    // Should fetch from chain
    expect(result).toBeInstanceOf(RegistryParameters)
    expect(result.headerSize).toBeGreaterThan(0)
  })

  test('_params propagates on-chain read errors', async () => {
    // As in Python, a failing on-chain read is not masked by the compiled defaults.
    const composer = { arc89GetMetadataRegistryParameters: vi.fn(), simulate: vi.fn() }
    composer.simulate.mockRejectedValue(new Error('simulate failed'))
    vi.mocked(mockClient.newGroup).mockReturnValue(composer as never)
    const writer = new AsaMetadataRegistryWrite({ client: mockClient })
    await expect(writer['_params']()).rejects.toThrow('simulate failed')
  })
})

// ================================================================
// High-Level Send Method Tests
// ================================================================

describe('high-level send methods', () => {
  let assetManager: AddressWithSigners
  let writer: AsaMetadataRegistryWrite
  let reader: AsaMetadataRegistryRead

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    reader = createReader()
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
      // Verify metadata was created
      const box = await getMetadataBox(assetId)
      expect(box.body.rawBytes).toEqual(metadata.body.rawBytes)
    })

    test('create large metadata', async () => {
      // Test creating large metadata.
      const metadata = buildMaxedMetadata(assetId)
      const mbrDelta = await writer.createMetadata({ assetManager, metadata, validateArc3: false })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record.body.size).toBe(MAX_METADATA_SIZE)
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
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
    })

    test('create validate arc3 raises asa not found', async () => {
      // createMetadata should raise AsaNotFoundError when validateArc3=true and the ASA doesn't exist.
      // Destroy the ASA so on-chain lookup fails during ARC-3 validation.
      await algorand.send.assetDestroy({ sender: assetManager.addr, assetId })

      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Missing ASA', decimals: 0 },
      })

      const result = writer.createMetadata({ assetManager, metadata, validateArc3: true })
      await expect(result).rejects.toThrow(AsaNotFoundError)
      await expect(result).rejects.toThrow(`Asset ${assetId} does not exist`)
    })

    test('create validate arc3 fails invalid decimals', async () => {
      // createMetadata should raise MetadataArc3Error when validateArc3=true and decimals don't match.
      // The ARC-89 ASA has decimals=0, but metadata says decimals=6
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Wrong Decimals', decimals: 6 },
      })

      const result = writer.createMetadata({ assetManager, metadata, validateArc3: true })
      await expect(result).rejects.toThrow(MetadataArc3Error)
      await expect(result).rejects.toThrow(/ARC-3 field 'decimals' must match ASA decimals \(0\), got 6/)
    })
  })

  describe('create metadata arc3 compliant', () => {
    // Test createMetadata validation for declared ARC-3 compliant ASAs.

    test('arc3 decimals validation skipped when decimals missing', async () => {
      // If 'decimals' isn't present in JSON, writer must not fetch ASA params or validate decimals.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const validateSpy = vi.spyOn(validation, 'validateArc3Values')
      // If decimals validation were attempted, this on-chain API would be called.
      const getByIdSpy = vi.spyOn(writer.client.algorand.asset, 'getById')

      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'No Decimals', description: 'Should skip decimals validation' },
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata, validateArc3: true })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(validateSpy).not.toHaveBeenCalled()
      expect(getByIdSpy).not.toHaveBeenCalled()
    })

    test('arc3 decimals zero triggers decimals validation', async () => {
      // When 'decimals' is explicitly set to 0, writer must fetch ASA params and run decimals validation
      // under validateArc3=true (the ASA has decimals=0, so the validation passes).
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const validateSpy = vi.spyOn(validation, 'validateArc3Values')
      const getByIdSpy = vi.spyOn(writer.client.algorand.asset, 'getById')

      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Zero Decimals', description: 'Should trigger decimals validation', decimals: 0 },
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata, validateArc3: true })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      // Writer must fetch ASA params and invoke ARC-3 validation.
      expect(getByIdSpy).toHaveBeenCalledOnce()
      expect(validateSpy).toHaveBeenCalledOnce()
    })

    test('invalid properties no rev flags creates metadata', async () => {
      // Test that arc3 flag without arc20/arc62 reversible flags skips properties validation.
      const assetId = await createArc3Asa({ assetManager, appClient: client })
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: createArc3Payload({ name: 'ARC3 Compliant Test', properties: {} }),
        flags: new MetadataFlags({
          reversible: new ReversibleFlags(),
          irreversible: new IrreversibleFlags({ arc3: true }),
        }),
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })

    test.each([
      { id: 'arc20', revFlag: new ReversibleFlags({ arc20: true }) },
      { id: 'arc62', revFlag: new ReversibleFlags({ arc62: true }) },
    ])('no arc3 flag skips validation ($id)', async ({ revFlag }) => {
      // Test that arc20/arc62 reversible flags without arc3 flag skip properties validation.
      // ARC-20 still requires the ASA-level conditions (DefaultFrozen, Clawback)
      const assetId = await createArc3TestAsa({
        assetManager,
        defaultFrozen: revFlag.arc20,
        clawback: revFlag.arc20 ? assetManager.addr : undefined,
      })
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: createArc3Payload({ name: 'ARC3 Compliant Test', properties: {} }),
        flags: new MetadataFlags({
          reversible: revFlag,
          irreversible: new IrreversibleFlags({ arc3: false }),
        }),
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })

    test('both flags valid properties creates metadata', async () => {
      // Test that both arc20+arc62 flags with valid properties creates metadata successfully.
      const assetId = await createArc3TestAsa({
        assetManager,
        defaultFrozen: true,
        clawback: getApplicationAddress(123456),
      })
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: createArc3Payload({
          name: 'ARC3 Compliant Test',
          properties: {
            'arc-20': { 'application-id': 123456 },
            'arc-62': { 'application-id': 654321 },
          },
        }),
        flags: new MetadataFlags({
          reversible: new ReversibleFlags({ arc20: true, arc62: true }),
          irreversible: new IrreversibleFlags({ arc3: true }),
        }),
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })

    test.each([
      { id: 'arc20', flagIndex: flags.REV_FLG_ARC20 },
      { id: 'arc62', flagIndex: flags.REV_FLG_ARC62 },
    ])('valid properties creates metadata ($id)', async ({ flagIndex }) => {
      // Test that valid properties with arc3 + arc20/arc62 flags creates metadata successfully.
      const isArc20 = flagIndex === flags.REV_FLG_ARC20
      const assetId = await createArc3TestAsa({
        assetManager,
        defaultFrozen: isArc20,
        clawback: isArc20 ? getApplicationAddress(123456) : undefined,
      })

      const arcKey = isArc20 ? 'arc-20' : 'arc-62'
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: createArc3Payload({
          name: 'ARC3 Compliant Test',
          properties: { [arcKey]: { 'application-id': 123456 } },
        }),
        flags: new MetadataFlags({
          reversible: new ReversibleFlags({
            arc20: flagIndex === flags.REV_FLG_ARC20,
            arc62: flagIndex === flags.REV_FLG_ARC62,
          }),
          irreversible: new IrreversibleFlags({ arc3: true }),
        }),
      })

      const mbrDelta = await writer.createMetadata({ assetManager, metadata })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
    })
  })

  describe('delete metadata', () => {
    // Test deleteMetadata high-level method.
    test('delete existing metadata', async () => {
      // Test deleting existing metadata.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      const metadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })

      const mbrDelta = await writer.deleteMetadata({ assetManager, assetId: metadata.assetId })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isNegative).toBe(true)
      // Verify deletion
      await expect(client.state.box.assetMetadata.value(metadata.assetId)).rejects.toThrow(/box not found/)
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

    test('fail invalid flag index', async () => {
      // Test that an out-of-range flag index raises InvalidFlagIndexError.
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(
        writer.setReversibleFlag({
          assetManager: account,
          assetId: 123,
          flagIndex: flags.REV_FLG_RESERVED_7 + 1,
          value: true,
        }),
      ).rejects.toThrow(InvalidFlagIndexError)
    })

    // On-chain tests.
    test('set reversible flag true', async () => {
      // Test setting a reversible flag to true.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.REV_FLG_NTT,
        value: true,
      })
      // Verify flag was set
      const updated = await getMetadataBox(assetId)
      expect(updated.header.flags.reversible.ntt).toBe(true)
    })

    test('set reversible flag false', async () => {
      // Test setting a reversible flag to false.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      // First set to true
      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.REV_FLG_ARC62,
        value: true,
      })
      expect((await getMetadataBox(assetId)).header.isArc62CirculatingSupply).toBe(true)

      // Then set to false
      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.REV_FLG_ARC62,
        value: false,
      })
      const updated = await getMetadataBox(assetId)
      expect(updated.header.isArc62CirculatingSupply).toBe(false)
    })

    test.each([
      { id: 'arc20', flagIndex: flags.REV_FLG_ARC20 },
      { id: 'arc62', flagIndex: flags.REV_FLG_ARC62 },
    ])('fail arc3 invalid properties ($id)', async ({ flagIndex }) => {
      // Test that missing properties with arc3 + arc20/arc62 flags raises InvalidArc3PropertiesError.
      const arc3AssetId = await createArc3Asa({ assetManager, appClient: client })
      const metadata = AssetMetadata.fromJson({
        assetId: arc3AssetId,
        jsonObj: createArc3Payload({ name: 'ARC3 Test', properties: {} }),
        flags: new MetadataFlags({
          reversible: ReversibleFlags.empty(),
          irreversible: new IrreversibleFlags({ arc3: true }),
        }),
      })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await expect(
        writer.setReversibleFlag({
          assetManager,
          assetId: arc3AssetId,
          flagIndex,
          value: true,
        }),
      ).rejects.toThrow(InvalidArc3PropertiesError)
    })

    test.each([
      { id: 'arc20', flagIndex: flags.REV_FLG_ARC20, arcKey: 'arc-20' },
      { id: 'arc62', flagIndex: flags.REV_FLG_ARC62, arcKey: 'arc-62' },
    ])('arc3 valid properties sets flag ($id)', async ({ flagIndex, arcKey }) => {
      // Test that valid properties with arc3 + arc20/arc62 flags sets the flag successfully.
      const appId = 123456
      // ARC-20 also requires DefaultFrozen and the controlling App account as Clawback
      const isArc20 = flagIndex === flags.REV_FLG_ARC20
      const assetId = await createArc3TestAsa({
        assetManager,
        defaultFrozen: isArc20,
        clawback: isArc20 ? getApplicationAddress(appId) : undefined,
      })
      const metadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: createArc3Payload({ name: 'ARC3 Test', properties: { [arcKey]: { 'application-id': appId } } }),
        flags: new MetadataFlags({
          reversible: ReversibleFlags.empty(),
          irreversible: new IrreversibleFlags({ arc3: true }),
        }),
      })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata })

      await writer.setReversibleFlag({
        assetManager,
        assetId,
        flagIndex,
        value: true,
      })

      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      expect(record.header.flags.reversible.arc20).toBe(flagIndex === flags.REV_FLG_ARC20)
      expect(record.header.flags.reversible.arc62).toBe(flagIndex === flags.REV_FLG_ARC62)
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

    test('rejects immutable flag index (7)', async () => {
      // Flag 7 (IMMUTABLE) is reserved to setImmutable.
      const writer = new AsaMetadataRegistryWrite({ client: mockClient })
      const account = createMockSigningAccount()

      await expect(
        writer.setIrreversibleFlag({ assetManager: account, assetId: 123, flagIndex: flags.IRR_FLG_IMMUTABLE }),
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
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      await writer.setIrreversibleFlag({
        assetManager,
        assetId,
        flagIndex: flags.IRR_FLG_RESERVED_3,
      })
      // Verify flag was set
      const updated = await getMetadataBox(assetId)
      expect(updated.header.flags.irreversible.reserved3).toBe(true)
    })
  })

  describe('set immutable', () => {
    // Test setImmutable method.
    test('set immutable', async () => {
      // Test setting metadata as immutable.
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      await writer.setImmutable({ assetManager, assetId })
      // Verify immutable flag was set
      const updated = await getMetadataBox(assetId)
      expect(updated.header.isImmutable).toBe(true)
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
        flagIndex: flags.REV_FLG_ARC62,
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

      // Verify all flags are set
      const result = await getMetadataBox(assetId)
      expect(result.header.isArc62CirculatingSupply).toBe(true)
      expect(result.header.flags.reversible.arc62).toBe(true)
      expect(result.header.flags.reversible.reserved3).toBe(true)
      expect(result.header.flags.irreversible.reserved3).toBe(true)
    })
  })
})

// ================================================================
// Single Transaction Compose Simulation Tests
// ================================================================

describe('write single transaction simulation', () => {
  // Test direct composer.simulate() for single-transaction writer methods.
  test('simulate set reversible flag single transaction', async () => {
    // Test simulating setReversibleFlag via direct composer.
    const writer = new AsaMetadataRegistryWrite({ client })
    const reader = createReader()
    const assetManager = await createFundedAccount(fixture)
    const assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })
    const minFee = (await client.algorand.getSuggestedParams()).minFee

    const before = await reader.box.getAssetMetadataRecord({ assetId })

    const composer = writer.client.newGroup()
    composer.arc89SetReversibleFlag({
      args: { assetId, flag: flags.REV_FLG_NTT, value: true },
      sender: assetManager.addr,
      signer: assetManager.signer,
      staticFee: microAlgo(minFee),
    })

    const simulate: SimulateOptions = { ...DEFAULT_SIMULATE_OPTIONS } // Any custom options can go here
    const simulateResult = await composer.simulate(simulate)

    expect(simulateResult).toBeDefined()
    expect(simulateResult.simulateResponse).toBeDefined()
    expect(simulateResult.returns).toHaveLength(1)
    // void method: no return value (a decode error would throw)
    expect(simulateResult.returns[0]).toBeUndefined()
    const after = await reader.box.getAssetMetadataRecord({ assetId })
    expect(after).toEqual(before)
  })
})

// ================================================================
// Group Builder Tests
// ================================================================

describe('group builder methods', () => {
  // Builder tests also assert the group composition and the pooled fee (Python v1.0.0 reference values).
  let assetManager: AddressWithSigners
  let writer: AsaMetadataRegistryWrite
  let minFee: number

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    assetManager = await createFundedAccount(fixture)
    minFee = Number((await algorand.getSuggestedParams()).minFee)
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
      expect(composer).toBeDefined()
      // MBR payment + head call, no opcode budget nor extra resources for empty metadata
      await expectGroup(composer, { txns: [PAY, CREATE], feePool: 2 * minFee })
    })

    test('build create short metadata', async () => {
      // Test building create group for short metadata.
      const metadata = buildShortMetadata(assetId)
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
      expect(composer).toBeDefined()
      // + the extra_resources call appended for non-empty metadata, opcode budget in the fee pool
      await expectGroup(composer, { txns: [PAY, CREATE, EXTRA_RESOURCES], feePool: 4 * minFee })
    })

    test('build create with custom options', async () => {
      // Test building create group with custom WriteOptions.
      const metadata = buildShortMetadata(assetId)
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 2, feePaddingTxns: 1 }
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata, options })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [PAY, CREATE, ...repeat(3, EXTRA_RESOURCES)], feePool: 7 * minFee })
    })

    test('build create large metadata', async () => {
      // Test building create group for large metadata (multiple chunks).
      const metadata = buildMaxedMetadata(assetId)
      const composer = await writer.buildCreateMetadataGroup({ assetManager, metadata })
      expect(composer).toBeDefined()
      // 8 payload chunks (4,094 bytes, the last one 4,059), opcode budget (ARC-89 native Asset URL check
      // included) and the app args surcharge (arguments above 2,048 bytes)
      const surcharge = appArgsSurchargeFee(minFee, [4112, ...repeat(6, 4108), 4073])
      await expectGroup(composer, {
        txns: [PAY, CREATE, ...repeat(7, EXTRA_PAYLOAD), EXTRA_RESOURCES],
        feePool: 13 * minFee + surcharge,
      })
    })
  })

  describe('build replace metadata group', () => {
    // Test buildReplaceMetadataGroup method.
    let mutableShortMetadata: AssetMetadata

    beforeEach(async () => {
      const assetId = await createArc89Asa({ assetManager, appClient: client })
      mutableShortMetadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })
    })

    test('build replace smaller metadata', async () => {
      // Test building replace group when new metadata is smaller/equal.
      // Replace with empty (smaller)
      const newMetadata = AssetMetadata.fromBytes({
        assetId: mutableShortMetadata.assetId,
        metadataBytes: new Uint8Array(),
        validateJsonObject: false,
      })
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: mutableShortMetadata.size,
      })
      expect(composer).toBeDefined()
      // Head call + MBR refund inner payment
      await expectGroup(composer, { txns: [REPLACE], feePool: 2 * minFee })
    })

    test('build replace larger metadata', async () => {
      // Test building replace group when new metadata is larger.
      // Replace with larger content
      const newMetadata = AssetMetadata.fromBytes({
        assetId: mutableShortMetadata.assetId,
        metadataBytes: new Uint8Array(mutableShortMetadata.size + 1000).fill(0x78),
        validateJsonObject: false,
      })
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: mutableShortMetadata.size,
      })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [PAY, REPLACE_LARGER, EXTRA_RESOURCES], feePool: 5 * minFee })
    })

    test('build replace auto detect size', async () => {
      // Test replace group auto-detects current size when not provided.
      const newMetadata = AssetMetadata.fromBytes({
        assetId: mutableShortMetadata.assetId,
        metadataBytes: encode('new'),
        validateJsonObject: false,
      })
      // Don't pass assumeCurrentSize, should fetch from chain
      const composer = await writer.buildReplaceMetadataGroup({ assetManager, metadata: newMetadata })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [REPLACE, EXTRA_RESOURCES], feePool: 5 * minFee })
    })

    test('build replace with options', async () => {
      // Test building replace group with custom options.
      const newMetadata = AssetMetadata.fromBytes({
        assetId: mutableShortMetadata.assetId,
        metadataBytes: encode('updated'),
        validateJsonObject: false,
      })
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 2, feePaddingTxns: 1 }
      const composer = await writer.buildReplaceMetadataGroup({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: mutableShortMetadata.size,
        options,
      })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [REPLACE, ...repeat(3, EXTRA_RESOURCES)], feePool: 8 * minFee })
    })
  })

  describe('build replace metadata slice group', () => {
    // Test buildReplaceMetadataSliceGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })
    })

    test('build slice small payload', async () => {
      // Test building slice group with small payload (single chunk).
      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId,
        offset: 0,
        payload: encode('slice'),
      })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [REPLACE_SLICE], feePool: minFee })
    })

    test('build slice large payload', async () => {
      // Test building slice group with large payload (multiple chunks).
      const params = await writer['_params']()
      // Create payload larger than replacePayloadMaxSize
      const largePayload = new Uint8Array(params.replacePayloadMaxSize * 2 + 100).fill(0x78)
      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId,
        offset: 10,
        payload: largePayload,
      })
      expect(composer).toBeDefined()
      // Every slice call recomputes the Metadata Hash: its opcode budget is pooled once per slice call
      const surcharge = appArgsSurchargeFee(minFee, [4110, 4110, 116])
      const txns = await expectGroup(composer, { txns: repeat(3, REPLACE_SLICE), feePool: 6 * minFee + surcharge })
      // Each chunk is written at its own offset
      const offsets = txns.map((txn) => {
        const offset = txn.applicationCall!.appArgs[2]!
        return (offset[0]! << 8) | offset[1]!
      })
      expect(offsets).toEqual([10, 10 + params.replacePayloadMaxSize, 10 + 2 * params.replacePayloadMaxSize])
    })

    test('build slice with options', async () => {
      // Test building slice group with custom options.
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 3 }
      const composer = await writer.buildReplaceMetadataSliceGroup({
        assetManager,
        assetId,
        offset: 0,
        payload: encode('updated slice'),
        options,
      })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [REPLACE_SLICE, ...repeat(3, EXTRA_RESOURCES)], feePool: 5 * minFee })
    })
  })

  describe('build delete metadata group', () => {
    // Test buildDeleteMetadataGroup method.
    let assetId: bigint

    beforeEach(async () => {
      assetId = await createArc89Asa({ assetManager, appClient: client })
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })
    })

    test('build delete', async () => {
      // Test building delete group.
      const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId })
      expect(composer).toBeDefined()
      // Head call + MBR refund inner payment
      await expectGroup(composer, { txns: [DELETE], feePool: 2 * minFee })
    })

    test('build delete with options', async () => {
      // Test building delete group with custom options.
      const options: WriteOptions = { ...writeOptionsDefault, extraResources: 1, feePaddingTxns: 2 }
      const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId, options })
      expect(composer).toBeDefined()
      await expectGroup(composer, { txns: [DELETE, EXTRA_RESOURCES], feePool: 5 * minFee })
    })
  })
})

// ================================================================
// High-Level Send Method Tests (Replace)
// ================================================================

describe('high-level replace methods', () => {
  let assetManager: AddressWithSigners
  let writer: AsaMetadataRegistryWrite
  let reader: AsaMetadataRegistryRead

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    reader = createReader()
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
      const metadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })

      const newMetadata = AssetMetadata.fromBytes({
        assetId,
        metadataBytes: encode('small'),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
        validateArc3: false,
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      // Should be negative or zero since smaller
      expect(mbrDelta.isNegative || mbrDelta.isZero).toBe(true)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record.body.rawBytes).toEqual(encode('small'))
      expect(record.body.size).toBe(5)
    })

    test('replace with larger metadata', async () => {
      // Test replacing with larger metadata.
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildEmptyMetadata(assetId) })

      const newMetadata = AssetMetadata.fromBytes({
        assetId,
        metadataBytes: new Uint8Array(1000).fill(0x78),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: 0,
        validateArc3: false,
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(mbrDelta.isPositive).toBe(true)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record.body.size).toBe(1000)
      expect(record.body.rawBytes).toEqual(new Uint8Array(1000).fill(0x78))
    })

    test('replace auto detect current size', async () => {
      // Test replace auto-detects current size.
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      const newMetadata = AssetMetadata.fromBytes({
        assetId,
        metadataBytes: encode('replacement'),
        validateJsonObject: false,
      })
      const mbrDelta = await writer.replaceMetadata({ assetManager, metadata: newMetadata, validateArc3: false })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record.body.rawBytes).toEqual(encode('replacement'))
    })

    test('arc3 decimals zero triggers decimals validation', async () => {
      // When 'decimals' is explicitly 0, replaceMetadata must still validate under validateArc3=true.
      const metadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })
      const validateSpy = vi.spyOn(validation, 'validateArc3Values')
      const getByIdSpy = vi.spyOn(writer.client.algorand.asset, 'getById')

      // The ASA has decimals=0, metadata says decimals=0 -> should pass.
      const newMetadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Zero Decimals', decimals: 0 },
      })

      const mbrDelta = await writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
        validateArc3: true,
      })
      expect(mbrDelta).toBeInstanceOf(MbrDelta)
      expect(getByIdSpy).toHaveBeenCalledOnce()
      expect(validateSpy).toHaveBeenCalledOnce()
    })

    test('replace validate arc3 raises asa not found', async () => {
      // replaceMetadata should raise AsaNotFoundError when validateArc3=true and the ASA doesn't exist.
      const metadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })
      const newMetadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Missing ASA', decimals: 0 },
      })

      await algorand.send.assetDestroy({ sender: assetManager.addr, assetId })

      const result = writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
        validateArc3: true,
      })
      await expect(result).rejects.toThrow(AsaNotFoundError)
      await expect(result).rejects.toThrow(`Asset ${assetId} does not exist`)
    })

    test('replace validate arc3 fails invalid decimals', async () => {
      // replaceMetadata should raise MetadataArc3Error when validateArc3=true and decimals don't match.
      const metadata = await uploadMetadata({
        writer,
        assetManager,
        appClient: client,
        metadata: buildShortMetadata(assetId),
      })

      // The ASA has decimals=0, but metadata says decimals=6
      const newMetadata = AssetMetadata.fromJson({
        assetId,
        jsonObj: { name: 'Wrong Decimals', decimals: 6 },
      })

      const result = writer.replaceMetadata({
        assetManager,
        metadata: newMetadata,
        assumeCurrentSize: metadata.size,
        validateArc3: true,
      })
      await expect(result).rejects.toThrow(MetadataArc3Error)
      await expect(result).rejects.toThrow(/ARC-3 field 'decimals' must match ASA decimals \(0\), got 6/)
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
      await uploadMetadata({ writer, assetManager, appClient: client, metadata: buildShortMetadata(assetId) })

      await writer.replaceMetadataSlice({
        assetManager,
        assetId,
        offset: 0,
        payload: encode('patch'),
      })
      const record = await reader.box.getAssetMetadataRecord({ assetId })
      expect(record).not.toBeNull()
      // Verify the slice was written at offset 0
      const body = record.body.rawBytes
      expect(new TextDecoder().decode(body.slice(0, 5))).toBe('patch')
    })
  })
})

// ================================================================
// Box Resources Sizing Tests (TS-only)
// ================================================================

describe('box resources sizing', () => {
  // TS-only: writes touching a maxed metadata box size the Box I/O (extra resources calls) and the
  // Metadata Hash opcode budget on the current box (Python v1.0.0 `_box_resources`).
  let assetManager: AddressWithSigners
  let writer: AsaMetadataRegistryWrite
  let minFee: number
  let assetId: bigint

  beforeAll(async () => {
    writer = new AsaMetadataRegistryWrite({ client })
    assetManager = await createFundedAccount(fixture)
    minFee = Number((await algorand.getSuggestedParams()).minFee)
  })

  beforeEach(async () => {
    assetId = await createArc89Asa({ assetManager, appClient: client })
    await uploadMetadata({
      writer,
      assetManager,
      appClient: client,
      metadata: buildMaxedMetadata(assetId),
      validateArc3: false,
    })
  })

  test('set flags and immutable on maxed metadata', async () => {
    await writer.setReversibleFlag({ assetManager, assetId, flagIndex: flags.REV_FLG_NTT, value: true })
    await writer.setIrreversibleFlag({ assetManager, assetId, flagIndex: flags.IRR_FLG_RESERVED_3 })
    await writer.setImmutable({ assetManager, assetId })

    const box = await getMetadataBox(assetId)
    expect(box.header.flags.reversible.ntt).toBe(true)
    expect(box.header.flags.irreversible.reserved3).toBe(true)
    expect(box.header.isImmutable).toBe(true)
    expect(box.body.size).toBe(MAX_METADATA_SIZE)
  })

  test('replace slice on maxed metadata', async () => {
    const payload = encode('patch')
    const offset = MAX_METADATA_SIZE - payload.length
    const composer = await writer.buildReplaceMetadataSliceGroup({ assetManager, assetId, offset, payload })
    // 2 extra resources calls for the Box I/O, the Metadata Hash recomputed over 33 pages (7 + 1 tail budget txns)
    await expectGroup(composer, { txns: [REPLACE_SLICE, ...repeat(2, EXTRA_RESOURCES)], feePool: 11 * minFee })

    await writer.replaceMetadataSlice({ assetManager, assetId, offset, payload })
    const box = await getMetadataBox(assetId)
    expect(box.body.rawBytes.slice(offset)).toEqual(payload)
  })

  test('delete maxed metadata', async () => {
    const composer = await writer.buildDeleteMetadataGroup({ assetManager, assetId })
    // Head call + MBR refund inner payment + 2 extra resources calls for the Box I/O
    await expectGroup(composer, { txns: [DELETE, ...repeat(2, EXTRA_RESOURCES)], feePool: 4 * minFee })

    const mbrDelta = await writer.deleteMetadata({ assetManager, assetId })
    expect(mbrDelta.isNegative).toBe(true)
    await expect(client.state.box.assetMetadata.value(assetId)).rejects.toThrow(/box not found/)
  })
})
