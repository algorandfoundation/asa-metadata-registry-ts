/**
 * ASA Metadata Registry TypeScript SDK
 *
 * The generated AppClient is re-exported from `./generated`.
 */

// Public leaf modules
export * from './constants'
export * from './flags'
export * from './enums'
export * from './bitmasks'
export * from './errors'
export * from './deployments'

// Pure utilities: Codec and Hashing
export * from './codec'
export * from './hashing'

// Core domain layer
export * from './validation'
export * from './models'

// Also expose the modules as namespaces (similar to Python's `import asa_metadata_registry.constants`).
export * as constants from './constants'
export * as flags from './flags'
export * as enums from './enums'
export * as bitmasks from './bitmasks'

export * as codec from './codec'
export * as hashing from './hashing'

export * as validation from './validation'
export * as models from './models'

// Generated ARC-56 client (excluded from translation; wrapped in later phases)
// IMPORTANT: we only export it as a namespace to avoid name collisions with the SDK's domain models.
export * as generated from './generated'
