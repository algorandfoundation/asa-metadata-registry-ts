/**
 * Base64 helpers built on `btoa` and `atob`, which every runtime has (browsers have no `Buffer`).
 */

const STRICT_B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// Bytes per String.fromCharCode call, below the engines' limits on the number of call arguments
const CHARS_PER_CALL = 0x8000

/** Standard base64 (with padding). */
export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHARS_PER_CALL) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHARS_PER_CALL))
  }
  return btoa(binary)
}

/**
 * Standard base64 decode with the forgiving rules of `atob`: padding is optional and ASCII
 * whitespace is ignored.
 *
 * @throws {Error} If the input has characters outside the standard alphabet, or an impossible length.
 */
export const decodeBase64 = (s: string): Uint8Array => {
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
 * @throws {Error} If the input is not strictly valid standard base64.
 */
export const b64DecodeStrict = (s: string): Uint8Array => {
  if (!STRICT_B64_RE.test(s)) throw new Error('Invalid base64')
  return decodeBase64(s)
}
