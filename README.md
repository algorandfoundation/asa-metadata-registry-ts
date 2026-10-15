# asa-metadata-registry-ts

ASA Metadata Registry TypeScript SDK

TypeScript port of the [ASA Metadata Registry](https://github.com/algorandfoundation/arc89) (ARC-89) Python SDK v1.0.0,
built on [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts) v9 and
[algosdk](https://github.com/algorand/js-algorand-sdk) v3 (consensus v42 / AVM 13).

The package has no runtime dependencies; install the peer dependencies alongside it:

```sh
pnpm add @algorandfoundation/asa-metadata-registry-sdk @algorandfoundation/algokit-utils algosdk
```

## Agent skill

[`.claude/skills/using-asa-metadata-registry`](./.claude/skills/using-asa-metadata-registry) is an
[agent skill](https://code.claude.com/docs/en/skills) that teaches coding agents how to use this SDK. Claude Code
loads it automatically in this repository. To use it in your own project, copy the folder into the project's
`.claude/skills/` folder (or into `~/.claude/skills/` for all your projects).

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

Both clients are generated from the ARC-56 spec of the pinned `arc89` submodule and committed:

- `src/generated/AsaMetadataRegistry.ts`: AlgoKit typed app client (`algokit-client-generator` 6.0.1), wrapped by the
  SDK. The generator is not a project dependency; regenerate the client with the AlgoKit CLI, which runs the generator
  through `npx` (outside the lockfile):

  ```sh
  algokit generate client arc89/smart_contracts/artifacts/asa_metadata_registry/AsaMetadataRegistry.arc56.json \
    -l typescript -v 6.0.1 -o src/generated/AsaMetadataRegistry.ts
  ```

- `src/generated/avm/AsaMetadataRegistry.client.ts`: AVM client (`puyats-clientgen`, `pnpm run generate:avm-client`),
  an Algorand TypeScript contract stub for contract-to-contract calls compiled with PuyaTs. It is shipped as source in
  the package and is not part of the SDK build. Contracts import it from
  `@algorandfoundation/asa-metadata-registry-sdk/avm`.

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
