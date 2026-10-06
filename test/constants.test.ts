import { describe, expect, test } from 'vitest'
import { constants as c } from '@algorandfoundation/asa-metadata-registry-sdk'

describe('constants', () => {
  test('validate size constraints', () => {
    expect(c.MAX_ARG_SIZE).toBe(4096)
    expect(c.HEADER_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE - c.ARC4_RETURN_PREFIX_SIZE)
    expect(c.MAX_METADATA_SIZE).toBe(c.MAX_BOX_SIZE - c.HEADER_SIZE)
    expect(c.MAX_METADATA_SIZE).toBe(32717)
    expect(c.MAX_PAGES).toBe(Math.ceil(c.MAX_METADATA_SIZE / c.PAGE_SIZE))
    expect(c.MAX_PAGES).toBe(33)
    expect(c.MAX_PAGES).toBeLessThanOrEqual(256)

    // Fixed length arguments occupy separate ApplicationArgs entries: only the byte[] length
    // prefix counts against the payload arg.
    expect(c.FIRST_PAYLOAD_MAX_SIZE).toBe(4094)
    expect(c.EXTRA_PAYLOAD_MAX_SIZE).toBe(4094)
    expect(c.REPLACE_PAYLOAD_MAX_SIZE).toBe(4094)
    expect(c.ARC4_DYNAMIC_LENGTH_SIZE + c.FIRST_PAYLOAD_MAX_SIZE).toBe(c.MAX_ARG_SIZE)
    expect(c.ARC4_DYNAMIC_LENGTH_SIZE + c.EXTRA_PAYLOAD_MAX_SIZE).toBe(c.MAX_ARG_SIZE)
    expect(c.ARC4_DYNAMIC_LENGTH_SIZE + c.REPLACE_PAYLOAD_MAX_SIZE).toBe(c.MAX_ARG_SIZE)

    expect(c.ARC89_GET_METADATA_RETURN_FIXED_SIZE + c.PAGE_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE)
  })

  test('arc89 v1.0.0 constants (TS-only)', () => {
    // Opcode budgets and the deletion MBR Delta sentinel (Python SDK v1.0.0 values)
    expect(c.HEADER_HASH_OP_BUDGET).toBe(110)
    expect(c.PAGE_HASH_OP_BUDGET).toBe(230)
    expect(c.ASA_URL_CHECK_OP_BUDGET).toBe(400)
    expect(c.GROUP_TAIL_OP_BUDGET_PER_TXN).toBe(150)
    expect(c.DELETE_METADATA_SIZE).toBe(0xffff)
    expect(c.DELETE_METADATA_SIZE).toBeGreaterThan(c.MAX_METADATA_SIZE) // never a valid size
    // `LAST_MODIFIED_ROUND_*` were renamed `REVISION_*`; the write-call fixed sizes are no longer public
    expect(c.REVISION_SIZE).toBe(c.UINT64_SIZE)
    expect(c.IDX_REVISION).toBe(c.IDX_METADATA_HASH + c.METADATA_HASH_SIZE)
    for (const removed of [
      'LAST_MODIFIED_ROUND_SIZE',
      'IDX_LAST_MODIFIED_ROUND',
      'ARC89_CREATE_METADATA_FIXED_SIZE',
      'ARC89_EXTRA_PAYLOAD_FIXED_SIZE',
      'ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE',
    ]) {
      expect(c).not.toHaveProperty(removed)
    }
  })

  test('arc3 properties keys are in sync', () => {
    // Ensure ARC3_PROPERTIES_KEYS and individual key constants stay in sync if new ARC keys are added.
    expect(c.ARC3_PROPERTIES_KEYS).toContain(c.ARC3_PROPERTIES_KEY_ARC20)
    expect(c.ARC3_PROPERTIES_KEYS).toContain(c.ARC3_PROPERTIES_KEY_ARC62)
    expect(c.ARC3_PROPERTIES_KEYS.length).toBe(2)
  })
})
