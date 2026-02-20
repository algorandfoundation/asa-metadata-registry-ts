import { describe, expect, test } from 'vitest'
import { constants as c } from '@algorandfoundation/asa-metadata-registry-sdk'

describe('constants', () => {
  test('validate size constraints', () => {
    expect(c.HEADER_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE - c.ARC4_RETURN_PREFIX_SIZE)
    expect(c.MAX_METADATA_SIZE).toBeLessThanOrEqual(c.MAX_BOX_SIZE - c.HEADER_SIZE)
    expect(c.MAX_PAGES).toBe(Math.ceil(c.MAX_METADATA_SIZE / c.PAGE_SIZE))
    expect(c.MAX_PAGES).toBeLessThanOrEqual(256)

    expect(c.ARC89_CREATE_METADATA_FIXED_SIZE + c.FIRST_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_EXTRA_PAYLOAD_FIXED_SIZE + c.EXTRA_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE + c.REPLACE_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_GET_METADATA_RETURN_FIXED_SIZE + c.PAGE_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE)
  })

  test('arc3 properties keys are in sync', () => {
    // Ensure ARC3_PROPERTIES_KEYS and individual key constants stay in sync if new ARC keys are added.
    expect(c.ARC3_PROPERTIES_KEYS).toContain(c.ARC3_PROPERTIES_KEY_ARC20)
    expect(c.ARC3_PROPERTIES_KEYS).toContain(c.ARC3_PROPERTIES_KEY_ARC62)
    expect(c.ARC3_PROPERTIES_KEYS.length).toBe(2)
  })
})
