/**
 * Strict JSON helpers that complement `JSON.parse` / `JSON.stringify` where Python's `json`
 * module (as configured by the Python SDK) is stricter: duplicate object names, lone UTF-16
 * surrogates and non-finite numbers are rejected, and integer literals are read exactly.
 */

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const INTEGER_LITERAL_RE = /^-?(0|[1-9][0-9]*)$/

/** True if the string contains an unpaired UTF-16 surrogate (only possible via `\uXXXX` escapes). */
export const hasLoneSurrogate = (s: string): boolean => LONE_SURROGATE_RE.test(s)

export interface JsonTextScan {
  /** First duplicated object name found, if any. */
  duplicateName: string | undefined
  /** Whether any string (object name or value) contains a lone surrogate. */
  loneSurrogate: boolean
  /** Raw (untrimmed of inner whitespace) source text of each top-level object member value. */
  topLevelMembers: Map<string, string>
}

interface Frame {
  names: Set<string> | null
  memberName?: string
  valueStart?: number
}

/**
 * Scan a JSON text that `JSON.parse` already accepted.
 *
 * The scan is iterative, so arbitrarily nested documents cannot overflow the call stack.
 */
export const scanJsonText = (text: string): JsonTextScan => {
  const stack: Frame[] = []
  const topLevelMembers = new Map<string, string>()
  let duplicateName: string | undefined
  let loneSurrogate = false
  // Last structural token: '{', '[', ',', ':' or 'v' (end of a value)
  let prev = ''

  const closeTopLevelMember = (end: number) => {
    const frame = stack[0]
    if (stack.length !== 1 || !frame?.names) return
    if (frame.memberName !== undefined && frame.valueStart !== undefined) {
      topLevelMembers.set(frame.memberName, text.slice(frame.valueStart, end).trim())
    }
    frame.memberName = undefined
    frame.valueStart = undefined
  }

  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const value = JSON.parse(text.slice(i, j + 1)) as string
      if (!loneSurrogate && hasLoneSurrogate(value)) loneSurrogate = true
      const top = stack[stack.length - 1]
      if (top?.names && (prev === '{' || prev === ',')) {
        if (top.names.has(value)) duplicateName ??= value
        top.names.add(value)
        if (stack.length === 1) top.memberName = value
      }
      prev = 'v'
      i = j + 1
      continue
    }
    switch (c) {
      case '{':
        stack.push({ names: new Set() })
        prev = '{'
        break
      case '[':
        stack.push({ names: null })
        prev = '['
        break
      case '}':
      case ']':
        if (c === '}') closeTopLevelMember(i)
        stack.pop()
        prev = 'v'
        break
      case ',':
        closeTopLevelMember(i)
        prev = ','
        break
      case ':':
        if (stack.length === 1 && stack[0]?.names) stack[0].valueStart = i + 1
        prev = ':'
        break
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        break
      default:
        prev = 'v'
    }
    i++
  }

  return { duplicateName, loneSurrogate, topLevelMembers }
}

/** Raw source text of the number literals of the objects/arrays decoded by `parseJsonStrict`. */
const numberLiterals = new WeakMap<object, Map<string, string>>()

/** `JSON.parse` reviver context (source text access, Node >= 21). */
interface ReviverContext {
  source?: string
}

function recordNumberLiteral(this: object, key: string, value: unknown, context?: ReviverContext): unknown {
  if (typeof value === 'number' && context?.source !== undefined) {
    let literals = numberLiterals.get(this)
    if (literals === undefined) {
      literals = new Map()
      numberLiterals.set(this, literals)
    }
    literals.set(key, context.source)
  }
  return value
}

/**
 * Parse a JSON text rejecting duplicate object names (RFC 8259 interoperability).
 *
 * The source text of number literals is recorded, so {@link jsonIntegerMember} can tell integer
 * literals from numbers with a fraction or exponent.
 *
 * @throws {SyntaxError} If the text is not valid JSON or has duplicate object names.
 * @returns The parsed value and the scan of the source text.
 */
export const parseJsonStrict = (text: string): { value: unknown; scan: JsonTextScan } => {
  const value: unknown = JSON.parse(text, recordNumberLiteral)
  const scan = scanJsonText(text)
  if (scan.duplicateName !== undefined) {
    throw new SyntaxError('Duplicate JSON object names are not allowed')
  }
  return { value, scan }
}

const NON_FINITE_LITERAL_OR_STRING_RE = /"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g

/**
 * `JSON.parse` that, like Python's default `json.loads`, also accepts the `NaN`, `Infinity` and
 * `-Infinity` literals (decoded as `null`: callers only inspect the document structure).
 *
 * @throws {SyntaxError} If the text is not valid JSON (with that extension).
 */
export const parseJsonAllowNonFinite = (text: string): unknown =>
  JSON.parse(text.replace(NON_FINITE_LITERAL_OR_STRING_RE, (match) => (match.startsWith('"') ? match : 'null')))

/**
 * Exact integer value of a raw JSON value text, or `undefined` if it is not an integer literal
 * (e.g. a number with a fraction or exponent, which Python decodes as `float`).
 */
export const integerLiteralValue = (raw: string): bigint | undefined =>
  INTEGER_LITERAL_RE.test(raw) ? BigInt(raw) : undefined

/**
 * Exact integer value of `holder[key]` with Python's `int` semantics, or `undefined`.
 *
 * Numbers decoded by {@link parseJsonStrict} must be integer literals (exact beyond 2^53;
 * `1.0` / `1e3` are Python floats). Other (JS-built) numbers must be safe integers.
 */
export const jsonIntegerMember = (holder: object, key: string): bigint | undefined => {
  const value = (holder as Record<string, unknown>)[key]
  if (typeof value !== 'number') return undefined
  const literal = numberLiterals.get(holder)?.get(key)
  if (literal !== undefined) return integerLiteralValue(literal)
  return Number.isSafeInteger(value) ? BigInt(value) : undefined
}

const notSerializable = (value: unknown): string | undefined => {
  if (typeof value === 'function' || typeof value === 'symbol') return typeof value
  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet
  ) {
    return (value as object).constructor.name
  }
  return undefined
}

/**
 * `JSON.stringify` that fails (like Python's `json.dumps(..., allow_nan=False)` followed by a
 * UTF-8 encode) instead of silently dropping or mangling values: non-finite numbers, lone
 * surrogates, functions, symbols, binary data, maps and sets are rejected. Values with an explicit
 * JSON representation (`toJSON`, e.g. `Date`) are serialized; `undefined` members are omitted.
 *
 * @throws {TypeError} If the value is not JSON-serializable.
 */
export const stringifyJsonStrict = (value: unknown): string | undefined =>
  JSON.stringify(value, function (this: unknown, name: string, v: unknown) {
    const original = (this as Record<string, unknown>)[name]
    const kind = notSerializable(original)
    if (kind !== undefined) throw new TypeError(`Object of type ${kind} is not JSON serializable`)
    if (hasLoneSurrogate(name)) throw new TypeError('Object names MUST NOT contain lone surrogates')
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError(`Non-finite JSON value ${String(v)} is not allowed by RFC 8259`)
    }
    if (typeof v === 'string' && hasLoneSurrogate(v)) throw new TypeError('Strings MUST NOT contain lone surrogates')
    return v
  })
