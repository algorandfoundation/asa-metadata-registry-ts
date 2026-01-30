const MAX_UINT64 = (1n << 64n) - 1n

export const MAX_UINT8 = 0xff

/**
 * Converts a number or bigint to bigint with safe integer validation.
 * @param v - The number or bigint to be converted.
 * @returns The value as a bigint.
 * @throws {TypeError} If the value is not a finite integer.
 * @throws {RangeError} If the number is outside the safe integer range.
 */
export const toBigInt = (v: bigint | number): bigint => {
  if (typeof v === 'bigint') return v
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    throw new TypeError('value must be an integer')
  }
  if (!Number.isSafeInteger(v)) {
    throw new RangeError('number value is not within the safe integer range (use bigint for large values)')
  }
  return BigInt(v)
}

/**
 * Same as {@link toBigInt} but validates that the value is non-negative (>= 0).
 * Does not check the uint64 upper bound (2^64-1). Throws if value is negative.
 * @param v - The number or bigint to be converted.
 * @returns The non-negative bigint.
 * @throws {TypeError} If the value is not a finite integer.
 * @throws {RangeError} If the number is outside the safe integer range or is negative.
 */
export const toNonNegativeBigInt = (v: bigint | number): bigint => {
  const result = toBigInt(v)
  if (result < 0n) throw new RangeError('value must be non-negative')
  return result
}

/**
 * Converts an unknown value into a uint64 bigint.
 * @param v - The value to convert.
 * @returns The value as a uint64 bigint.
 * @throws {TypeError} If the value is not a bigint, number, or base-10 string.
 * @throws {RangeError} If the number is outside the safe integer range, is negative, or exceeds uint64.
 */
export const toUint64BigInt = (v: unknown): bigint => {
  if (typeof v === 'bigint') {
    if (v < 0n || v > MAX_UINT64) throw new RangeError('value must fit in uint64')
    return v
  }
  if (typeof v === 'number') {
    const bi = toNonNegativeBigInt(v)
    if (bi > MAX_UINT64) throw new RangeError('value must fit in uint64')
    return bi
  }
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) {
    const x = BigInt(v)
    if (x > MAX_UINT64) throw new RangeError('value must fit in uint64')
    return x
  }
  throw new TypeError('value must be uint64')
}

/**
 * Converts an unknown value into a safe JavaScript integer (`number`).
 * Accepts either a `number` (must be finite, integer, and safe) or a `bigint`
 * (must fit within JS safe integer range) and returns a `number`.
 * @param v - The value to convert.
 * @returns The value as a safe integer `number`.
 * @throws {TypeError} If the value is not a number/bigint or is not an integer.
 * @throws {RangeError} If the value is outside the JS safe integer range.
 */
export const toNumber = (v: unknown): number => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('value must be a finite number')
    if (!Number.isInteger(v)) throw new TypeError('value must be an integer')
    if (!Number.isSafeInteger(v)) throw new RangeError('value is too large for JS number')
    return v
  }
  if (typeof v === 'bigint') {
    if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('value is too large for JS number')
    }
    return Number(v)
  }
  throw new TypeError('value must be a number or bigint')
}

/**
 * Converts an unknown value into a `uint8` as a JavaScript `number`.
 * @param v - The value to convert.
 * @returns The value as a `number` in range 0..255.
 * @throws {TypeError} If the value is not a number/bigint or is not an integer.
 * @throws {RangeError} If the value is outside the JS safe integer range or does not fit in uint8.
 */
export const toUint8 = (v: unknown): number => {
  const n = toNumber(v)
  if (n < 0 || n > MAX_UINT8) throw new RangeError('value must fit in uint8')
  return n
}

/**
 * Field-labeled parsing helpers
 *
 * These helpers wrap the corresponding `to*` converters and rethrow errors with
 * a field label prefix (e.g. "assetId: value must fit in uint64"). Use them
 * when parsing structured inputs where you want actionable, field-specific
 * error messages.
 */

export const asUint64BigInt = (v: unknown, name: string): bigint => {
  try {
    return toUint64BigInt(v)
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`${name}: ${e.message}`)
    }
    throw e
  }
}

export const asBigInt = (v: bigint | number, name: string): bigint => {
  try {
    return toNonNegativeBigInt(v)
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`${name}: ${e.message}`)
    }
    throw e
  }
}

export const asNumber = (v: unknown, name: string): number => {
  try {
    return toNumber(v)
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`${name}: ${e.message}`)
    }
    throw e
  }
}

export const asUint8 = (v: unknown, name: string): number => {
  try {
    return toUint8(v)
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`${name}: ${e.message}`)
    }
    throw e
  }
}
