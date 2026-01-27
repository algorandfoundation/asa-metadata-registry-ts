import { toBytes } from '../internal/bytes'
import { asUint64BigInt } from '../internal/numbers'
import { PaginatedMetadata } from '../models'

export const withArgs = (params: unknown | undefined, args: unknown[]) => {
  const p = (params && typeof params === 'object') ? { ...(params as any) } : {}
  ;(p as any).args = args
  return p
}

export const parsePaginatedMetadata = (v: unknown): PaginatedMetadata => {
  if (Array.isArray(v)) return PaginatedMetadata.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('PaginatedMetadata must be a tuple or struct')
  const o = v as any
  return new PaginatedMetadata({
    hasNextPage: Boolean(o.hasNextPage),
    lastModifiedRound: asUint64BigInt(o.lastModifiedRound, 'lastModifiedRound'),
    pageContent: toBytes(o.pageContent, 'pageContent'),
  })
}
