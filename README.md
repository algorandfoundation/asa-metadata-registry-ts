# asa-metadata-registry-ts

ASA Metadata Registry TypeScript SDK

TypeScript port of the [ASA Metadata Registry](https://github.com/algorandfoundation/arc89) (ARC-89) Python SDK v1.0.0,
built on [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts) v9 and
[algosdk](https://github.com/algorand/js-algorand-sdk) v3 (consensus v42 / AVM 13).

The package has no runtime dependencies; install the peer dependencies alongside it:

```sh
pnpm add @algorandfoundation/asa-metadata-registry-sdk @algorandfoundation/algokit-utils algosdk
```

## Devs

### Dependencies

Node: 22.17.0 (see `.nvmrc`)

```sh
git submodule update --init --recursive
pnpm install
pnpm exec husky
```

> `ignore-scripts=true` is set in `.npmrc` to block postinstall scripts from running on install. This means husky won't set up git hooks automatically and should be manually executed after cloning.

The `arc89` submodule pins the reference implementation (smart contract, ARC-56 spec, Python SDK and conformance
vectors) the SDK is at parity with.

### Generated clients

Both clients are generated from the ARC-56 spec of the pinned `arc89` submodule:

```sh
pnpm run generate
```

- `src/generated/AsaMetadataRegistry.ts`: AlgoKit typed app client (`algokit-client-generator`), wrapped by the SDK.
- `src/generated/avm/AsaMetadataRegistry.client.ts`: AVM client (`puyats-clientgen`), an Algorand TypeScript
  contract stub for contract-to-contract calls compiled with PuyaTs. It is shipped as source in the package and is not
  part of the SDK build. Contracts import it from `@algorandfoundation/asa-metadata-registry-sdk/avm`.

### Tests

Integration tests run against an AlgoKit LocalNet:

```sh
algokit localnet start
pnpm run test
```

### Code Quality

```sh
pnpm run format
pnpm run lint
```

This project uses **Husky** and **lint-staged** to automatically lint and format staged files before they are committed.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dependency policy and lockfile rules.
