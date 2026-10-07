const asErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  try {
    return String(e)
  } catch {
    return ''
  }
}

const httpStatus = (e: unknown): number | undefined => {
  const status = (e as { response?: { status?: unknown } } | null)?.response?.status
  return typeof status === 'number' ? status : undefined
}

/** True if an Algod (algosdk) request error denotes a missing resource (HTTP 404). */
export const isNotFoundError = (e: unknown): boolean => {
  const status = httpStatus(e)
  if (status !== undefined) return status === 404
  const msg = asErrorMessage(e).toLowerCase()
  return msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')
}
