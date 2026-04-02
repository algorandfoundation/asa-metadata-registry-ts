# Contributing

## Dependency Management

This SDK has no runtime dependencies; this keeps things lean for consumers and avoids security issues from packages we don't control. The published package is TypeScript-compiled output only. All dependencies are either `devDependencies` (build/test tooling) or `peerDependencies` (installed by the consumer).

### Supply chain protections (`.npmrc`)

- `ignore-scripts=true`: blocks postinstall scripts. The build is pure `tsc`, so none are needed.
- `block-exotic-subdeps=true`: prevents transitive deps from using git repos or tarball URLs as sources.
- `minimum-release-age=10080`: delays installation of newly published packages by 7 days, avoiding the window between malicious publication and detection.

### Version specifiers

- DevDependencies use caret ranges (`^`). The lockfile pins exact versions with SHA-512 hashes; the caret is the update policy, not what actually gets installed.
- `@algorandfoundation/*` alpha packages are pinned to exact versions. Pre-releases can break without warning, so bumps should be deliberate.

### Lockfile

- `pnpm-lock.yaml` is committed. It's what makes installs reproducible.
- CI runs `pnpm install --frozen-lockfile --ignore-scripts`.
- Postinstall scripts are blocked as a supply chain precaution.

### Transitive dependency overrides (`pnpm.overrides`)

- Only add an override when `pnpm audit --audit-level=high` reports a vulnerability with no upstream fix yet.
- Use conditional range syntax (e.g. `rollup@>=4.0.0 <4.59.0: >=4.59.0`) to limit the override to the affected range.
- Review quarterly: re-run `pnpm audit` without overrides to drop any that are no longer needed.

### Updates

- Dependabot proposes grouped minor+patch updates monthly.
- Security updates run on their own schedule in repo settings, outside the monthly batch.
