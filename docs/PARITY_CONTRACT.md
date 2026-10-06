# Python → TypeScript Port Parity Contract

This repository is the TypeScript port of the **ASA Metadata Registry Python SDK** (reference implementation in
[algorandfoundation/arc89](https://github.com/algorandfoundation/arc89), pinned by the `arc89` git submodule).

Current parity target: **Python SDK v1.0.0** (ASA Metadata Registry contract built for AVM 13 / consensus v42).

The Python SDK public surface is defined by `asa_metadata_registry/__init__.py`.
This document freezes the intended public API for the TypeScript SDK so the port
can maintain **100% feature parity** while making the TS implementation **async**
where appropriate.

## Global rules

- **Feature parity:** the TS SDK will expose the same capabilities as the Python SDK.
- **Generated clients are excluded:** the TypeScript repo contains the AlgoKit-generated
  client (`src/generated/AsaMetadataRegistry.ts`) and the AVM client
  (`src/generated/avm/AsaMetadataRegistry.client.ts`, Algorand TypeScript stub for
  contract-to-contract calls). The handwritten SDK must _wrap_ them, not re-implement them.
- **AlgoKit basis:** `@algorandfoundation/algokit-utils` v9 and `algosdk` v3 (peer dependencies).
  Consensus v42 app args (4 KB payload args, 16 KB aggregate) require `algosdk` >= 3.7.
- **Async boundary:**
  - Pure utilities (flags, bitmasks, codecs, hashing, parsing) stay **sync**.
  - Anything that does network I/O (Algod/Indexer reads, simulate, send) is **async**.
- **Bytes:** use `Uint8Array` as the canonical byte container.
- **UInt64:** accept `bigint` (and sometimes `number` where safe); internal logic
  should normalize to `bigint` when correctness matters.
- **Tuples:** Python `tuple[...]` returns map to TS `readonly [...]` tuples (e.g. hash getters
  return `readonly [hash: Uint8Array, revision: bigint]`).

## Public API parity checklist

The following symbols are exported by the Python SDK. TS exports the same conceptual
symbols, with async adaptations where needed.

- Modules:
  - `constants`, `flags`, `enums`, `bitmasks`
  - `codec`, `hashing`

- Values / types:
  - `DEFAULT_DEPLOYMENTS`, `RegistryDeployment`
  - `deploymentForGenesis`, `netauthForGenesis`, `netauthMatchesGenesis`

- Codec:
  - `assetIdToBoxName`, `boxNameToAssetId`
  - `b64Encode`, `b64Decode`, `b64UrlEncode` (canonical unpadded), `b64UrlDecode` (canonical only)
  - `Arc90Uri`, `Arc90Compliance`, `completePartialAssetUrl`

- Hashing (content-only, no Asset ID):
  - `sha512_256`, `sha256`
  - `paginate`
  - `computeHeaderHash`, `computePageHash`, `computeMetadataHash`, `computeArc3MetadataHash`

- Validation helpers:
  - `encodeMetadataJson`, `decodeMetadataJson` (RFC 8259: no duplicate names, lone surrogates, non-finite numbers)
  - `isArc3Metadata`, `validateArc3Schema`

- Models:
  - `RegistryParameters`, `MetadataHeader`, `MetadataBody`, `Pagination`, `PaginatedMetadata`, `MetadataSlice`
  - `MetadataExistence`, `MbrDelta`, `MbrDeltaSign`
  - `MetadataFlags`, `ReversibleFlags`, `IrreversibleFlags`
  - `AssetMetadataBox`, `AssetMetadataRecord`, `AssetMetadata`
  - `getDefaultRegistryParams`

- Errors:
  - `AsaMetadataRegistryError`
  - `MissingAppClientError`
  - `InvalidArc90UriError`
  - `AsaNotFoundError`
  - `MetadataNotFoundError`
  - `BoxNotFoundError`
  - `BoxParseError`
  - `InvalidFlagIndexError`
  - `InvalidPageIndexError`
  - `InvalidSliceError`
  - `MetadataKeyError`
  - `MetadataEncodingError`
  - `MetadataArc3Error`
  - `MetadataDriftError`
  - `RegistryResolutionError`
  - `MetadataHashMismatchError`
  - `InvalidArc3PropertiesError`

- Box reads (Algod):
  - `AlgodBoxReader`
  - `AsaMetadataRegistryBoxRead`

- AVM reads (simulate):
  - `SimulateOptions`
  - `AsaMetadataRegistryAvmRead`

- Read:
  - `AsaMetadataRegistryRead` (trusted registry resolution: `netauth`, `trustedVersions`), `MetadataSource`

- Write:
  - `AsaMetadataRegistryWrite` (group builders + send helpers)
  - `WriteOptions`

- Migration:
  - `buildArc2MigrationMessageTxn`, `migrateLegacyMetadataToRegistry`

- Facade:
  - `AsaMetadataRegistry` (`fromAlgod`, `forNetwork`, `fromAppClient`), `RegistryConfig`

## Notes

- The generated client already exports ARC-56/ARC-4 struct typings (e.g. `MetadataHeader`,
  `RegistryParameters`, `MbrDelta`), but the SDK still provides its own domain models
  and conversion helpers where the Python SDK does.
- TS-only conveniences (e.g. `AssetMetadataRecord.arc20AppId` / `arc62AppId`) are allowed as long
  as they don't change the semantics of the ported API.
