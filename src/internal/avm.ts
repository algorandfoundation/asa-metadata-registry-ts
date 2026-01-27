import { toBytes } from './bytes'
import { asNumber, asUint64BigInt, asUint8 } from './numbers'
import { MbrDelta, PaginatedMetadata } from '../models'

export const withArgs = (params: unknown | undefined, args: unknown[]) => {
  const p = (params && typeof params === 'object') ? { ...(params as any) } : {}
  ;(p as any).args = args
  return p
}

/**
 * Extract `.returns[*].value` from AlgoKit composer results, tolerating minor shape differences.
 */
export const returnValues = (results: unknown): unknown[] => {
  if (!results || typeof results !== 'object') return []
  const returns = (results as any).returns
  if (!Array.isArray(returns)) return []
  return returns.map((r: any) => {
    if (r && typeof r === 'object') {
      if ('value' in r) return (r as any).value
      if ('returnValue' in r) return (r as any).returnValue
    }
    return r
  })
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

export const parseMbrDelta = (v: unknown): MbrDelta => {
  if (Array.isArray(v)) return MbrDelta.fromTuple(v as any)
  if (!v || typeof v !== 'object') throw new TypeError('MbrDelta must be a tuple or struct')
  const o = v as any
  return new MbrDelta({ sign: asUint8(o.sign, 'sign'), amount: asNumber(o.amount, 'amount') })
}
