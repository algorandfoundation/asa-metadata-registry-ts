/**
 * ASA Metadata Registry TypeScript SDK
 *
 * The generated AppClient is re-exported from `./generated`.
 */

// Public leaf modules
export * from './constants.js'
export * from './flags.js'
export * from './enums.js'
export * from './bitmasks.js'
export * from './errors.js'
export * from './deployments.js'

// Pure utilities: Codec and Hashing
export * from './codec.js'
export * from './hashing.js'

// Core domain layer: Validation + Models
export * from './validation.js'
export * from './models.js'

// Box-based reads (Algod)
export * from './algod.js'
export * from './read/box.js'

// AVM-parity reads (simulate)
export * from './read/avm.js'

// Unified Algod-AVM read dispatcher
export * from './read/reader.js'

// Writes (AVM) + send helpers
export * from './write/writer.js'

// Migration helpers
export * from './migrate.js'

// Facade
export * from './registry.js'

// Also expose the modules as namespaces (similar to Python's `import asa_metadata_registry.constants`).
export * as constants from './constants.js'
export * as flags from './flags.js'
export * as enums from './enums.js'
export * as bitmasks from './bitmasks.js'

export * as codec from './codec.js'
export * as hashing from './hashing.js'

export * as validation from './validation.js'
export * as models from './models.js'

export * as algod from './algod.js'
export * as boxRead from './read/box.js'

export * as avmRead from './read/avm.js'
export * as reader from './read/reader.js'

export * as writer from './write/writer.js'

export * as migrate from './migrate.js'

export * as registry from './registry.js'

// Generated ARC-56 client
// IMPORTANT: we only export it as a namespace to avoid name collisions with the SDK's domain models.
export * as generated from './generated/index.js'
