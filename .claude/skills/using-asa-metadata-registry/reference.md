# ASA Metadata Registry SDK reference

All names are exports of `@algorandfoundation/asa-metadata-registry-sdk`. IDs accept `bigint | number` (a `number` must be a safe integer, else `RangeError`); returned IDs, revisions and uint64 values are `bigint`.

## Contents

- Facade
- Reader: records and URIs
- Reader: contract getters
- Writer
- Group builders, options and dry runs
- Migration
- Models and flags
- Hashing, JSON validation and codec
- Deployments and constants
- Errors
- Contract-to-contract calls (PuyaTs)

## Facade

- `AsaMetadataRegistry.forNetwork(network, { algod?, appClient? })`: trusted deployment from `DEFAULT_DEPLOYMENTS` (pins the app ID and ARC-90 netauth).
- `AsaMetadataRegistry.fromAlgod({ algod, appId, netauth? })`: BOX reads only.
- `AsaMetadataRegistry.fromAppClient(appClient, { algod?, appId?, netauth? })`: AVM reads and writes; also BOX reads when `algod` is given.

Members: `registry.read` (`AsaMetadataRegistryRead`), `registry.write` (`AsaMetadataRegistryWrite`), `registry.arc90Uri({ assetId })` (an `Arc90Uri`; call `.toUri()`).

The app client is `new generated.AsaMetadataRegistryClient({ algorand, appId, defaultSender })`. AVM reads simulate a transaction from `defaultSender`, so that account must hold Algos. Writes use the `assetManager` you pass.

## Reader: records and URIs

Every reader method also takes `source?: MetadataSource` (`AUTO`, `BOX`, `AVM`) and `simulate?: SimulateOptions` (AVM only, merged over `DEFAULT_SIMULATE_OPTIONS`).

```text
getAssetMetadata({ assetId or metadataUri, followDeprecation = true, maxDeprecationHops = 5, driftRetries = 2 })
                                                          // -> AssetMetadataRecord
resolveArc90Uri({ assetId } | { metadataUri })            // -> Arc90Uri; trusted registries only
resolveArc90UriFromAssetUrl({ assetId, assetUrl })        // -> Arc90Uri | null
```

`AssetMetadataRecord`: `appId`, `assetId`, `header`, `body`, `json`, `arc20AppId`, `arc62AppId`, `hashMatches({ asaAm? })`, `expectedMetadataHash()`, `asAssetMetadata()`.

## Reader: contract getters

Each takes `{ assetId, ...extra, source?, simulate? }` (extra arguments after `+`):

- `arc89CheckMetadataExists` → `MetadataExistence { asaExists, metadataExists }`
- `arc89IsMetadataImmutable` → `boolean` (immutable flag, or ASA manager cleared)
- `arc89IsMetadataShort` → `[isShort, revision]`
- `arc89GetMetadataHeader` → `MetadataHeader`
- `arc89GetMetadataPagination` → `Pagination { metadataSize, pageSize, totalPages, revision, deprecatedBy }`
- `arc89GetMetadata` + `page` → `PaginatedMetadata { pageContent, hasNextPage, revision }`
- `arc89GetMetadataSlice` + `offset`, `size` (max 1,007) → `MetadataSlice { content, revision }`
- `arc89GetMetadataHeaderHash`, `arc89GetMetadataHash` → `[hash, revision]`
- `arc89GetMetadataPageHash` + `page` → `[hash, revision]`
- `arc89GetMetadataStringByKey` + `key` → `string`
- `arc89GetMetadataUint64ByKey` + `key` → `bigint`
- `arc89GetMetadataObjectByKey` + `key` → `string` (the stored JSON text of the value)
- `arc89GetMetadataB64BytesByKey` + `key`, `b64Encoding` (`B64_STD_ENCODING` or `B64_URL_ENCODING`) → `Uint8Array` (decoded)
- `arc89GetMetadataMbrDelta` + `newSize` (`DELETE_METADATA_SIZE` quotes a delete) → `MbrDelta`

Without `assetId`: `arc89GetMetadataRegistryParameters()` returns `RegistryParameters` (sizes and MBR rates); `arc89GetMetadataPartialUri()` returns the ARC-90 URI without the box part (the URL of a native ASA).

The four `…ByKey` getters need short metadata (up to `SHORT_METADATA_SIZE`, 4,096 bytes) and a value of at most `PAGE_SIZE` (1,007 bytes); base64 values are measured after decoding.

## Writer

`registry.write.<method>({ assetManager, ...args, options?, sendParams? })`. `assetManager` is the ASA manager as `{ addr, signer }`.

- `createMetadata` + `metadata`, `validateArc3 = true` (checks ARC-3 `decimals` against the ASA) → `MbrDelta` (MBR paid)
- `replaceMetadata` + `metadata`, `validateArc3 = true`, `assumeCurrentSize?` → `MbrDelta`
- `replaceMetadataSlice` + `assetId`, `offset`, `payload` (bytes), `validate = true` (checks the result) → `void`
- `deleteMetadata` + `assetId` → `MbrDelta` (refund)
- `setReversibleFlag` + `assetId`, `flagIndex` (`REV_FLG_*`), `value` → `void`
- `setIrreversibleFlag` + `assetId`, `flagIndex` (2 to 6: `IRR_FLG_ARC54`, reserved) → `void`
- `setImmutable` + `assetId` → `void`
- `migrateMetadata` + `assetId`, `newRegistryId` → `void` (sets `deprecatedBy` to the newer registry)

`MbrDelta`: `sign` (`MbrDeltaSign.POS`, `NEG`, `NULL`), `amount` (microAlgos), `isPositive`, `isNegative`, `isZero`, `signedAmount`.

## Group builders, options and dry runs

```ts
const composer = await registry.write.buildCreateMetadataGroup({ assetManager, metadata })
// also: buildReplaceMetadataGroup, buildReplaceMetadataSliceGroup, buildDeleteMetadataGroup
composer.addTransaction(otherTxn, assetManager.signer) // more transactions in the same atomic group
await AsaMetadataRegistryWrite.sendGroup({ composer, simulate: { ...DEFAULT_SIMULATE_OPTIONS } }) // dry run
await AsaMetadataRegistryWrite.sendGroup({ composer }) // send
```

`WriteOptions` (all fields required, so spread `writeOptionsDefault`): `extraResources`, `feePaddingTxns`, `coverAppCallInnerTransactionFees`, `populateAppCallResources`.

## Migration

```text
migrateLegacyMetadataToRegistry({
  registry, assetManager, assetId,
  metadata,               // Uint8Array (original file, stored byte for byte) or object (re-encoded compactly)
  arc3Compliant,          // validates ARC-3 and derives the ARC-3/ARC-20/ARC-62 flags
  flags?,                 // must include immutable when the ASA has a nonzero `am`
  verifyAm = true,        // ARC-3 hash of the stored bytes must equal the ASA `am`
  publishArc2Message = false,
})
```

It fails when the ASA does not exist, already has metadata, or `flags` set ARC-89 native. Helpers: `buildArc2MigrationMessageTxn({ registry, assetId, assetManager, metadataUri })`, `encodeArc2MigrationMessage(uri)`, `deriveMigrationUri({ registry, assetId, arc3 })`.

## Models and flags

- `AssetMetadata.fromJson({ assetId, jsonObj, flags?, deprecatedBy?, arc3Compliant? })`: encodes the object compactly.
- `AssetMetadata.fromBytes({ assetId, metadataBytes, flags?, deprecatedBy?, validateJsonObject = true, arc3Compliant? })`: keeps the bytes exactly.
- `AssetMetadata`: `body` (`MetadataBody`: `rawBytes`, `size`, `isShort`, `json`, `totalPages()`), `flags`, `computeHeaderHash()`, `computeMetadataHash()`.
- `MetadataHeader`: `identifiers`, `flags`, `metadataHash`, `revision`, `deprecatedBy`, and the getters `isShort`, `isImmutable`, `isDeprecated`, `isArc3Compliant`, `isArc89Native`, `isArc20SmartAsa`, `isArc62CirculatingSupply`, `isArc54Burnable`, `isNttCrossChain`.
- `new MetadataFlags({ reversible, irreversible })`, `MetadataFlags.empty()`.
- `new ReversibleFlags({ arc20?, arc62?, ntt? })`, `ReversibleFlags.empty()`: can be changed later (`REV_FLG_ARC20` 0, `REV_FLG_ARC62` 1, `REV_FLG_NTT` 2).
- `new IrreversibleFlags({ arc3?, arc89Native?, burnable?, immutable? })`: `arc3` (0) and `arc89Native` (1) only at creation; `burnable` (`IRR_FLG_ARC54`, 2) with `setIrreversibleFlag`; `immutable` (7) with `setImmutable`.

## Hashing, JSON validation and codec

- `computeArc3MetadataHash(bytes)`: the ARC-3 `am` of a metadata file.
- `computeHeaderHash({ metadataIdentifiers, reversibleFlags, irreversibleFlags, metadataSize })`, `computePageHash({ pageIndex, pageContent })`, `computeMetadataHash({ metadataIdentifiers, reversibleFlags, irreversibleFlags, metadata, pageSize })`, `paginate(bytes, pageSize)`.
- `decodeMetadataJson(bytes)`: strict (no BOM, no duplicate keys, no lone surrogates; keeps the source text of numbers such as `1.0` until a value is assigned to them). `encodeMetadataJson(obj)`: compact UTF-8. `validateArc3Schema(obj)` throws on invalid ARC-3.
- `Arc90Uri.parse(uri)` gives `{ netauth, appId, boxName, compliance, assetId }`; `.withAssetId(id)`, `.toUri()`. `completePartialAssetUrl(assetUrl, assetId)` completes a partial URI. `assetIdToBoxName(id)`, `boxNameToAssetId(bytes)`, `b64Encode`, `b64Decode`, `b64UrlEncode`, `b64UrlDecode`.

## Deployments and constants

- `DEFAULT_DEPLOYMENTS[network]`: `{ network, appId, arc90UriNetauth, genesisHashB64, creatorAddress }`. `TESTNET_ASA_METADATA_REGISTRY_APP_ID` (TestNet netauth `net:testnet`).
- Sizes: `MAX_METADATA_SIZE` 32,717; `SHORT_METADATA_SIZE` 4,096; `PAGE_SIZE` 1,007; `MAX_PAGES` 33; `DELETE_METADATA_SIZE` 65,535.

## Errors

All extend `AsaMetadataRegistryError`: `MissingAppClientError`, `RegistryResolutionError`, `InvalidArc90UriError`, `AsaNotFoundError`, `MetadataNotFoundError`, `BoxNotFoundError`, `BoxParseError`, `MetadataKeyError`, `MetadataEncodingError`, `MetadataArc3Error`, `InvalidArc3PropertiesError`, `MetadataHashMismatchError`, `MetadataDriftError`, `InvalidPageIndexError`, `InvalidSliceError`, `InvalidFlagIndexError`. AVM reads that fail in the contract throw the simulate error instead.

## Contract-to-contract calls (PuyaTs)

The package ships the registry's typed contract stub at the `/avm` subpath:

```ts
import { arc4, Contract, uint64 } from '@algorandfoundation/algorand-typescript'
import { AsaMetadataRegistry } from '@algorandfoundation/asa-metadata-registry-sdk/avm'

export class Consumer extends Contract {
  isShort(registryAppId: uint64, assetId: uint64): boolean {
    const { returnValue } = arc4.abiCall<typeof AsaMetadataRegistry.prototype.arc89_is_metadata_short>({
      appId: registryAppId,
      args: [new arc4.Uint<64>(assetId)],
    })
    return returnValue.flag.native
  }
}
```

On chain, the JSON getters parse the full metadata with `json_ref` (cost 25 + 2 per 7 bytes), so a caller may need extra app calls in the group for opcode budget.
