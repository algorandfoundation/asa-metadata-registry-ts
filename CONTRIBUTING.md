# Contributing

## Dependency Management

This SDK has no runtime dependencies; this keeps things lean for consumers and avoids security issues from packages we don't control. The published package is TypeScript-compiled output only. All dependencies are either `devDependencies` (build/test tooling) or `peerDependencies` (installed by the consumer).

### Version specifiers

- DevDependencies use caret ranges (`^`). The lockfile pins exact versions with SHA-512 hashes; the caret is the update policy, not what actually gets installed.
- `@algorandfoundation/*` alpha packages are pinned to exact versions. Pre-releases can break without warning, so bumps should be deliberate until stable releases are ready.

### Lockfile

- `pnpm-lock.yaml` is committed. It's what makes installs reproducible.
- CI runs `pnpm install --frozen-lockfile --ignore-scripts`, failing if the lockfile is out of sync, and blocking postinstall scripts as a supply chain precaution.

### Transitive dependency overrides (`pnpm.overrides`)

- Only add an override when `pnpm audit --audit-level=high` reports a vulnerability with no upstream fix yet.
- Use conditional range syntax (e.g. `rollup@>=4.0.0 <4.59.0: >=4.59.0`) to limit the override to the affected range.
- Review quarterly: re-run `pnpm audit` without overrides to drop any that are no longer needed.

### Updates

- Dependabot proposes grouped minor+patch updates monthly. `@algorandfoundation/*` packages are excluded from automation.
- Security updates from Dependabot run on their own schedule, outside the monthly batch.
