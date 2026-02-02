/**
 * Copy of ASA Metadata Registry smart contract constants.
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
export const MAX_ARG_SIZE = 2048 as const
export const MAX_LOG_SIZE = 1024 as const

export const FLAT_MBR = 2500 as const // microALGO
export const BYTE_MBR = 400 as const // microALGO
export const ACCOUNT_MBR = 100_000 as const // microALGO

export const APP_CALL_OP_BUDGET = 700 as const

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

// ---------------------------------------------------------------------------
// ARC-90 constants
// ---------------------------------------------------------------------------
// ARC-90 URI Structure:
//   algorand://<netauth>/app/<app_id>?box=<base64url_box_name>#<fragment>
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
export const PAGE_HASH_OP_BUDGET = 150 as const

// Method Signatures Overhead
export const ARC89_CREATE_METADATA_FIXED_SIZE =
  ARC4_METHOD_SELECTOR_SIZE + UINT64_SIZE + BYTE_SIZE + BYTE_SIZE + UINT16_SIZE + ARC4_DYNAMIC_LENGTH_SIZE

export const ARC89_EXTRA_PAYLOAD_FIXED_SIZE = ARC4_METHOD_SELECTOR_SIZE + UINT64_SIZE + ARC4_DYNAMIC_LENGTH_SIZE

export const ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE =
  ARC4_METHOD_SELECTOR_SIZE + UINT64_SIZE + UINT16_SIZE + ARC4_DYNAMIC_LENGTH_SIZE

// (bool,uint64,byte[]), ABI tuple are encoded a head(...) || tail(...)
export const ARC89_GET_METADATA_RETURN_FIXED_SIZE =
  ARC4_RETURN_PREFIX_SIZE + BOOL_SIZE + UINT64_SIZE + ARC4_DYNAMIC_LENGTH_SIZE + ARC4_DYNAMIC_LENGTH_SIZE

// Method Signatures Argument Indexes
// arc89_extra_payload(asset_id, payload)
export const ARC89_EXTRA_PAYLOAD_ARG_ASSET_ID = 1 as const
export const ARC89_EXTRA_PAYLOAD_ARG_PAYLOAD = 2 as const

// Pagination
export const FIRST_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC89_CREATE_METADATA_FIXED_SIZE
export const EXTRA_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC89_EXTRA_PAYLOAD_FIXED_SIZE
export const REPLACE_PAYLOAD_MAX_SIZE = MAX_ARG_SIZE - ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE
export const PAGE_SIZE = MAX_LOG_SIZE - ARC89_GET_METADATA_RETURN_FIXED_SIZE
export const MAX_PAGES = 31 as const

// Asset Metadata Box
export const ASSET_METADATA_BOX_KEY_SIZE = UINT64_SIZE

// Asset Metadata Box Header
export const METADATA_IDENTIFIERS_SIZE = BYTE_SIZE
export const REVERSIBLE_FLAGS_SIZE = BYTE_SIZE
export const IRREVERSIBLE_FLAGS_SIZE = BYTE_SIZE
export const METADATA_HASH_SIZE = BYTES32_SIZE
export const LAST_MODIFIED_ROUND_SIZE = UINT64_SIZE
export const DEPRECATED_BY_SIZE = UINT64_SIZE
export const HEADER_SIZE =
  METADATA_IDENTIFIERS_SIZE +
  REVERSIBLE_FLAGS_SIZE +
  IRREVERSIBLE_FLAGS_SIZE +
  METADATA_HASH_SIZE +
  LAST_MODIFIED_ROUND_SIZE +
  DEPRECATED_BY_SIZE

export const IDX_METADATA_IDENTIFIERS = 0 as const
export const IDX_REVERSIBLE_FLAGS = IDX_METADATA_IDENTIFIERS + METADATA_IDENTIFIERS_SIZE
export const IDX_IRREVERSIBLE_FLAGS = IDX_REVERSIBLE_FLAGS + REVERSIBLE_FLAGS_SIZE
export const IDX_METADATA_HASH = IDX_IRREVERSIBLE_FLAGS + IRREVERSIBLE_FLAGS_SIZE
export const IDX_LAST_MODIFIED_ROUND = IDX_METADATA_HASH + METADATA_HASH_SIZE
export const IDX_DEPRECATED_BY = IDX_LAST_MODIFIED_ROUND + LAST_MODIFIED_ROUND_SIZE

// AVM setbit/getbit opcodes bit offset (index 0 is the leftmost bit of the leftmost byte)
export const BIT_RIGHTMOST_IDENTIFIER = 8 * METADATA_IDENTIFIERS_SIZE - 1
export const BIT_RIGHTMOST_REV_FLAG = 8 * REVERSIBLE_FLAGS_SIZE - 1
export const BIT_RIGHTMOST_IRR_FLAG = 8 * IRREVERSIBLE_FLAGS_SIZE - 1

// Asset Metadata Box Body
export const IDX_METADATA = IDX_DEPRECATED_BY + DEPRECATED_BY_SIZE
export const MAX_METADATA_SIZE = FIRST_PAYLOAD_MAX_SIZE + 14 * EXTRA_PAYLOAD_MAX_SIZE
export const SHORT_METADATA_SIZE = MAX_STK_SIZE

// Domain Separators
export const HASH_DOMAIN_HEADER = utf8('arc0089/header')
export const HASH_DOMAIN_PAGE = utf8('arc0089/page')
export const HASH_DOMAIN_METADATA = utf8('arc0089/am')
