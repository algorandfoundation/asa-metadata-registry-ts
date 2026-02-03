import { describe, expect, onTestFinished, test } from 'vitest'
import { constants as c } from '@algorandfoundation/asa-metadata-registry-sdk'

describe('constants', () => {
  test('validate size constraints', ({ task }) => {
    expect(c.HEADER_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE - c.ARC4_RETURN_PREFIX_SIZE)
    expect(c.MAX_METADATA_SIZE).toBeLessThanOrEqual(c.MAX_BOX_SIZE - c.HEADER_SIZE)
    expect(c.MAX_PAGES).toBe(Math.ceil(c.MAX_METADATA_SIZE / c.PAGE_SIZE))
    expect(c.MAX_PAGES).toBeLessThanOrEqual(256)

    expect(c.ARC89_CREATE_METADATA_FIXED_SIZE + c.FIRST_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_EXTRA_PAYLOAD_FIXED_SIZE + c.EXTRA_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_REPLACE_METADATA_SLICE_FIXED_SIZE + c.REPLACE_PAYLOAD_MAX_SIZE).toBeLessThanOrEqual(c.MAX_ARG_SIZE)

    expect(c.ARC89_GET_METADATA_RETURN_FIXED_SIZE + c.PAGE_SIZE).toBeLessThanOrEqual(c.MAX_LOG_SIZE)

    onTestFinished(() => {
      if (task.result?.state === 'pass') {
        console.log('\nASA Metadata Registry Sizes:')
        console.log('HEADER_SIZE:\t\t\t', c.HEADER_SIZE)
        console.log('MAX_METADATA_SIZE:\t\t', c.MAX_METADATA_SIZE)
        console.log('MAX_PAGES:\t\t\t', c.MAX_PAGES)
        console.log('FIRST_PAYLOAD_MAX_SIZE:\t\t', c.FIRST_PAYLOAD_MAX_SIZE)
        console.log('EXTRA_PAYLOAD_MAX_SIZE:\t\t', c.EXTRA_PAYLOAD_MAX_SIZE)
        console.log('REPLACE_PAYLOAD_MAX_SIZE:\t', c.REPLACE_PAYLOAD_MAX_SIZE)
      }
    })
  })
})
