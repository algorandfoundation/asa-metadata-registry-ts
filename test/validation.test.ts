/**
 * Unit tests for src/validation module.
 *
 * Ported from Python `tests/sdk/test_validation.py`.
 */

import { describe, expect, test } from 'vitest'
import {
  InvalidArc3PropertiesError,
  MetadataArc3Error,
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

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('is positive uint64', () => {
  // Test isPositiveUint64 helper.
  test.each([
    [1, true],
    // Python: (2**64 - 1, True). TS validates JSON-parsed numbers, exact only up to 2^53 - 1.
    [Number.MAX_SAFE_INTEGER, true],
    [0, false],
    [-1, false],
    [2 ** 64, false],
    [Number.MAX_SAFE_INTEGER + 1, false], // TS-only: not exactly representable
    // Python: (1.0, False). JS has no distinct float 1.0 (1.0 === 1): use a non-integer number.
    [1.5, false],
    ['1', false],
    [null, false],
    [undefined, false], // TS-only
  ])('isPositiveUint64(%o) => %s', (value, expected) => {
    expect(isPositiveUint64(value)).toBe(expected)
  })

  test('JSON float literal 1.0 is not a positive uint64', () => {
    // Python decodes the JSON literal `1.0` as a float, which `is_positive_uint64` rejects; the TS
    // validators check members of decoded metadata against their source literal (Python `int` semantics).
    const body = decodeMetadataJson(utf8('{"properties":{"arc-20":{"application-id":1.0}}}'))
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(InvalidArc3PropertiesError)
  })
})

describe('encode metadata json', () => {
  test('roundtrip unicode', () => {
    const obj = { name: 'caffè', n: 1 }
    const data = encodeMetadataJson(obj)
    expect(data).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder('utf-8', { fatal: true }).decode(data)).toBeTruthy() // decodes
    expect(decodeMetadataJson(data)).toEqual(obj)
  })

  test('rejects non serializable', () => {
    // Python uses `object()`; BigInt is the JS value `JSON.stringify` cannot serialize.
    const obj = { x: 1n } as unknown as Record<string, unknown>
    expect(() => encodeMetadataJson(obj)).toThrow(MetadataEncodingError)
    expect(() => encodeMetadataJson(obj)).toThrow(/JSON-serializable/)
  })

  test('rejects function values', () => {
    // Python's `json.dumps` raises on any non-JSON value; `JSON.stringify` would silently drop functions.
    expect(() => encodeMetadataJson({ x: () => 1 })).toThrow(MetadataEncodingError)
  })
})

describe('validate arc3 values', () => {
  test('decimals optional', () => {
    validateArc3Values({}, 6) // should not throw
  })

  test('decimals must match asset decimals', () => {
    expect(() => validateArc3Values({ decimals: 0 }, 6)).toThrow(MetadataArc3Error)
    expect(() => validateArc3Values({ decimals: 0 }, 6)).toThrow(/must match ASA decimals/)
  })

  test('decimals wrong type', () => {
    expect(() => validateArc3Values({ decimals: '6' }, 6)).toThrow(MetadataArc3Error)
    expect(() => validateArc3Values({ decimals: '6' }, 6)).toThrow(/must be an integer/)
  })

  test('decimals must be int not bool', () => {
    expect(() => validateArc3Values({ decimals: true }, 6)).toThrow(MetadataArc3Error)
    expect(() => validateArc3Values({ decimals: true }, 6)).toThrow(/must be an integer/)
    expect(() => validateArc3Values({ decimals: false }, 6)).toThrow(MetadataArc3Error)
    expect(() => validateArc3Values({ decimals: false }, 6)).toThrow(/must be an integer/)
  })

  test('decimals matches', () => {
    validateArc3Values({ decimals: 6 }, 6) // should not throw
  })

  // TS-only: decoded metadata members keep Python `int` semantics (float literals are not integers).
  test.each(['{"decimals":6.0}', '{"decimals":6e0}'])('decimals float literal %s raises', (raw) => {
    const obj = decodeMetadataJson(utf8(raw))
    expect(() => validateArc3Values(obj, 6)).toThrow(MetadataArc3Error)
    expect(() => validateArc3Values(obj, 6)).toThrow("ARC-3 field 'decimals' must be an integer, got float")
  })

  test('decimals integer literal matches', () => {
    validateArc3Values(decodeMetadataJson(utf8('{"decimals":6}')), 6) // should not throw
  })
})

describe('is arc3 metadata', () => {
  test('true when has indicator fields', () => {
    expect(isArc3Metadata({ decimals: 0 })).toBe(true)
    expect(isArc3Metadata({ properties: {} })).toBe(true)
    expect(isArc3Metadata({ localization: {} })).toBe(true)
  })

  test('false for generic only', () => {
    expect(isArc3Metadata({ name: 'x', description: 'y' })).toBe(false)
  })
})

describe('validate arc20 arc62 require arc3', () => {
  test('allows when no arc20 no arc62', () => {
    validateArc20Arc62RequireArc3({ revArc20: false, revArc62: false, irrArc3: false }) // should not throw
  })

  test('allows when arc3 true', () => {
    validateArc20Arc62RequireArc3({ revArc20: true, revArc62: false, irrArc3: true })
    validateArc20Arc62RequireArc3({ revArc20: false, revArc62: true, irrArc3: true })
  })

  test('rejects when arc20 or arc62 without arc3', () => {
    const arc20Only = { revArc20: true, revArc62: false, irrArc3: false }
    const arc62Only = { revArc20: false, revArc62: true, irrArc3: false }
    expect(() => validateArc20Arc62RequireArc3(arc20Only)).toThrow(MetadataArc3Error)
    expect(() => validateArc20Arc62RequireArc3(arc20Only)).toThrow(/require ARC-3/)
    expect(() => validateArc20Arc62RequireArc3(arc62Only)).toThrow(MetadataArc3Error)
    expect(() => validateArc20Arc62RequireArc3(arc62Only)).toThrow(/require ARC-3/)
  })
})

describe('validate arc3 properties', () => {
  test('requires properties object', () => {
    expect(() => validateArc3Properties({}, 'arc-20')).toThrow(InvalidArc3PropertiesError)
    expect(() => validateArc3Properties({}, 'arc-20')).toThrow(/properties/)

    expect(() => validateArc3Properties({ properties: [] }, 'arc-20')).toThrow(InvalidArc3PropertiesError)
    expect(() => validateArc3Properties({ properties: [] }, 'arc-20')).toThrow(/properties/)
  })

  test('requires arc key object', () => {
    const body = { properties: { 'arc-20': 1 } }
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(InvalidArc3PropertiesError)
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(/must be an object/)
  })

  test.each([null, 0, -1, 2 ** 64, '1'])('requires application id positive uint64 (%o)', (appId) => {
    const body = { properties: { 'arc-20': { 'application-id': appId } } }
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(InvalidArc3PropertiesError)
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(/application-id/)
  })

  const invalidBodies: readonly (readonly [string, Record<string, unknown>])[] = [
    ['no_properties', {}],
    ['properties_not_dict', { properties: 'not-a-dict' }],
    ['missing_arc_key', { properties: { 'other-key': 1 } }],
    ['arc_key_not_dict', { properties: { 'arc-20': 'not-a-dict', 'arc-62': 'not-a-dict' } }],
    ['missing_application_id', { properties: { 'arc-20': {}, 'arc-62': {} } }],
    ['app_id_zero', { properties: { 'arc-20': { 'application-id': 0 }, 'arc-62': { 'application-id': 0 } } }],
    ['app_id_negative', { properties: { 'arc-20': { 'application-id': -1 }, 'arc-62': { 'application-id': -1 } } }],
    ['app_id_string', { properties: { 'arc-20': { 'application-id': '123' }, 'arc-62': { 'application-id': '123' } } }],
    [
      'app_id_overflow',
      { properties: { 'arc-20': { 'application-id': 2 ** 64 }, 'arc-62': { 'application-id': 2 ** 64 } } },
    ],
  ]
  const arcKeys = ['arc-20', 'arc-62'] as const

  test.each(arcKeys.flatMap((arcKey) => invalidBodies.map(([id, body]) => [id, arcKey, body] as const)))(
    'invalid raises: %s (%s)',
    (_id, arcKey, body) => {
      // Test invalid properties raises.
      expect(() => validateArc3Properties(body, arcKey)).toThrow(InvalidArc3PropertiesError)
    },
  )

  test.each(arcKeys)('valid passes (%s)', (arcKey) => {
    // Test valid properties passes.
    const body = { properties: { [arcKey]: { 'application-id': 123456 } } }
    validateArc3Properties(body, arcKey) // should not throw
  })

  // TS-only: application IDs of decoded metadata are read exactly from their literal, beyond 2^53.
  test.each(['9007199254740993', '18446744073709551615'])('decoded large application id %s passes', (appId) => {
    const body = decodeMetadataJson(utf8(`{"properties":{"arc-20":{"application-id":${appId}}}}`))
    validateArc3Properties(body, 'arc-20') // should not throw
  })

  test.each(['18446744073709551616', '1e3', '0', '-1'])('decoded invalid application id %s raises', (appId) => {
    const body = decodeMetadataJson(utf8(`{"properties":{"arc-20":{"application-id":${appId}}}}`))
    expect(() => validateArc3Properties(body, 'arc-20')).toThrow(InvalidArc3PropertiesError)
  })
})

describe('decode metadata json profile', () => {
  test('rejects duplicate top level names', () => {
    expect(() => decodeMetadataJson(utf8('{"a": 1, "a": 2}'))).toThrow(MetadataEncodingError)
    expect(() => decodeMetadataJson(utf8('{"a": 1, "a": 2}'))).toThrow(/Duplicate/)
  })

  test('rejects duplicate nested names', () => {
    expect(() => decodeMetadataJson(utf8('{"a": {"b": 1, "b": 2}}'))).toThrow(MetadataEncodingError)
    expect(() => decodeMetadataJson(utf8('{"a": {"b": 1, "b": 2}}'))).toThrow(/Duplicate/)
  })

  test.each(['{"x":"\\ud800"}', '{"\\udc00":1}', '{"a":["ok","\\ud800"]}'])('rejects lone surrogates (%s)', (raw) => {
    expect(() => decodeMetadataJson(utf8(raw))).toThrow(MetadataEncodingError)
    expect(() => decodeMetadataJson(utf8(raw))).toThrow(/lone surrogate/)
  })

  test('accepts surrogate pairs', () => {
    expect(decodeMetadataJson(utf8('{"x":"\\ud83d\\ude00"}'))).toEqual({ x: '\u{1f600}' })
  })

  test('encoder rejects lone surrogates', () => {
    expect(() => encodeMetadataJson({ x: '\ud800' })).toThrow(MetadataEncodingError)
    expect(() => encodeMetadataJson({ '\udc00': 1 })).toThrow(MetadataEncodingError) // TS-only: object name
  })

  test('accepts unique names', () => {
    expect(decodeMetadataJson(utf8('{"a": {"b": 1}, "c": 2}'))).toEqual({ a: { b: 1 }, c: 2 })
  })

  test.each(['{"x": NaN}', '{"x": Infinity}', '{"x": -Infinity}'])(
    'rejects non-finite literals %s (TS-only)',
    (raw) => {
      // Python rejects them via `parse_constant`; they are not valid JSON (RFC 8259) anyway.
      expect(() => decodeMetadataJson(utf8(raw))).toThrow(MetadataEncodingError)
      expect(() => decodeMetadataJson(utf8(raw))).toThrow(/not valid JSON/)
    },
  )

  test.each([NaN, Infinity, -Infinity])('encoder rejects non-finite number %s (TS-only)', (x) => {
    // Python: `json.dumps(..., allow_nan=False)`; `JSON.stringify` would silently emit `null`.
    expect(() => encodeMetadataJson({ x })).toThrow(MetadataEncodingError)
    expect(() => encodeMetadataJson({ x })).toThrow(/JSON-serializable/)
  })
})
