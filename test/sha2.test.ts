/**
 * Unit tests for the SHA-256 and SHA-512/256 digests of src/hashing, which use the vendored
 * `@noble/hashes` code in src/internal/vendor/noble-hashes.
 *
 * They compare the digests with the FIPS 180-4 examples, and with Node `crypto` for every padding
 * case, so that a bad copy or update of the vendored code fails here.
 */

import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { sha256, sha512_256 } from '@algorandfoundation/asa-metadata-registry-sdk'

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const nodeDigest = (algorithm: string, data: Uint8Array): string => createHash(algorithm).update(data).digest('hex')

/** Deterministic pseudo-random bytes (xorshift32), so that a failure is reproducible. */
const pseudoRandomBytes = (length: number, seed: number): Uint8Array => {
  const out = new Uint8Array(length)
  let x = seed | 0 || 1
  for (let i = 0; i < length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out[i] = x & 0xff
  }
  return out
}

// FIPS 180-4 example messages (NIST "Examples with Intermediate Values").
const ABC = 'abc'
const MESSAGE_448_BITS = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
const MESSAGE_896_BITS =
  'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'
const ONE_MILLION_A = new Uint8Array(1_000_000).fill(0x61)

describe('sha256', () => {
  test.each([
    ['empty', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', ABC, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['448 bits', MESSAGE_448_BITS, '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['896 bits', MESSAGE_896_BITS, 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  ])('FIPS 180-4 example: %s', (_name, message, expected) => {
    expect(hex(sha256(utf8(message)))).toBe(expected)
  })

  test('one million "a"', () => {
    expect(hex(sha256(ONE_MILLION_A))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })
})

describe('sha512/256', () => {
  test.each([
    ['empty', '', 'c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a'],
    ['abc', ABC, '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23'],
    ['896 bits', MESSAGE_896_BITS, '3928e184fb8690f840da3988121d31be65cb9d3ef83ee6146feac861e19b563a'],
  ])('FIPS 180-4 example: %s', (_name, message, expected) => {
    expect(hex(sha512_256(utf8(message)))).toBe(expected)
  })

  test('one million "a"', () => {
    expect(hex(sha512_256(ONE_MILLION_A))).toBe('9a59a052930187a97038cae692f30708aa6491923ef5194394dc68d56c74fb21')
  })
})

describe('agreement with Node crypto', () => {
  // Every length up to three SHA-512 blocks covers all the padding cases, then a few larger messages.
  const lengths = [...Array.from({ length: 385 }, (_, i) => i), 1000, 4096, 32768, 65537]

  test.each([
    ['sha256', sha256],
    ['sha512-256', sha512_256],
  ] as const)('%s for every message length up to 384 bytes and larger ones', (algorithm, digest) => {
    for (const length of lengths) {
      const data = pseudoRandomBytes(length, length + 1)
      expect(hex(digest(data)), `length ${length}`).toBe(nodeDigest(algorithm, data))
    }
  })

  test('typed array views and Buffers', () => {
    const view = pseudoRandomBytes(300, 7).subarray(13, 213)
    const buffer = Buffer.from('ARC-89')
    for (const data of [view, buffer]) {
      expect(hex(sha256(data))).toBe(nodeDigest('sha256', data))
      expect(hex(sha512_256(data))).toBe(nodeDigest('sha512-256', data))
    }
  })
})
