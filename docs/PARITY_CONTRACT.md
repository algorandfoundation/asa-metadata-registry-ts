# Python → TypeScript Port Parity Contract (Phases 0–2)

This repository is the TypeScript port of the **ASA Metadata Registry Python SDK**.

The Python SDK public surface is defined by `asa_metadata_registry/__init__.py`.
This document freezes the intended public API for the TypeScript SDK so the port
can maintain **100% feature parity** while making the TS implementation **async**
where appropriate.

## Global rules

- **Feature parity:** the TS SDK will expose the same capabilities as the Python SDK.
- **Generated AppClient is excluded:** the TypeScript repo already contains the
  AlgoKit-generated client (`src/generated/AsaMetadataRegistry.ts`). The handwritten
  SDK must *wrap* it, not re-implement it.
- **Async boundary:**
  - Pure utilities (flags, bitmasks, codecs, hashing, parsing) stay **sync**.
  - Anything that does network I/O (Algod/Indexer reads, simulate, send) is **async**.
- **Bytes:** use `Uint8Array` as the canonical byte container.
- **UInt64:** accept `bigint` (and sometimes `number` where safe); internal logic
  should normalize to `bigint` when correctness matters.

## Intended TS module layout

Mirrors the Python SDK layout (names kept as close as possible):

- `src/index.ts` – public entrypoint
- `src/constants.ts` – protocol constants
- `src/flags.ts` – flag bit indices
- `src/enums.ts` – enum numeric constants
- `src/bitmasks.ts` – derived masks from flags
- `src/errors.ts` – SDK error classes
- `src/deployments.ts` – known deployments (data-only)

Stubs created in Phase 1 (to be implemented later):

- `src/codec.ts`
- `src/hashing.ts`
- `src/validation.ts`
- `src/models.ts`
- `src/algod.ts`
- `src/registry.ts`
- `src/read/*`
- `src/write/*`

## Public API parity checklist

The following symbols are exported by the Python SDK today. TS will export the
same conceptual symbols, with async adaptations where needed.

### Implemented in Phases 0–2

- Modules:
  - `constants`, `flags`, `enums`, `bitmasks`
- Values / types:
  - `DEFAULT_DEPLOYMENTS`, `RegistryDeployment`
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
  - `MetadataEncodingError`
  - `MetadataArc3Error`
  - `MetadataDriftError`
  - `RegistryResolutionError`
  - `MetadataHashMismatchError`

### Planned (stubs in Phase 1)

- Facade:
  - `AsaMetadataRegistry`, `RegistryConfig`
- Read:
  - `AsaMetadataRegistryRead`, `MetadataSource`, `SimulateOptions`
- Write:
  - `AsaMetadataRegistryWrite`, `WriteOptions`
- Codec / hashing / validation helpers:
  - `Arc90Uri`, `Arc90Compliance`, `completePartialAssetUrl`
  - `computeHeaderHash`, `computePageHash`, `computeMetadataHash`, `computeArc3MetadataHash`
  - `encodeMetadataJson`, `decodeMetadataJson`, `isArc3Metadata`, `validateArc3Schema`
- Models:
  - `RegistryParameters`, `MetadataHeader`, `MetadataBody`, `Pagination`, `PaginatedMetadata`
  - `MetadataExistence`, `MbrDelta`, `MbrDeltaSign`
  - `MetadataFlags`, `ReversibleFlags`, `IrreversibleFlags`
  - `AssetMetadataBox`, `AssetMetadataRecord`, `AssetMetadata`

## Notes

- The generated client already exports ARC-56/ARC-4 struct typings (e.g. `MetadataHeader`,
  `RegistryParameters`, `MbrDelta`), but the SDK will still provide its own domain models
  and conversion helpers where the Python SDK does.
