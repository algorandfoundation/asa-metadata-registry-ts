# ASA Metadata Registry TypeScript SDK

[![npm](https://img.shields.io/npm/v/@algorandfoundation/asa-metadata-registry-sdk)](https://www.npmjs.com/package/@algorandfoundation/asa-metadata-registry-sdk)
[![Release](https://github.com/algorandfoundation/asa-metadata-registry-ts/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/algorandfoundation/asa-metadata-registry-ts/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

TypeScript SDK for the [ARC-89](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0089.md) ASA Metadata
Registry, the singleton Algorand application that stores ASA metadata on-chain. It is a port of the
[reference Python SDK](https://github.com/algorandfoundation/arc89) v1.0.0 with full feature parity.

- **Read** metadata straight from the box (one Algod request) or through AVM simulation, so you get exactly what a
  smart contract gets.
- **Write** metadata: create, replace (in full or one byte range) and delete it, and set flags and immutability.
  Large payloads are split into chunks for you.
- **Migrate** legacy ARC-3, ARC-19 and ARC-69 ASAs, and build and parse ARC-90 URIs.
- **Call the registry from contracts** with the Algorand TypeScript client at `/avm`.

Built on [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts) v9 and
[algosdk](https://github.com/algorand/js-algorand-sdk) v3 (consensus v42 / AVM 13).

The registry is deployed on TestNet (app ID `772968354`). MainNet is not deployed yet, so `forNetwork('mainnet')` throws
until it is.

## Install

The package has no runtime dependencies. Install the peer dependencies alongside it:

```sh
pnpm add @algorandfoundation/asa-metadata-registry-sdk @algorandfoundation/algokit-utils algosdk
```

Requires Node.js 22.17 or later.

## Quick start

Read an ASA's metadata from TestNet:

```ts
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AsaMetadataRegistry } from '@algorandfoundation/asa-metadata-registry-sdk'

const algod = AlgorandClient.testNet().client.algod
const registry = AsaMetadataRegistry.forNetwork('testnet', { algod })

const record = await registry.read.getAssetMetadata({ assetId: 772968365n })
console.log(record.json) // { name: 'Cusma #2', description: 'Cusma autograph #2', ... }
```

Writes need an app client signed by the ASA manager. See the cookbook for the full setup.

## Documentation

- [Cookbook](./docs/cookbook.md): tested recipes for every main feature, on TestNet and LocalNet.
- [SDK reference](./.claude/skills/using-asa-metadata-registry/reference.md): every signature, model, flag and error.
- [Parity contract](./docs/PARITY_CONTRACT.md): how the API maps to the Python SDK.
- [ARC-89 specification](https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0089.md).

### Agent skill

[`.claude/skills/using-asa-metadata-registry`](./.claude/skills/using-asa-metadata-registry) is an
[agent skill](https://code.claude.com/docs/en/skills) that teaches coding agents how to use this SDK. To use it in your
own project, copy the folder into the project's `.claude/skills/` folder (or into `~/.claude/skills/` for all your
projects).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, tests, generated clients and dependency policy.

## License

[MIT](./LICENSE)
