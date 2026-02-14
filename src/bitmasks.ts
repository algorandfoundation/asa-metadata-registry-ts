import * as flags from './flags'

/**
 * Derived bitmasks for ASA Metadata Registry flags (ported from Python `bitmasks.py`).
 */

// Metadata Identifiers byte (set by the ASA Metadata Registry; clients just read)
export const MASK_ID_SHORT = 1 << flags.ID_SHORT

// Reversible Flags byte (set by ASA Manager Address)
export const MASK_REV_ARC20 = 1 << flags.REV_FLG_ARC20
export const MASK_REV_ARC62 = 1 << flags.REV_FLG_ARC62
export const MASK_REV_NTT = 1 << flags.REV_FLG_NTT
export const MASK_REV_RESERVED_3 = 1 << flags.REV_FLG_RESERVED_3
export const MASK_REV_RESERVED_4 = 1 << flags.REV_FLG_RESERVED_4
export const MASK_REV_RESERVED_5 = 1 << flags.REV_FLG_RESERVED_5
export const MASK_REV_RESERVED_6 = 1 << flags.REV_FLG_RESERVED_6
export const MASK_REV_RESERVED_7 = 1 << flags.REV_FLG_RESERVED_7

// Irreversible Flags byte (set by ASA Manager Address)
export const MASK_IRR_ARC3 = 1 << flags.IRR_FLG_ARC3
export const MASK_IRR_ARC89 = 1 << flags.IRR_FLG_ARC89
export const MASK_IRR_ARC54 = 1 << flags.IRR_FLG_ARC54
export const MASK_IRR_RESERVED_3 = 1 << flags.IRR_FLG_RESERVED_3
export const MASK_IRR_RESERVED_4 = 1 << flags.IRR_FLG_RESERVED_4
export const MASK_IRR_RESERVED_5 = 1 << flags.IRR_FLG_RESERVED_5
export const MASK_IRR_RESERVED_6 = 1 << flags.IRR_FLG_RESERVED_6
export const MASK_IRR_IMMUTABLE = 1 << flags.IRR_FLG_IMMUTABLE
