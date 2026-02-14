/**
 * Copy of ASA Metadata Registry smart contract flags.
 *
 * Bits in big-endian order (0 = LSB, 7 = MSB).
 *
 * ⚠️ When operating on byte arrays (instead of uint64), AVM `setbit/getbit` opcodes
 * index 0 as the leftmost bit of the leftmost byte.
 */

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

// Metadata Identifiers byte (set by the ASA Metadata Registry; clients just read)
export const ID_SHORT = 7 as const // automatically derived from metadata size

// Reversible Flags byte (set by ASA Manager Address)
export const REV_FLG_ARC20 = 0 as const
export const REV_FLG_ARC62 = 1 as const
export const REV_FLG_RESERVED_2 = 2 as const // reserved; default init False
export const REV_FLG_RESERVED_3 = 3 as const // reserved; default init False
export const REV_FLG_RESERVED_4 = 4 as const // reserved; default init False
export const REV_FLG_RESERVED_5 = 5 as const // reserved; default init False
export const REV_FLG_RESERVED_6 = 6 as const // reserved; default init False
export const REV_FLG_RESERVED_7 = 7 as const // reserved; default init False

// Irreversible Flags byte (set by ASA Manager Address)
export const IRR_FLG_ARC3 = 0 as const // creation-only
export const IRR_FLG_ARC89_NATIVE = 1 as const // creation-only
export const IRR_FLG_ARC54 = 2 as const // any time
export const IRR_FLG_RESERVED_3 = 3 as const // reserved; default init False
export const IRR_FLG_RESERVED_4 = 4 as const // reserved; default init False
export const IRR_FLG_RESERVED_5 = 5 as const // reserved; default init False
export const IRR_FLG_RESERVED_6 = 6 as const // reserved; default init False
export const IRR_FLG_IMMUTABLE = 7 as const
