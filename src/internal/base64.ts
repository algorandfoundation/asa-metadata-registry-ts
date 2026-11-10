/**
 * Base64 helpers built on `btoa` and `atob`, which every runtime has (browsers have no `Buffer`).
 */

const STRICT_B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// Limit arguments per String.fromCharCode call to avoid exceeding engine stack limits.
const CHARS_PER_CALL = 0x1000

// `atob` coerces its argument with String(), so `null` would decode as the base64 text 'null'
const assertString: (s: unknown, name: string) => asserts s is string = (s, name) => {
  if (typeof s !== 'string') throw new TypeError(`${name} must be a string`)
}

/** Standard base64 (with padding). */
export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHARS_PER_CALL) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHARS_PER_CALL))
  }
  return btoa(binary)
}

/**
 * Standard base64 decode with the forgiving rules of `atob`: padding can be left out, but must be
 * correct when present, and ASCII whitespace is ignored.
 *
 * @throws {TypeError} If the input is not a string.
 * @throws {Error} If the input has characters outside the standard alphabet, misplaced padding, or
 * an impossible length.
 */
export const decodeBase64 = (s: string): Uint8Array => {
  assertString(s, 'base64 input')
  let binary: string
  try {
    binary = atob(s)
  } catch (e) {
    throw new Error('Invalid base64', { cause: e })
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Standard base64 decode mirroring Python's `base64.b64decode(..., validate=True)`:
 * only standard alphabet characters, with mandatory and well-placed padding.
 *
 * @throws {TypeError} If the input is not a string.
 * @throws {Error} If the input is not strictly valid standard base64.
 */
export const b64DecodeStrict = (s: string): Uint8Array => {
  assertString(s, 'base64 input')
  if (!STRICT_B64_RE.test(s)) throw new Error('Invalid base64')
  return decodeBase64(s)
}
