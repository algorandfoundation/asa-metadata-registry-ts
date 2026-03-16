import { expect } from 'vitest'
import { algo, microAlgo } from '@algorandfoundation/algokit-utils'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils'
import type { AlgorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { AsaMetadataRegistryFactory, AsaMetadataRegistryClient } from '@/generated'
import {
  ACCOUNT_MBR,
  ARC3_NAME_SUFFIX,
  Arc90Uri,
  AsaMetadataRegistryWrite,
  AssetMetadata,
  AssetMetadataBox,
  MetadataBody,
  MetadataFlags,
  ReversibleFlags,
  IrreversibleFlags,
  MAX_METADATA_SIZE,
  SHORT_METADATA_SIZE,
} from '@algorandfoundation/asa-metadata-registry-sdk'
import { AddressWithSigners } from '@algorandfoundation/algokit-utils/transact'

const ARC90_NETAUTH = process.env.ARC90_NETAUTH ?? 'net:localnet'
const textEncoder = new TextEncoder()

export const sampleJsonObj = {
  name: 'Silvia',
  answer: 42,
  date: { day: 13, month: 10, year: 1954 },
  gh_b64_url: 'f_________8=', // 2^63 - 1
  gh_b64_std: 'f/////////8=', // 2^63 - 1
} as const

// ================================================================
// Account helpers
// ================================================================

export const getDeployer = (fixture: AlgorandFixture): AddressWithSigners => {
  return fixture.context.testAccount
}

export const createFundedAccount = async (
  fixture: AlgorandFixture,
  funds = algo(1000),
): Promise<AddressWithSigners> => {
  return await fixture.context.generateAccount({ initialFunds: funds })
}

// ================================================================
// Factory & deploy registry
// ================================================================

export const createFactory = (args: {
  algorand: AlgorandClient
  deployer: AddressWithSigners
}): AsaMetadataRegistryFactory => {
  return new AsaMetadataRegistryFactory({
    algorand: args.algorand,
    defaultSender: args.deployer.addr,
    defaultSigner: args.deployer.signer,
    deployTimeParams: {
      TRUSTED_DEPLOYER: args.deployer.addr.publicKey,
      ARC90_NETAUTH: textEncoder.encode(ARC90_NETAUTH),
    },
  })
}

export const deployRegistry = async (args: {
  factory: AsaMetadataRegistryFactory
  deployer: AddressWithSigners
}): Promise<AsaMetadataRegistryClient> => {
  const { appClient } = await args.factory.send.create.bare()
  await args.factory.algorand.send.payment({
    sender: args.deployer.addr,
    receiver: appClient.appAddress,
    amount: microAlgo(ACCOUNT_MBR),
  })
  return appClient
}

// ================================================================
// ASA helpers
// ================================================================

export const createArc90PartialUri = (appClient: AsaMetadataRegistryClient): string => {
  return new Arc90Uri({ netauth: ARC90_NETAUTH, appId: appClient.appId, boxName: null }).toUri()
}

export const createArc89Asa = async (args: {
  assetManager: AddressWithSigners
  appClient: AsaMetadataRegistryClient
  arc89PartialUri?: string
}): Promise<bigint> => {
  const url = args.arc89PartialUri ?? createArc90PartialUri(args.appClient)
  const result = await args.appClient.algorand.send.assetCreate({
    sender: args.assetManager.addr,
    total: 42n,
    assetName: 'ARC89 Mutable',
    unitName: 'ARC89',
    decimals: 0,
    defaultFrozen: false,
    manager: args.assetManager.addr,
    url,
  })
  return result.assetId
}

/** Create a valid ARC-3 ASA (`assetName` ends with `@arc3`) */
export const createArc3Asa = async (args: {
  assetManager: AddressWithSigners
  appClient: AsaMetadataRegistryClient
}): Promise<bigint> => {
  const arc3Suffix = new TextDecoder().decode(ARC3_NAME_SUFFIX)
  const result = await args.appClient.algorand.send.assetCreate({
    sender: args.assetManager.addr,
    total: 42n,
    assetName: `ARC3 Test ASA${arc3Suffix}`,
    manager: args.assetManager.addr,
  })
  return result.assetId
}

/** Create a legacy ARC-3 ASA (without ARC-89 registry URL). */
export const createLegacyArc3Asa = async (args: {
  assetManager: AddressWithSigners
  appClient: AsaMetadataRegistryClient
}): Promise<bigint> => {
  const arc3Suffix = new TextDecoder().decode(ARC3_NAME_SUFFIX)
  const result = await args.appClient.algorand.send.assetCreate({
    sender: args.assetManager.addr,
    total: 1000n,
    assetName: `Legacy NFT${arc3Suffix}`,
    unitName: 'LNFT',
    url: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    decimals: 0,
    manager: args.assetManager.addr,
    reserve: args.assetManager.addr,
    freeze: args.assetManager.addr,
    clawback: args.assetManager.addr,
  })
  return result.assetId
}

/** Create a legacy ARC-69 ASA with metadata in the note field. */
export const createLegacyArc69Asa = async (args: {
  assetManager: AddressWithSigners
  appClient: AsaMetadataRegistryClient
  metadata?: Record<string, unknown>
}): Promise<bigint> => {
  const note = new TextEncoder().encode(JSON.stringify(args.metadata ?? { name: 'Test Asset' }))
  const result = await args.appClient.algorand.send.assetCreate({
    sender: args.assetManager.addr,
    total: 1_000_000n,
    assetName: 'Legacy Token',
    unitName: 'LTK',
    decimals: 6,
    manager: args.assetManager.addr,
    reserve: args.assetManager.addr,
    freeze: args.assetManager.addr,
    clawback: args.assetManager.addr,
    note,
  })
  return result.assetId
}

// ================================================================
// Metadata builders
// ================================================================

export const buildEmptyMetadata = (assetId: bigint): AssetMetadata =>
  new AssetMetadata({
    assetId,
    body: MetadataBody.empty(),
    flags: MetadataFlags.empty(),
    deprecatedBy: 0n,
  })

export const buildShortMetadata = (arc89Asa: bigint, jsonObj?: Record<string, unknown>): AssetMetadata => {
  const metadata = jsonObj
    ? AssetMetadata.fromJson({ assetId: arc89Asa, jsonObj })
    : AssetMetadata.fromJson({ assetId: arc89Asa, jsonObj: { ...sampleJsonObj } })
  expect(metadata.body.size).toBeLessThanOrEqual(SHORT_METADATA_SIZE)
  expect(metadata.body.isShort).toBe(true)
  return metadata
}

export const buildMaxedMetadata = (arc89Asa: bigint): AssetMetadata => {
  const metadata = new AssetMetadata({
    assetId: arc89Asa,
    body: new MetadataBody(textEncoder.encode('x'.repeat(MAX_METADATA_SIZE))),
    flags: new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true }),
    }),
    deprecatedBy: 0n,
  })
  expect(metadata.body.size).toBe(MAX_METADATA_SIZE)
  expect(metadata.body.isShort).toBe(false)
  return metadata
}

export const buildOversizedMetadata = (arc89Asa: bigint): AssetMetadata => {
  const metadata = new AssetMetadata({
    assetId: arc89Asa,
    body: new MetadataBody(textEncoder.encode('x'.repeat(MAX_METADATA_SIZE + 1))),
    flags: MetadataFlags.empty(),
    deprecatedBy: 0n,
  })
  expect(metadata.body.size).toBeGreaterThan(MAX_METADATA_SIZE)
  return metadata
}

/** Create an ARC-3 compliant metadata payload. */
export const createArc3Payload = (args: {
  name: string
  description?: string
  image?: string
  externalUrl?: string
  properties?: Record<string, unknown>
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = { name: args.name }
  if (args.description) payload['description'] = args.description
  if (args.image) payload['image'] = args.image
  if (args.externalUrl) payload['external_url'] = args.externalUrl
  if (args.properties) payload['properties'] = args.properties
  return payload
}

// ================================================================
// Upload metadata helper
// ================================================================

export const uploadMetadata = async (args: {
  writer: AsaMetadataRegistryWrite
  assetManager: AddressWithSigners
  appClient: AsaMetadataRegistryClient
  metadata: AssetMetadata
  immutable?: boolean
}): Promise<AssetMetadata> => {
  const { metadata } = args
  await args.writer.createMetadata({ assetManager: args.assetManager, metadata })
  if (args.immutable) {
    await args.writer.setImmutable({ assetManager: args.assetManager, assetId: metadata.assetId })
  }
  const boxValue = await args.appClient.state.box.assetMetadata.value(metadata.assetId)
  expect(boxValue).not.toBeNull()
  const parsed = AssetMetadataBox.parse({ assetId: metadata.assetId, value: boxValue! })
  return new AssetMetadata({
    assetId: metadata.assetId,
    body: parsed.body,
    flags: parsed.header.flags,
    deprecatedBy: parsed.header.deprecatedBy,
  })
}
