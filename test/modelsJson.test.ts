/**
 * Unit tests for JSON encoding/decoding and ARC-3 validation in src/models.
 *
 * Tests cover:
 * - decodeMetadataJson
 * - encodeMetadataJson
 * - validateArc3Schema
 * - chunkMetadataPayload internal helper and MetadataBody.chunkedPayload wrapper
 */

import { describe, expect, test } from 'vitest'
import { models, validation } from '@algorandfoundation/asa-metadata-registry-sdk'
import { chunkMetadataPayload } from '@/internal/models'

const { MetadataBody } = models
const { decodeMetadataJson, encodeMetadataJson, validateArc3Schema } = validation

describe('chunk metadata payload', () => {
  // Tests for chunkMetadataPayload helper function.
  test('empty data', () => {
    // Test chunking empty data.
    const chunks = chunkMetadataPayload({ data: new Uint8Array(), headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks).toEqual([new Uint8Array()])
  })

  test('data fits in head', () => {
    // Test data that fits entirely in head chunk.
    const data = new TextEncoder().encode('hello')
    const chunks = chunkMetadataPayload({ data, headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual(data)
  })

  test('data exactly head size', () => {
    // Test data that exactly fills head chunk.
    const data = new Uint8Array(10).fill(120)
    const chunks = chunkMetadataPayload({ data, headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toEqual(data)
  })

  test('data needs one extra chunk', () => {
    // Test data that needs one extra chunk.
    const data = new Uint8Array(15).fill(120)
    const chunks = chunkMetadataPayload({ data, headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toEqual(new Uint8Array(10).fill(120))
    expect(chunks[1]).toEqual(new Uint8Array(5).fill(120))
  })

  test('data needs multiple extra chunks', () => {
    // Test data that needs multiple extra chunks.
    const data = new Uint8Array(25).fill(97)
    const chunks = chunkMetadataPayload({ data, headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks.length).toBe(4)
    expect(chunks[0]).toEqual(new Uint8Array(10).fill(97))
    expect(chunks[1]).toEqual(new Uint8Array(5).fill(97))
    expect(chunks[2]).toEqual(new Uint8Array(5).fill(97))
    expect(chunks[3]).toEqual(new Uint8Array(5).fill(97))
  })

  test('data partial last chunk', () => {
    // Test data with partial last chunk.
    const data = new Uint8Array(23).fill(98)
    const chunks = chunkMetadataPayload({ data, headMaxSize: 10, extraMaxSize: 5 })
    expect(chunks.length).toBe(4)
    expect(chunks[0]).toEqual(new Uint8Array(10).fill(98))
    expect(chunks[1]).toEqual(new Uint8Array(5).fill(98))
    expect(chunks[2]).toEqual(new Uint8Array(5).fill(98))
    expect(chunks[3]).toEqual(new Uint8Array(3).fill(98))
  })

  test('invalid head size zero', () => {
    // Test that headMaxSize=0 raises ValueError.
    expect(() =>
      chunkMetadataPayload({ data: new TextEncoder().encode('data'), headMaxSize: 0, extraMaxSize: 5 }),
    ).toThrow(/Chunk sizes must be > 0/)
  })

  test('invalid extra size zero', () => {
    // Test that extraMaxSize=0 raises ValueError.
    expect(() =>
      chunkMetadataPayload({ data: new TextEncoder().encode('data'), headMaxSize: 10, extraMaxSize: 0 }),
    ).toThrow(/Chunk sizes must be > 0/)
  })

  test('invalid negative head size', () => {
    // Test that negative headMaxSize raises ValueError.
    expect(() =>
      chunkMetadataPayload({ data: new TextEncoder().encode('data'), headMaxSize: -1, extraMaxSize: 5 }),
    ).toThrow(/Chunk sizes must be > 0/)
  })

  test('metadata body chunked payload wrapper', () => {
    // Test MetadataBody.chunkedPayload wrapper method.
    const data = new Uint8Array(25).fill(120)
    const body = new MetadataBody(data)
    const chunks = body.chunkedPayload({ firstPayloadMaxSize: 10, extraPayloadMaxSize: 5 } as any)
    expect(chunks.length).toBe(4)
    expect(chunks[0]).toEqual(new Uint8Array(10).fill(120))
    expect(chunks[1]).toEqual(new Uint8Array(5).fill(120))
    expect(chunks[2]).toEqual(new Uint8Array(5).fill(120))
    expect(chunks[3]).toEqual(new Uint8Array(5).fill(120))
  })
})

describe('decode metadata json', () => {
  // Tests for decodeMetadataJson function.
  test('empty bytes', () => {
    // Test that empty bytes decode to empty dict.
    const result = decodeMetadataJson(new Uint8Array())
    expect(result).toEqual({})
  })

  test('simple object', () => {
    // Test decoding simple JSON object.
    const data = new TextEncoder().encode('{"name":"Test","value":123}')
    const result = decodeMetadataJson(data)
    expect(result).toEqual({ name: 'Test', value: 123 })
  })

  test('nested object', () => {
    // Test decoding nested JSON object.
    const data = new TextEncoder().encode('{"outer":{"inner":"value"}}')
    const result = decodeMetadataJson(data)
    expect(result).toEqual({ outer: { inner: 'value' } })
  })

  test('unicode content', () => {
    // Test decoding JSON with Unicode characters.
    const data = new TextEncoder().encode('{"emoji":"🎉","chinese":"你好"}')
    const result = decodeMetadataJson(data)
    expect(result).toEqual({ emoji: '🎉', chinese: '你好' })
  })

  test('with utf8 bom raises', () => {
    // Test that UTF-8 BOM is rejected.
    const data = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"name":"Test"}')])
    expect(() => decodeMetadataJson(data)).toThrow(/MUST NOT include a UTF-8 BOM/)
  })

  test('invalid utf8 raises', () => {
    // Test that invalid UTF-8 raises MetadataEncodingError.
    const data = new Uint8Array([0xff, 0xfe, 0x20, 0x69, 0x6e, 0x76, 0x61, 0x6c, 0x69, 0x64])
    expect(() => decodeMetadataJson(data)).toThrow(/not valid UTF-8/)
  })

  test('invalid json raises', () => {
    // Test that invalid JSON raises MetadataEncodingError.
    const data = new TextEncoder().encode('{"invalid json')
    expect(() => decodeMetadataJson(data)).toThrow(/not valid JSON/)
  })

  test('json array raises', () => {
    // Test that JSON array (not object) raises MetadataEncodingError.
    const data = new TextEncoder().encode('[1,2,3]')
    expect(() => decodeMetadataJson(data)).toThrow(/MUST be an object/)
  })

  test('json string raises', () => {
    // Test that JSON string raises MetadataEncodingError.
    const data = new TextEncoder().encode('"just a string"')
    expect(() => decodeMetadataJson(data)).toThrow(/MUST be an object/)
  })

  test('json number raises', () => {
    // Test that JSON number raises MetadataEncodingError.
    const data = new TextEncoder().encode('42')
    expect(() => decodeMetadataJson(data)).toThrow(/MUST be an object/)
  })

  test('json null raises', () => {
    // Test that JSON null raises MetadataEncodingError.
    const data = new TextEncoder().encode('null')
    expect(() => decodeMetadataJson(data)).toThrow(/MUST be an object/)
  })
})

describe('encode metadata json', () => {
  // Tests for encodeMetadataJson function.

  test('empty dict', () => {
    // Test encoding empty dict.
    const result = encodeMetadataJson({})
    expect(result).toEqual(new TextEncoder().encode('{}'))
  })

  test('simple object', () => {
    // Test encoding simple object.
    const obj = { name: 'Test', value: 123 }
    // Note: json.dumps with separators=(',',':') produces compact JSON
    const result = encodeMetadataJson(obj)
    expect(result).toEqual(new TextEncoder().encode('{"name":"Test","value":123}'))
  })

  test('nested object', () => {
    // Test encoding nested object.
    const obj = { outer: { inner: 'value' } }
    const result = encodeMetadataJson(obj)
    expect(result).toEqual(new TextEncoder().encode('{"outer":{"inner":"value"}}'))
  })

  test('unicode content', () => {
    // Test encoding Unicode content.
    const obj = { emoji: '🎉', chinese: '你好' }
    const result = encodeMetadataJson(obj)
    // JSON.stringify preserves Unicode chars (no ASCII escaping)
    const decoded = new TextDecoder().decode(result)
    expect(decoded).toContain('🎉')
    expect(decoded).toContain('你好')
  })

  test('no utf-8 bom', () => {
    // Test that encoding doesn't produce UTF-8 BOM.
    const obj = { name: 'Test' }
    const result = encodeMetadataJson(obj)
    expect(result[0]).not.toBe(0xef)
    expect(result.slice(0, 3)).not.toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  test('non serializable raises', () => {
    // Test that non-JSON-serializable object raises MetadataEncodingError.
    // JSON.stringify silently omits functions, so we need a truly non-serializable value
    // Use a circular reference instead
    const obj: any = { name: 'test' }
    obj.circular = obj
    expect(() => encodeMetadataJson(obj)).toThrow(/not JSON-serializable/)
  })

  test('round trip', () => {
    // Test encode -> decode round trip.
    const original = { name: 'Test', value: 123, nested: { key: 'val' } }
    const encoded = encodeMetadataJson(original)
    const decoded = decodeMetadataJson(encoded)
    expect(decoded).toEqual(original)
  })
})

describe('validate arc3 schema', () => {
  // Tests for validateArc3Schema function.
  test('empty object', () => {
    // Test that empty object is valid.
    expect(() => validateArc3Schema({})).not.toThrow()
  })

  test('valid name', () => {
    // Test valid name field.
    expect(() => validateArc3Schema({ name: 'My Token' })).not.toThrow()
  })

  test('valid decimals', () => {
    // Test valid decimals field as integer.
    expect(() => validateArc3Schema({ decimals: 6 })).not.toThrow()
  })

  test('decimals zero', () => {
    // Test decimals=0 is valid.
    expect(() => validateArc3Schema({ decimals: 0 })).not.toThrow()
  })

  test('decimals string raises', () => {
    // Test that decimals as string raises.
    expect(() => validateArc3Schema({ decimals: '6' })).toThrow(/'decimals' must be an integer/)
  })

  test('decimals negative raises', () => {
    // Test that negative decimals raises.
    expect(() => validateArc3Schema({ decimals: -1 })).toThrow(/must be non-negative/)
  })

  test('decimals boolean raises', () => {
    // Test that boolean for decimals raises (even though True==1 in Python).
    expect(() => validateArc3Schema({ decimals: true })).toThrow(/'decimals' must be an integer/)
  })

  test('valid description', () => {
    // Test valid description field.
    expect(() => validateArc3Schema({ description: 'A test token' })).not.toThrow()
  })

  test('description non string raises', () => {
    // Test that non-string description raises.
    expect(() => validateArc3Schema({ description: 123 })).toThrow(/'description' must be a string/)
  })

  test('valid image', () => {
    // Test valid image field.
    expect(() => validateArc3Schema({ image: 'https://example.com/image.png' })).not.toThrow()
  })

  test('image non string raises', () => {
    // Test that non-string image raises.
    expect(() => validateArc3Schema({ image: 123 })).toThrow(/'image' must be a string/)
  })

  test('valid properties', () => {
    // Test valid properties field.
    expect(() => validateArc3Schema({ properties: { custom: 'value' } })).not.toThrow()
  })

  test('properties non object raises', () => {
    // Test that non-object properties raises.
    expect(() => validateArc3Schema({ properties: 'not an object' })).toThrow(/'properties' must be an object/)
  })

  test('valid localization', () => {
    // Test valid localization field.
    expect(() =>
      validateArc3Schema({
        localization: {
          uri: 'https://example.com/{locale}.json',
          default: 'en',
          locales: ['en', 'es', 'fr'],
        },
      }),
    ).not.toThrow()
  })

  test('localization missing uri raises', () => {
    // Test that localization without uri raises.
    expect(() =>
      validateArc3Schema({
        localization: { default: 'en', locales: ['en'] },
      }),
    ).toThrow(/must have 'uri' field/)
  })

  test('localization missing default raises', () => {
    // Test that localization without default raises.
    expect(() =>
      validateArc3Schema({
        localization: { uri: 'https://example.com', locales: ['en'] },
      }),
    ).toThrow(/must have 'default' field/)
  })

  test('localization missing locales raises', () => {
    // Test that localization without locales raises.
    expect(() =>
      validateArc3Schema({
        localization: { uri: 'https://example.com', default: 'en' },
      }),
    ).toThrow(/must have 'locales' field/)
  })

  test('localization uri non string raises', () => {
    // Test that non-string localization.uri raises.
    expect(() =>
      validateArc3Schema({
        localization: {
          uri: 123,
          default: 'en',
          locales: ['en'],
        },
      }),
    ).toThrow(/'localization.uri' must be a string/)
  })

  test('localization default non string raises', () => {
    // Test that non-string localization.default raises.
    expect(() =>
      validateArc3Schema({
        localization: {
          uri: 'https://example.com',
          default: 123,
          locales: ['en'],
        },
      }),
    ).toThrow(/'localization.default' must be a string/)
  })

  test('localization locales non array raises', () => {
    // Test that non-array localization.locales raises.
    expect(() =>
      validateArc3Schema({
        localization: {
          uri: 'https://example.com',
          default: 'en',
          locales: 'en',
        },
      }),
    ).toThrow(/'localization.locales' must be an array/)
  })

  test('localization locales non string entry raises', () => {
    // Test that non-string entry in localization.locales raises.
    expect(() =>
      validateArc3Schema({
        localization: {
          uri: 'https://example.com',
          default: 'en',
          locales: ['en', 123],
        },
      }),
    ).toThrow(/entries must be strings/)
  })

  test('valid unit name', () => {
    // Test valid unitName field.
    expect(() => validateArc3Schema({ unitName: 'TKN' })).not.toThrow()
  })

  test('unit name non string raises', () => {
    // Test that non-string unitName raises.
    expect(() => validateArc3Schema({ unitName: 123 })).toThrow(/'unitName' must be a string/)
  })

  test('valid all string fields', () => {
    // Test all valid string fields.
    expect(() =>
      validateArc3Schema({
        name: 'Token',
        description: 'Description',
        image: 'https://example.com/img.png',
        image_integrity: 'sha256-abc123',
        image_mimetype: 'image/png',
        background_color: '#FFFFFF',
        external_url: 'https://example.com',
        external_url_integrity: 'sha256-def456',
        external_url_mimetype: 'text/html',
        animation_url: 'https://example.com/anim.mp4',
        animation_url_integrity: 'sha256-ghi789',
        animation_url_mimetype: 'video/mp4',
        unitName: 'TKN',
        extra_metadata: 'extra',
      }),
    ).not.toThrow()
  })

  test('extensible custom fields', () => {
    // Test that custom fields are allowed (extensibility).
    expect(() =>
      validateArc3Schema({
        name: 'Token',
        custom_field: 'custom_value',
        another_field: 123,
      }),
    ).not.toThrow()
  })

  test('complete arc3 example', () => {
    // Test complete ARC-3 compliant metadata.
    expect(() =>
      validateArc3Schema({
        name: 'My Asset',
        decimals: 0,
        description: 'A test NFT',
        image: 'https://example.com/image.png',
        image_integrity: 'sha256-abcdef',
        properties: {
          trait1: 'value1',
          trait2: 'value2',
        },
      }),
    ).not.toThrow()
  })
})
