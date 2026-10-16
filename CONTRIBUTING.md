# Contributing

## Development

Use Node.js 22.17.0 (see `.nvmrc`) and the pnpm version pinned in `package.json`. With nvm installed, run these
commands from the repository root:

```sh
nvm use
corepack enable
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm exec husky
```

> `ignore-scripts=true` is set in `.npmrc` to block postinstall scripts from running on install. This means husky won't set up git hooks automatically and should be manually executed after cloning.

The `arc89` submodule pins the reference implementation (smart contract, ARC-56 spec, Python SDK and conformance
vectors) the SDK is at parity with.

### Tests

Integration tests run against an AlgoKit LocalNet. Install the AlgoKit CLI and Docker, and make sure Docker is
running before starting LocalNet:

```sh
algokit localnet start
pnpm run test
```

To check that the built package imports by name from both ESM and CommonJS (CI runs this too):

```sh
pnpm run build && pnpm run check:package
```

### Code quality

Before opening a pull request, check formatting, lint and build the package, and run the tests above:

```sh
pnpm run format:check
pnpm run lint
pnpm run build
```

Use `pnpm run format` to apply formatting fixes.

This project uses **Husky** and **lint-staged** to automatically lint and format staged files before they are committed.

Use Conventional Commits, for example `docs: clarify setup`, `fix: handle missing metadata` or `feat: add a reader`.
CI checks commit messages, and releases are determined from commit types.

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

## Dependency Management

This SDK has no runtime dependencies; this keeps things lean for consumers and avoids security issues from packages we don't control. The published package includes compiled JavaScript and TypeScript declarations in `dist`, plus the generated AVM TypeScript source in `src/generated/avm`. All dependencies are either `devDependencies` (build/test tooling) or `peerDependencies` (installed by the consumer).

### Supply chain protections (`pnpm-workspace.yaml`)

`packageManager` pins pnpm 10.34.7 with the SHA-512 hash of its tarball, so Corepack verifies the download before running it. Change the version with `corepack use pnpm@<version>`, which writes the new hash. These settings need pnpm 10.26 or later, and they live in `pnpm-workspace.yaml` because pnpm 11 and later read only auth and registry settings from `.npmrc`.

- `ignoreScripts: true`: blocks postinstall scripts. The build is pure `tsc`, so none are needed. `.npmrc` also sets `ignore-scripts=true` for npm.
- `blockExoticSubdeps: true`: prevents transitive deps from using git repos or tarball URLs as sources.
- `minimumReleaseAge: 10080`: delays installation of newly published packages by 7 days, avoiding the window between malicious publication and detection. pnpm applies it when it resolves a version; versions already in the lockfile are not re-checked. For an urgent security fix, add the package to `minimumReleaseAgeExclude` until the version is 7 days old.

### Version specifiers

- DevDependencies use caret ranges (`^`). The lockfile pins exact versions with SHA-512 hashes; the caret is the update policy, not what actually gets installed.
- Pre-release (alpha/beta) `@algorandfoundation/*` packages are pinned to exact versions. Pre-releases can break without warning, so bumps should be deliberate.
- The peer dependencies (`@algorandfoundation/algokit-utils`, `algosdk`) must support the consensus version targeted by the registry (consensus v42 / AVM 13: `algosdk` supports it from 3.7.0).

### Lockfile

- `pnpm-lock.yaml` is committed. It's what makes installs reproducible.
- CI runs `pnpm install --frozen-lockfile --ignore-scripts`.
- Postinstall scripts are blocked as a supply chain precaution.

### Transitive dependency overrides (`overrides` in `pnpm-workspace.yaml`)

- Only add an override when `pnpm audit --audit-level=high` reports a vulnerability with no upstream fix yet.
- Use conditional range syntax (e.g. `rollup@>=4.0.0 <4.59.0: >=4.59.0`) to limit the override to the affected range.
- Review quarterly: re-run `pnpm audit` without overrides to drop any that are no longer needed.

### Audit exceptions (`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`)

- Only ignore an advisory when no fixed version exists (so no override can help) and the vulnerable code cannot receive untrusted input in this repo.
- List each ignored advisory below with its reason, and review them quarterly together with the overrides.
- `GHSA-vfj7-8cjw-p6xm` (`braces` <= 3.0.3, stack exhaustion through deeply nested patterns): reached only through `semantic-release` (`micromatch`), which runs in the release workflow on glob patterns from this repo's own configuration.

### Updates

- Dependabot proposes grouped minor+patch updates monthly, with a 7-day `cooldown` that matches `minimumReleaseAge`. GitHub Actions updates use the same 7-day `cooldown`.
- Actions are pinned to a full commit SHA, with the version in a trailing comment.
- Security updates run on their own schedule in repo settings, outside the monthly batch.
