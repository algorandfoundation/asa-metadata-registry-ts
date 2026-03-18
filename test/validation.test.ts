/**
 * Unit tests for src/validation module.
 *
 * Ported from Python `tests/sdk/test_validation.py`.
 */

import { describe, expect, test } from 'vitest'
import {
  InvalidArc3PropertiesError,
  MetadataEncodingError,
  validation,
} from '@algorandfoundation/asa-metadata-registry-sdk'

const {
  decodeMetadataJson,
  encodeMetadataJson,
  isArc3Metadata,
  isPositiveUint64,
  validateArc3Properties,
  validateArc3Values,
  validateArc20Arc62RequireArc3,
} = validation

describe('isPositiveUint64', () => {
  test.each([
    [1, true],
    [Math.pow(2, 64) - 1, true],
    [0, false],
    [-1, false],
    [Math.pow(2, 64), false],
    ['1', false],
    [null, false],
    [undefined, false],
  ])('isPositiveUint64(%s) => %s', (value, expected) => {
    expect(isPositiveUint64(value)).toBe(expected)
  })
})

describe('encodeMetadataJson', () => {
  test('roundtrip unicode', () => {
    const obj = { name: 'caffè', n: 1 }
    const data = encodeMetadataJson(obj)
    expect(data).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder('utf-8').decode(data)).toBeTruthy()
    expect(decodeMetadataJson(data)).toEqual(obj)
  })

  test('rejects non-serializable', () => {
    expect(() => encodeMetadataJson({ x: BigInt(1) } as unknown as Record<string, unknown>)).toThrow(
      MetadataEncodingError,
    )
  })
})

describe('validateArc3Values', () => {
  test('decimals optional', () => {
    validateArc3Values({}, 6) // should not throw
  })

  test('decimals must match asset decimals', () => {
    expect(() => validateArc3Values({ decimals: 0 }, 6)).toThrow(/must match ASA decimals/)
  })

  test('decimals wrong type', () => {
    expect(() => validateArc3Values({ decimals: '6' }, 6)).toThrow(/must be an integer/)
  })

  test('decimals must be int not bool - true', () => {
    expect(() => validateArc3Values({ decimals: true }, 6)).toThrow(/must be an integer/)
  })

  test('decimals must be int not bool - false', () => {
    expect(() => validateArc3Values({ decimals: false }, 6)).toThrow(/must be an integer/)
  })

  test('decimals matches', () => {
    validateArc3Values({ decimals: 6 }, 6) // should not throw
  })
})

describe('isArc3Metadata', () => {
  test('true when has indicator fields', () => {
    expect(isArc3Metadata({ decimals: 0 })).toBe(true)
    expect(isArc3Metadata({ properties: {} })).toBe(true)
    expect(isArc3Metadata({ localization: {} })).toBe(true)
  })

  test('false for generic only', () => {
    expect(isArc3Metadata({ name: 'x', description: 'y' })).toBe(false)
  })
})

describe('validateArc20Arc62RequireArc3', () => {
  test('allows when no arc20 no arc62', () => {
    validateArc20Arc62RequireArc3({ revArc20: false, revArc62: false, irrArc3: false }) // should not throw
  })

  test('allows when arc3 true', () => {
    validateArc20Arc62RequireArc3({ revArc20: true, revArc62: false, irrArc3: true })
    validateArc20Arc62RequireArc3({ revArc20: false, revArc62: true, irrArc3: true })
  })

  test('rejects when arc20 or arc62 without arc3', () => {
    expect(() => validateArc20Arc62RequireArc3({ revArc20: true, revArc62: false, irrArc3: false })).toThrow(
      /require ARC-3/,
    )
    expect(() => validateArc20Arc62RequireArc3({ revArc20: false, revArc62: true, irrArc3: false })).toThrow(
      /require ARC-3/,
    )
  })
})

describe('validateArc3Properties', () => {
  test('requires properties object', () => {
    expect(() => validateArc3Properties({}, 'arc-20')).toThrow(InvalidArc3PropertiesError)
    expect(() => validateArc3Properties({ properties: [] }, 'arc-20')).toThrow(InvalidArc3PropertiesError)
  })

  test('requires arc key object', () => {
    expect(() => validateArc3Properties({ properties: { 'arc-20': 1 } }, 'arc-20')).toThrow(InvalidArc3PropertiesError)
  })

  test.each([null, 0, Math.pow(2, 64), '1'])('requires application-id positive uint64 (%s)', (appId) => {
    expect(() => validateArc3Properties({ properties: { 'arc-20': { 'application-id': appId } } }, 'arc-20')).toThrow(
      InvalidArc3PropertiesError,
    )
  })

  test.each(['arc-20', 'arc-62'] as const)('invalid bodies raise for %s', (arcKey) => {
    const bodies: Record<string, unknown>[] = [
      {}, // no_properties
      { properties: 'not-a-dict' }, // properties_not_dict
      { properties: { 'other-key': 1 } }, // missing_arc_key
      { properties: { 'arc-20': 'not-a-dict', 'arc-62': 'not-a-dict' } }, // arc_key_not_dict
      { properties: { 'arc-20': {}, 'arc-62': {} } }, // missing_application_id
      {
        properties: {
          'arc-20': { 'application-id': 0 },
          'arc-62': { 'application-id': 0 },
        },
      }, // app_id_zero
      {
        properties: {
          'arc-20': { 'application-id': -1 },
          'arc-62': { 'application-id': -1 },
        },
      }, // app_id_negative
      {
        properties: {
          'arc-20': { 'application-id': '123' },
          'arc-62': { 'application-id': '123' },
        },
      }, // app_id_string
      {
        properties: {
          'arc-20': { 'application-id': Math.pow(2, 64) },
          'arc-62': { 'application-id': Math.pow(2, 64) },
        },
      }, // app_id_overflow
    ]
    for (const body of bodies) {
      expect(() => validateArc3Properties(body, arcKey)).toThrow(InvalidArc3PropertiesError)
    }
  })

  test.each(['arc-20', 'arc-62'] as const)('valid passes for %s', (arcKey) => {
    const body = { properties: { [arcKey]: { 'application-id': 123456 } } }
    validateArc3Properties(body, arcKey) // should not throw
  })
})
