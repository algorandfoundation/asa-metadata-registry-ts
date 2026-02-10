import { algo, microAlgo } from '@algorandfoundation/algokit-utils'
import type { AlgorandClient } from '@algorandfoundation/algokit-utils/types/algorand-client'
import type { AlgorandFixture } from '@algorandfoundation/algokit-utils/types/testing'
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AsaMetadataRegistryFactory, AsaMetadataRegistryClient } from '@/generated'
import {
  ACCOUNT_MBR,
  Arc90Uri,
  AsaMetadataRegistryWrite,
  AssetMetadata,
  AssetMetadataBox,
  MetadataBody,
  MetadataFlags,
  ReversibleFlags,
  IrreversibleFlags,
  MAX_METADATA_SIZE,
} from '@algorandfoundation/asa-metadata-registry-sdk'

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

export const getDeployer = (fixture: AlgorandFixture): TransactionSignerAccount => {
  return fixture.context.testAccount
}

export const createFundedAccount = async (
  fixture: AlgorandFixture,
  funds = algo(1000),
): Promise<TransactionSignerAccount> => {
  return await fixture.context.generateAccount({ initialFunds: funds })
}

// ================================================================
// Factory & deploy registry
// ================================================================

export const createFactory = (args: {
  algorand: AlgorandClient
  deployer: TransactionSignerAccount
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
  deployer: TransactionSignerAccount
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

export const createTestAsa = async (args: {
  assetManager: TransactionSignerAccount
  appClient: AsaMetadataRegistryClient
  url: string
}): Promise<bigint> => {
  const result = await args.appClient.algorand.send.assetCreate({
    sender: args.assetManager.addr,
    total: 42n,
    assetName: 'ARC89 Mutable',
    unitName: 'ARC89',
    decimals: 0,
    defaultFrozen: false,
    manager: args.assetManager.addr,
    url: args.url,
  })
  return result.assetId
}

export const createArc89Asa = async (args: {
  assetManager: TransactionSignerAccount
  appClient: AsaMetadataRegistryClient
  arc89PartialUri?: string
}): Promise<bigint> => {
  const partialUri = args.arc89PartialUri ?? createArc90PartialUri(args.appClient)
  return createTestAsa({
    assetManager: args.assetManager,
    appClient: args.appClient,
    url: partialUri,
  })
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

export const buildShortMetadata = (assetId: bigint): AssetMetadata =>
  AssetMetadata.fromJson({ assetId, jsonObj: { ...sampleJsonObj } })

export const buildMaxedMetadata = (assetId: bigint): AssetMetadata =>
  new AssetMetadata({
    assetId,
    body: new MetadataBody(textEncoder.encode('x'.repeat(MAX_METADATA_SIZE))),
    flags: new MetadataFlags({
      reversible: ReversibleFlags.empty(),
      irreversible: new IrreversibleFlags({ arc89Native: true }),
    }),
    deprecatedBy: 0n,
  })

export const buildOversizedMetadata = (assetId: bigint): AssetMetadata =>
  new AssetMetadata({
    assetId,
    body: new MetadataBody(textEncoder.encode('x'.repeat(MAX_METADATA_SIZE + 1))),
    flags: MetadataFlags.empty(),
    deprecatedBy: 0n,
  })

// ================================================================
// Upload helper
// ================================================================

export const uploadMetadata = async (args: {
  writer: AsaMetadataRegistryWrite
  assetManager: TransactionSignerAccount
  appClient: AsaMetadataRegistryClient
  metadata: AssetMetadata
}): Promise<AssetMetadata> => {
  await args.writer.createMetadata({ assetManager: args.assetManager, metadata: args.metadata })
  const boxValue = await args.appClient.state.box.assetMetadata.value(args.metadata.assetId)
  if (!boxValue) throw new Error('Metadata box not found after create')
  const parsed = AssetMetadataBox.parse({ assetId: args.metadata.assetId, value: boxValue })
  return new AssetMetadata({
    assetId: args.metadata.assetId,
    body: parsed.body,
    flags: parsed.header.flags,
    deprecatedBy: parsed.header.deprecatedBy,
  })
}
