# asa-metadata-registry-ts

ASA Metadata Registry TypeScript SDK

## Devs

### Dependencies

Node: 22.17.0 (see `.nvmrc`)

```sh
git submodule update --init --recursive
pnpm install
pnpm exec husky
```

> `ignore-scripts=true` is set in `.npmrc` to block postinstall scripts from running on install. This means husky won't set up git hooks automatically and should be manually executed after cloning.

### Code Quality

```sh
pnpm run format
pnpm run lint
```

This project uses **Husky** and **lint-staged** to automatically lint and format staged files before they are committed.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dependency policy and lockfile rules.
