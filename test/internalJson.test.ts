/**
 * Unit tests for the strict JSON helpers in src/internal/json.
 *
 * These helpers make `JSON.parse` / `JSON.stringify` as strict as the Python SDK's `json` usage
 * (duplicate names, lone surrogates, non-finite numbers) and read integer literals exactly.
 */

import { describe, expect, test } from 'vitest'
import {
  hasLoneSurrogate,
  integerLiteralValue,
  jsonIntegerMember,
  parseJsonAllowNonFinite,
  parseJsonStrict,
  scanJsonText,
  stringifyJsonStrict,
} from '@/internal/json'

describe('hasLoneSurrogate', () => {
  test.each([
    ['plain ascii', 'abc', false],
    ['astral pair', '😀', false],
    ['lone high', 'a\ud83db', true],
    ['lone low', 'a\ude00b', true],
    ['reversed pair', '\ude00\ud83d', true],
    ['trailing high', 'abc\ud83d', true],
  ])('%s', (_name, value, expected) => {
    expect(hasLoneSurrogate(value)).toBe(expected)
  })
})

describe('scanJsonText', () => {
  test('detects duplicate names after unescaping', () => {
    expect(scanJsonText('{"a":1,"\\u0061":2}').duplicateName).toBe('a')
  })

  test('detects duplicate names in nested objects', () => {
    expect(scanJsonText('{"x":{"b":1,"b":2}}').duplicateName).toBe('b')
  })

  test('same name in different objects is not a duplicate', () => {
    expect(scanJsonText('{"a":{"a":1},"b":[{"a":1},{"a":2}]}').duplicateName).toBeUndefined()
  })

  test('string values are not names', () => {
    expect(scanJsonText('{"a":"a","b":["a","a"]}').duplicateName).toBeUndefined()
  })

  test('escaped quotes and backslashes do not end strings early', () => {
    const scan = scanJsonText('{"k\\"\\\\":"v\\"}","k\\"\\\\":0}')
    expect(scan.duplicateName).toBe('k"\\')
  })

  test('detects lone surrogate escapes in names and values', () => {
    expect(scanJsonText('{"a":"\\ud800"}').loneSurrogate).toBe(true)
    expect(scanJsonText('{"\\udc00":1}').loneSurrogate).toBe(true)
    expect(scanJsonText('{"a":"\\ud83d\\ude00"}').loneSurrogate).toBe(false)
    expect(scanJsonText('["\\ud83d","\\ude00"]').loneSurrogate).toBe(true)
  })

  test('captures raw top-level member values', () => {
    const scan = scanJsonText(' { "n" : 18446744073709551615 , "o":{"x":[1,2]},"s":"a,b}" , "f": 1.0 } ')
    expect(scan.topLevelMembers.get('n')).toBe('18446744073709551615')
    expect(scan.topLevelMembers.get('o')).toBe('{"x":[1,2]}')
    expect(scan.topLevelMembers.get('s')).toBe('"a,b}"')
    expect(scan.topLevelMembers.get('f')).toBe('1.0')
    expect(scan.topLevelMembers.has('x')).toBe(false)
  })

  test('non-object documents have no top-level members', () => {
    expect(scanJsonText('[{"a":1}]').topLevelMembers.size).toBe(0)
  })

  test('deeply nested documents do not overflow the stack', () => {
    const depth = 20_000
    const text = '['.repeat(depth) + ']'.repeat(depth)
    expect(scanJsonText(text).duplicateName).toBeUndefined()
  })
})

describe('parseJsonStrict', () => {
  test('parses valid JSON', () => {
    expect(parseJsonStrict('{"a":[1,"b"]}').value).toEqual({ a: [1, 'b'] })
  })

  test('rejects duplicate names', () => {
    expect(() => parseJsonStrict('{"a":1,"a":2}')).toThrow('Duplicate JSON object names are not allowed')
  })

  test('decoded members read like plain JSON values', () => {
    const obj = parseJsonStrict('{"a":1.0,"b":[6.0,7],"c":-0,"d":1.5}').value as Record<string, unknown>
    const plain = { a: 1, b: [6, 7], c: -0, d: 1.5 }
    expect(obj).toEqual(plain)
    expect({ ...obj }).toEqual(plain)
    expect(structuredClone(obj)).toEqual(plain)
    expect(Object.keys(obj)).toEqual(['a', 'b', 'c', 'd'])
    expect(JSON.stringify(obj)).toBe('{"a":1,"b":[6,7],"c":0,"d":1.5}')
  })

  test('only number members such as 1.0 and -0 are accessors', () => {
    const obj = parseJsonStrict('{"a":1.0,"b":-0,"c":9007199254740993,"d":6,"e":1.5}').value as Record<string, unknown>
    expect(Object.getOwnPropertyDescriptor(obj, 'a')?.get).toBeTypeOf('function')
    expect(Object.getOwnPropertyDescriptor(obj, 'b')?.get).toBeTypeOf('function')
    for (const [key, value] of [
      ['c', 9007199254740992],
      ['d', 6],
      ['e', 1.5],
    ] as const) {
      expect(Object.getOwnPropertyDescriptor(obj, key)).toEqual({
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
  })

  test.each(['{"a":NaN}', '{"a":Infinity}', '{"a":-Infinity}', '{"a":1,}', "{'a':1}"])('rejects %s', (text) => {
    expect(() => parseJsonStrict(text)).toThrow(SyntaxError)
  })
})

describe('integerLiteralValue', () => {
  test.each([
    ['0', 0n],
    ['-0', 0n],
    ['42', 42n],
    ['18446744073709551615', 18446744073709551615n],
    ['-1', -1n],
  ])('%s is an integer literal', (raw, expected) => {
    expect(integerLiteralValue(raw)).toBe(expected)
  })

  test.each(['1.0', '1e3', '01', 'true', '"1"', '{}', ''])('%s is not an integer literal', (raw) => {
    expect(integerLiteralValue(raw)).toBeUndefined()
  })
})

describe('stringifyJsonStrict', () => {
  test('serializes compactly', () => {
    expect(stringifyJsonStrict({ a: [1, 'b'], c: { d: null } })).toBe('{"a":[1,"b"],"c":{"d":null}}')
  })

  test('writes unchanged decoded number literals verbatim', () => {
    const obj = parseJsonStrict('{"a":1.0,"b":18446744073709551615,"c":[1e20],"d":6}').value as Record<string, unknown>
    obj['d'] = 7
    expect(stringifyJsonStrict(obj)).toBe('{"a":1.0,"b":18446744073709551615,"c":[1e20],"d":7}')
  })

  test('writes decoded members assigned an equal value from that value', () => {
    const obj = parseJsonStrict('{"a":6.0,"b":-0,"c":[1.0],"d":1e3}').value as Record<string, unknown>
    obj['a'] = 6
    obj['b'] = 0
    const c = obj['c'] as number[]
    c[0] = 1
    expect(stringifyJsonStrict(obj)).toBe('{"a":6,"b":0,"c":[1],"d":1e3}')
  })

  test('writes decoded integers beyond 2^53 verbatim while their value is unchanged', () => {
    const obj = parseJsonStrict('{"a":18446744073709551615,"b":9007199254740993}').value as Record<string, unknown>
    obj['a'] = 2 ** 64
    obj['b'] = 2 ** 53 + 2
    expect(stringifyJsonStrict(obj)).toBe('{"a":18446744073709551615,"b":9007199254740994}')
  })

  test('drops the source text of deleted and redefined members', () => {
    const obj = parseJsonStrict('{"a":1.0,"b":1.0}').value as Record<string, unknown>
    delete obj['a']
    obj['a'] = 1
    Object.defineProperty(obj, 'b', { value: 1, writable: true, enumerable: true, configurable: true })
    expect(stringifyJsonStrict(obj)).toBe('{"b":1,"a":1}')
  })

  test.each([NaN, Infinity, -Infinity])('rejects non-finite %s', (n) => {
    expect(() => stringifyJsonStrict({ a: { b: [n] } })).toThrow(TypeError)
  })

  test('rejects lone surrogates in values and names', () => {
    expect(() => stringifyJsonStrict({ a: '\ud800' })).toThrow(TypeError)
    expect(() => stringifyJsonStrict({ ['\udc00']: 1 })).toThrow(TypeError)
  })

  test('accepts surrogate pairs', () => {
    expect(stringifyJsonStrict({ a: '😀' })).toBe('{"a":"😀"}')
  })

  test('applies toJSON before checking values', () => {
    expect(stringifyJsonStrict({ d: new Date(0) })).toBe('{"d":"1970-01-01T00:00:00.000Z"}')
  })

  test('omits undefined members', () => {
    expect(stringifyJsonStrict({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  test.each([
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['Uint8Array', new Uint8Array([1])],
    ['Buffer', Buffer.from([1])],
    ['ArrayBuffer', new ArrayBuffer(1)],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1])],
  ])('rejects %s values (nested and top level)', (_name, value) => {
    expect(() => stringifyJsonStrict({ a: [{ b: value }] })).toThrow(TypeError)
    expect(() => stringifyJsonStrict(value)).toThrow(/not JSON serializable/)
  })
})

describe('parseJsonAllowNonFinite', () => {
  test.each([
    ['{"a":NaN}', { a: null }],
    ['[Infinity,-Infinity]', [null, null]],
    ['{"s":"NaN Infinity -Infinity","n":NaN}', { s: 'NaN Infinity -Infinity', n: null }],
    ['{"s":"\\"NaN\\""}', { s: '"NaN"' }],
  ])('accepts %s', (text, expected) => {
    expect(parseJsonAllowNonFinite(text)).toEqual(expected)
  })

  test.each(['{"a":-NaN}', '{"a":+Infinity}', '{"a":NaNx}', '{NaN:1}', '{"a":1,}'])('rejects %s', (text) => {
    expect(() => parseJsonAllowNonFinite(text)).toThrow(SyntaxError)
  })

  test('scans an unterminated string in linear time', () => {
    const text = `{"a":"${'\\"'.repeat(50_000)}`
    const start = performance.now()
    expect(() => parseJsonAllowNonFinite(text)).toThrow(SyntaxError)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('jsonIntegerMember', () => {
  test('decoded integer literals are exact', () => {
    const obj = parseJsonStrict('{"a":18446744073709551615,"b":-0,"c":[7]}').value as Record<string, unknown>
    expect(jsonIntegerMember(obj, 'a')).toBe(18446744073709551615n)
    expect(jsonIntegerMember(obj, 'b')).toBe(0n)
    expect(jsonIntegerMember(obj['c'] as object, '0')).toBe(7n)
  })

  test.each(['1.0', '1e3', '1.5', 'true', '"1"', 'null'])('decoded %s is not an integer', (literal) => {
    const obj = parseJsonStrict(`{"a":${literal}}`).value as Record<string, unknown>
    expect(jsonIntegerMember(obj, 'a')).toBeUndefined()
  })

  test('JS-built numbers must be safe integers', () => {
    expect(jsonIntegerMember({ a: 6 }, 'a')).toBe(6n)
    expect(jsonIntegerMember({ a: 1.5 }, 'a')).toBeUndefined()
    expect(jsonIntegerMember({ a: 2 ** 64 }, 'a')).toBeUndefined()
    expect(jsonIntegerMember({ a: 6n }, 'a')).toBeUndefined()
    expect(jsonIntegerMember({}, 'a')).toBeUndefined()
  })

  test('decoded members changed after decoding use their current value', () => {
    const obj = parseJsonStrict('{"a":6,"b":123}').value as Record<string, unknown>
    obj['a'] = 6.5
    obj['b'] = 0
    expect(jsonIntegerMember(obj, 'a')).toBeUndefined()
    expect(jsonIntegerMember(obj, 'b')).toBe(0n)
  })

  test('decoded members assigned an equal value use that value', () => {
    const obj = parseJsonStrict('{"a":6.0,"b":1e3}').value as Record<string, unknown>
    obj['a'] = 6
    obj['b'] = 1000
    expect(jsonIntegerMember(obj, 'a')).toBe(6n)
    expect(jsonIntegerMember(obj, 'b')).toBe(1000n)
  })

  test('decoded integers beyond 2^53 stay exact while their value is unchanged', () => {
    const obj = parseJsonStrict('{"a":9007199254740993,"b":9007199254740993}').value as Record<string, unknown>
    obj['a'] = 2 ** 53
    obj['b'] = 2 ** 53 + 2
    expect(jsonIntegerMember(obj, 'a')).toBe(9007199254740993n)
    expect(jsonIntegerMember(obj, 'b')).toBeUndefined()
  })
})
