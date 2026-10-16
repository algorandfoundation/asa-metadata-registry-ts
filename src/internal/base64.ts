const STRICT_B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * Standard base64 decode mirroring Python's `base64.b64decode(..., validate=True)`:
 * only standard alphabet characters, with mandatory and well-placed padding.
 *
 * @throws {Error} If the input is not strictly valid standard base64.
 */
export const b64DecodeStrict = (s: string): Uint8Array => {
  if (!STRICT_B64_RE.test(s)) throw new Error('Invalid base64')
  return new Uint8Array(Buffer.from(s, 'base64'))
}
