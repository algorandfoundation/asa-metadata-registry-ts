---
name: using-asa-metadata-registry
description: Writes TypeScript code with @algorandfoundation/asa-metadata-registry-sdk, the SDK of the ARC-89 ASA Metadata Registry on Algorand. Covers registry setup, reading metadata (BOX or AVM source), JSON key getters, creating, replacing and deleting metadata, flags and immutability, native ARC-89 ASAs, migrating legacy ARC-3/ARC-19/ARC-69 ASAs, ARC-90 URIs and hash checks. Use whenever code imports this package, or the user mentions the ASA Metadata Registry, ARC-89, ARC-90 URIs, on-chain ASA metadata, or moving ASA metadata from IPFS or a URL into the registry, even if the package is not named.
---

# ASA Metadata Registry SDK

`@algorandfoundation/asa-metadata-registry-sdk` needs Node >= 22.17 and the peer dependencies `@algorandfoundation/algokit-utils` (v9) and `algosdk` (v3). All exports below come from the package root. For every signature, return type, model, flag and error, read [reference.md](reference.md).

## How the registry works

- The registry is an Algorand app. It keeps the metadata of each ASA in one box: a header (flags, Metadata Hash, revision, `deprecatedBy`) and up to 32,717 bytes of JSON.
- Writes are app calls by the **ASA manager** account, which also pays the box MBR and the fees. Reads need no signature.
- Two read paths, chosen with the `source` option (`MetadataSource`):
  - `BOX`: one algod box read, then the contract logic in TypeScript. Fast; needs `algod`.
  - `AVM`: simulates the contract getter, so the result is exactly what an on-chain caller gets. Needs an app client.
  - `AUTO` (default): BOX when `algod` is configured, else AVM. Exceptions: with an app client, the four JSON getters, `arc89GetMetadataRegistryParameters` and `arc89GetMetadataPartialUri` use AVM. `arc89GetMetadataPartialUri` always needs an app client.

## Setup

```ts
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  AsaMetadataRegistry,
  TESTNET_ASA_METADATA_REGISTRY_APP_ID,
  generated,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const algorand = AlgorandClient.testNet()
const algod = algorand.client.algod

// Read-only: BOX reads only
const reader = AsaMetadataRegistry.forNetwork('testnet', { algod })

// Reads (BOX + AVM) and writes. The ASA manager signs writes and pays MBR and fees.
const manager = algorand.account.fromMnemonic(process.env.MANAGER_MNEMONIC!) // { addr, signer }
const appClient = new generated.AsaMetadataRegistryClient({
  algorand,
  appId: BigInt(TESTNET_ASA_METADATA_REGISTRY_APP_ID),
  defaultSender: manager.addr, // AVM reads simulate a transaction: this account must hold Algos (nothing is spent)
})
const registry = AsaMetadataRegistry.forNetwork('testnet', { algod, appClient })
```

- `forNetwork` throws `RegistryResolutionError` when `DEFAULT_DEPLOYMENTS` has no app ID for that network. Then use `AsaMetadataRegistry.fromAlgod({ algod, appId, netauth })` or `AsaMetadataRegistry.fromAppClient(appClient, { algod, netauth })` (LocalNet: `netauth: 'net:localnet'`).
- `registry.write` throws `MissingAppClientError` when the facade has no app client.

## Read

```ts
const record = await registry.read.getAssetMetadata({ assetId }) // AssetMetadataRecord
record.json // parsed JSON object
record.body.rawBytes // the exact stored bytes
record.header.revision // bigint

const name = await registry.read.arc89GetMetadataStringByKey({ assetId, key: 'name' })
const props = JSON.parse(await registry.read.arc89GetMetadataObjectByKey({ assetId, key: 'properties' }))
```

`getAssetMetadata` also accepts `{ metadataUri }` (an ARC-90 URI), follows `deprecatedBy` to newer registry versions, and on AVM reads all pages and retries if the metadata changes in between. Other getters: existence, immutability, header, pagination, pages, slices, hashes, uint64 and base64 values, MBR delta, registry parameters (see [reference.md](reference.md)).

## Write

```ts
const metadata = AssetMetadata.fromJson({ assetId, jsonObj: { name: 'Rock #7', properties: { rarity: 'rare' } } })
await registry.write.createMetadata({ assetManager: manager, metadata }) // returns the MbrDelta
await registry.write.replaceMetadata({ assetManager: manager, metadata })
await registry.write.deleteMetadata({ assetManager: manager, assetId }) // MBR refund
await registry.write.setImmutable({ assetManager: manager, assetId }) // final
```

The SDK splits the payload into chunks and adds the MBR payment, opcode budget and box resource calls in one atomic group. For a dry run or extra transactions in the same group, use the `build…Group` methods and `AsaMetadataRegistryWrite.sendGroup` (see [reference.md](reference.md)).

**New ARC-89 native ASA**: use the registry's partial ARC-90 URI as the ASA URL, then store the metadata with the native flag.

```ts
const url = await registry.read.arc89GetMetadataPartialUri()
const { assetId } = await algorand.send.assetCreate({
  sender: manager.addr,
  total: 1n,
  decimals: 0,
  manager: manager.addr,
  url,
})
const metadata = AssetMetadata.fromJson({
  assetId,
  jsonObj,
  flags: new MetadataFlags({
    reversible: ReversibleFlags.empty(),
    irreversible: new IrreversibleFlags({ arc89Native: true }),
  }),
})
await registry.write.createMetadata({ assetManager: manager, metadata })
```

## Migrate a legacy ASA (ARC-3, ARC-19, ARC-69)

```ts
await migrateLegacyMetadataToRegistry({
  registry,
  assetManager: manager,
  assetId,
  metadata: fileBytes, // Uint8Array: the original file, byte for byte
  arc3Compliant: true,
  publishArc2Message: true, // optional ARC-2 announcement in the same group
})
```

- Pass the original file bytes, not a parsed object. When the ASA has a nonzero `am` (metadata hash), the ARC-3 hash of the stored bytes must equal it, else `MetadataHashMismatchError`. An object is re-encoded compactly and usually no longer matches.
- With a nonzero `am`, the SDK sets the immutable flag. Explicit `flags` must then include `immutable: true`.

## Verify

```ts
const asaAm = (await algorand.asset.getById(assetId)).metadataHash
record.hashMatches({ asaAm }) // the stored Metadata Hash, and the ARC-3 `am` when it is set
computeArc3MetadataHash(fileBytes) // the ARC-3 `am` of a file
```

## Pitfalls

- The JSON getters work only on short metadata (up to 4,096 bytes) and return values up to 1,007 bytes. For larger metadata, read `getAssetMetadata(...).json`.
- `arc89GetMetadataObjectByKey` returns the stored JSON text (whitespace kept), not an object.
- `record.json` holds JS numbers, so integers above 2^53 lose precision. Use `arc89GetMetadataUint64ByKey` (returns a bigint) for exact uint64 values.
- The JSON getters fail, on both paths, when any number in the document is outside the float64 range (`1e400`); the uint64 getter also rejects `-0`.
- `fromJson({ arc3Compliant: true })` validates ARC-3 and sets the ARC-3 flag (plus ARC-20/ARC-62 from `properties`). Explicit `flags` must then include `irreversible.arc3: true`. ARC-20 and ARC-62 need ARC-3.
- `setImmutable` and irreversible flags cannot be undone; after `setImmutable`, replace, delete and flag changes fail. `setIrreversibleFlag` accepts only indexes 2 to 6 (`IRR_FLG_ARC54` and reserved ones).
- Custom `simulate` options merge over the defaults. AVM reads already get the maximum extra opcode budget.
- Pass asset and app IDs as `bigint`. A `number` is accepted only up to 2^53 - 1; larger numbers throw an error.
- BOX reads throw typed errors (`BoxNotFoundError`, `MetadataKeyError`, `MetadataEncodingError`). AVM reads throw the simulate error with the contract message.
- With a nonzero `asaAm`, `hashMatches` throws instead of returning `false` when the metadata is not immutable, or when ARC-89 native metadata without ARC-3 does not hash to `am` (`MetadataHashMismatchError`). Wrap it in try/catch and treat a throw as a failed check.
- If Node fails to load the package from an ES module with `ERR_MODULE_NOT_FOUND` inside `dist/esm`, run the program with `tsx` or a bundler, or use CommonJS.
