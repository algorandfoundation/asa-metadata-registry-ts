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

// Also expose the modules as namespaces (similar to Python's `import asa_metadata_registry.constants`).
export * as constants from './constants'
export * as flags from './flags'
export * as enums from './enums'
export * as bitmasks from './bitmasks'

// Generated ARC-56 client (excluded from translation; wrapped in later phases)
export * from './generated'
export * as generated from './generated'
