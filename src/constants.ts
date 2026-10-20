/**
 * ASA Metadata Registry SDK constants.
 *
 * Ported from Python `asa_metadata_registry/constants.py`.
 */

// Small helpers to represent Python `bytes` constants as `Uint8Array`.
const textEncoder = new TextEncoder()
const utf8 = (s: string): Uint8Array => textEncoder.encode(s)
const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

// ---------------------------------------------------------------------------
// Algorand constants
// ---------------------------------------------------------------------------
export const MAINNET_GH_B64 = 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=' as const
export const TESTNET_GH_B64 = 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=' as const

// ---------------------------------------------------------------------------
// AVM constants
// ---------------------------------------------------------------------------
export const MAX_BOX_SIZE = 32768 as const
export const MAX_STK_SIZE = 4096 as const
export const MAX_ARG_SIZE = 4096 as const
export const MAX_LOG_SIZE = 1024 as const

export const FLAT_MBR = 2500 as const // microALGO
export const BYTE_MBR = 400 as const // microALGO
export const ACCOUNT_MBR = 100_000 as const // microALGO

export const APP_CALL_OP_BUDGET = 700 as const

// ---------------------------------------------------------------------------
// ARC-2 constants
// ---------------------------------------------------------------------------
export const ARC2_ARC_NUMBER = utf8('arc89')
export const ARC2_DATA_FORMAT_JSON = utf8(':j')

// ---------------------------------------------------------------------------
// Atomic group constants
// ---------------------------------------------------------------------------
export const MAX_GROUP_SIZE = 16 as const

// ---------------------------------------------------------------------------
// ARC-4 constants
// ---------------------------------------------------------------------------
// ABI Types Byte Sizes
export const BOOL_SIZE = 1 as const

export const UINT8_SIZE = 1 as const
export const UINT16_SIZE = 2 as const
export const UINT32_SIZE = 4 as const
export const UINT64_SIZE = 8 as const

export const BYTE_SIZE = 1 as const
export const BYTES32_SIZE = 32 as const

// ARC-4 ABI Encoding
export const ARC4_METHOD_SELECTOR_ARG = 0 as const
export const ARC4_METHOD_SELECTOR_SIZE = 4 as const
export const ARC4_RETURN_PREFIX_SIZE = 4 as const
export const ARC4_DYNAMIC_LENGTH_SIZE = 2 as const

// ---------------------------------------------------------------------------
// ARC-3 constants
// ---------------------------------------------------------------------------
export const ARC3_NAME = utf8('arc3')
export const ARC3_NAME_SUFFIX = utf8('@arc3')
export const ARC3_URL_SUFFIX = utf8('#arc3')
export const ARC3_HASH_AM_PREFIX = utf8('arc0003/am')
export const ARC3_HASH_AMJ_PREFIX = utf8('arc0003/amj')
export const ARC3_PROPERTIES_KEY_ARC20 = 'arc-20' as const
export const ARC3_PROPERTIES_KEY_ARC62 = 'arc-62' as const
export const ARC3_PROPERTIES_KEYS = [ARC3_PROPERTIES_KEY_ARC20, ARC3_PROPERTIES_KEY_ARC62] as const // SDK only

// ---------------------------------------------------------------------------
// ARC-90 constants
// ---------------------------------------------------------------------------
// ARC-90 URI Structure:
//   algorand://<netauth>/app/<app_id>?box=<base64url_box_name>#<fragment>
//
// Examples:
//   - TestNet:  algorand://net:testnet/app/772968354?box=AAAAAAAAAAE#arc89
//   - LocalNet: algorand://net:localnet/app/1002?box=AAAAAAAAA-w#arc3
//   - MainNet:  algorand://app/123456789?box=AAAAAAAAAAE#arc89
export const ARC90_URI_SCHEME_NAME = utf8('algorand')
export const ARC90_URI_APP_PATH_NAME = utf8('app')
export const ARC90_URI_BOX_QUERY_NAME = utf8('box')

export const ARC90_URI_PATH_SEP = utf8('/')

export const ARC90_URI_SCHEME = concatBytes(ARC90_URI_SCHEME_NAME, utf8('://'))
export const ARC90_URI_APP_PATH = concatBytes(ARC90_URI_APP_PATH_NAME, ARC90_URI_PATH_SEP)
export const ARC90_URI_BOX_QUERY = concatBytes(utf8('?'), ARC90_URI_BOX_QUERY_NAME, utf8('='))

// ---------------------------------------------------------------------------
// ARC-89 constants
// ---------------------------------------------------------------------------
// Opcode Budgets
export const HEADER_HASH_OP_BUDGET = 110 as const
export const PAGE_HASH_OP_BUDGET = 230 as const
export const ASA_URL_CHECK_OP_BUDGET = 400 as const
export const GROUP_TAIL_OP_BUDGET_PER_TXN = 150 as const

// (bool,uint64,byte[]), ABI tuple are encoded a head(...) || tail(...)
export const ARC89_GET_METADATA_RETURN_FIXED_SIZE =
  ARC4_RETURN_PREFIX_SIZE + BOOL_SIZE + UINT64_SIZE + ARC4_DYNAMIC_LENGTH_SIZE + ARC4_DYNAMIC_LENGTH_SIZE

// Method Signatures Argument Indexes
// arc89_extra_payload(asset_id, payload)
export const ARC89_EXTRA_PAYLOAD_ARG_ASSET_ID = 1 as const
export const ARC89_EXTRA_PAYLOAD_ARG_PAYLOAD = 2 as const

// Pagination
// Fixed length arguments occupy separate ApplicationArgs entries. They count toward
// the 16,384-byte aggregate limit but do not reduce the payload entry's 4,096-byte
// capacity; only the byte[] length prefix does.
export const FIRST_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC4_DYNAMIC_LENGTH_SIZE
export const EXTRA_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC4_DYNAMIC_LENGTH_SIZE
export const REPLACE_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC4_DYNAMIC_LENGTH_SIZE
export const PAGE_SIZE = MAX_LOG_SIZE - ARC89_GET_METADATA_RETURN_FIXED_SIZE

// Asset Metadata Box
export const ASSET_METADATA_BOX_KEY_SIZE = UINT64_SIZE

// Asset Metadata Box Header
export const METADATA_IDENTIFIERS_SIZE = BYTE_SIZE
export const REVERSIBLE_FLAGS_SIZE = BYTE_SIZE
export const IRREVERSIBLE_FLAGS_SIZE = BYTE_SIZE
export const METADATA_HASH_SIZE = BYTES32_SIZE
export const REVISION_SIZE = UINT64_SIZE
export const DEPRECATED_BY_SIZE = UINT64_SIZE
export const HEADER_SIZE =
  METADATA_IDENTIFIERS_SIZE +
  REVERSIBLE_FLAGS_SIZE +
  IRREVERSIBLE_FLAGS_SIZE +
  METADATA_HASH_SIZE +
  REVISION_SIZE +
  DEPRECATED_BY_SIZE

export const IDX_METADATA_IDENTIFIERS = 0 as const
export const IDX_REVERSIBLE_FLAGS = IDX_METADATA_IDENTIFIERS + METADATA_IDENTIFIERS_SIZE
export const IDX_IRREVERSIBLE_FLAGS = IDX_REVERSIBLE_FLAGS + REVERSIBLE_FLAGS_SIZE
export const IDX_METADATA_HASH = IDX_IRREVERSIBLE_FLAGS + IRREVERSIBLE_FLAGS_SIZE
export const IDX_REVISION = IDX_METADATA_HASH + METADATA_HASH_SIZE
export const IDX_DEPRECATED_BY = IDX_REVISION + REVISION_SIZE

// AVM setbit/getbit opcodes bit offset (index 0 is the leftmost bit of the leftmost byte)
export const BIT_RIGHTMOST_IDENTIFIER = 8 * METADATA_IDENTIFIERS_SIZE - 1
export const BIT_RIGHTMOST_REV_FLAG = 8 * REVERSIBLE_FLAGS_SIZE - 1
export const BIT_RIGHTMOST_IRR_FLAG = 8 * IRREVERSIBLE_FLAGS_SIZE - 1

// Asset Metadata Box Body
export const IDX_METADATA = IDX_DEPRECATED_BY + DEPRECATED_BY_SIZE
export const MAX_METADATA_SIZE = MAX_BOX_SIZE - HEADER_SIZE
export const MAX_PAGES = Math.ceil(MAX_METADATA_SIZE / PAGE_SIZE)
export const SHORT_METADATA_SIZE = MAX_STK_SIZE
// Sentinel `newMetadataSize` for the deletion MBR Delta quote (never a valid size)
export const DELETE_METADATA_SIZE = 0xffff as const

// Domain Separators
export const HASH_DOMAIN_HEADER = utf8('arc0089/header')
export const HASH_DOMAIN_PAGE = utf8('arc0089/page')
export const HASH_DOMAIN_METADATA = utf8('arc0089/am')
