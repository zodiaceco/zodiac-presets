import { c } from '@zodiaceco/sdk'
import type { Address } from './kit'

export const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** Native ETH (or the chain's native token) wherever a preset takes a token. */
export const NATIVE: Address = ZERO

/** Matches `value` itself, or any of several (addresses, amounts, …). */
export const oneOf = <T>(values: readonly T[]) => {
  if (values.length === 0) throw new Error('`oneOf` needs at least one value')

  return values.length === 1 ? values[0]! : c.or(...(values as [T, T, ...T[]]))
}

/** "a", "a and b", "a, b and c". */
export const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
