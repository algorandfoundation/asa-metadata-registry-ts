# Contributing

## Dependency Management

This SDK has no runtime dependencies; this keeps things lean for consumers and avoids security issues from packages we don't control. The published package is TypeScript-compiled output only. All dependencies are either `devDependencies` (build/test tooling) or `peerDependencies` (installed by the consumer).

### Supply chain protections (`pnpm-workspace.yaml`)

`packageManager` pins pnpm 10.34.6. These settings need pnpm 10.26 or later, and they live in `pnpm-workspace.yaml` because pnpm 11 and later read only auth and registry settings from `.npmrc`.

- `ignoreScripts: true`: blocks postinstall scripts. The build is pure `tsc`, so none are needed. `.npmrc` also sets `ignore-scripts=true` for npm.
- `blockExoticSubdeps: true`: prevents transitive deps from using git repos or tarball URLs as sources.
- `minimumReleaseAge: 10080`: delays installation of newly published packages by 7 days, avoiding the window between malicious publication and detection. pnpm applies it when it resolves a version; versions already in the lockfile are not re-checked. For an urgent security fix, add the package to `minimumReleaseAgeExclude` until the version is 7 days old.

### Version specifiers

- DevDependencies use caret ranges (`^`). The lockfile pins exact versions with SHA-512 hashes; the caret is the update policy, not what actually gets installed.
- Pre-release (alpha/beta) `@algorandfoundation/*` packages are pinned to exact versions. Pre-releases can break without warning, so bumps should be deliberate.
- The peer dependencies (`@algorandfoundation/algokit-utils`, `algosdk`) must support the consensus version targeted by the registry (consensus v42 / AVM 13 requires `algosdk` >= 3.7 for 4 KB app args).

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

- Dependabot proposes grouped minor+patch updates monthly, with a 7-day `cooldown` that matches `minimumReleaseAge`.
- Security updates run on their own schedule in repo settings, outside the monthly batch.
