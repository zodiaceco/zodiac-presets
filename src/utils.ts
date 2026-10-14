import { c } from '@zodiaceco/sdk'
import type { Address } from './kit'

export const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** Native ETH (or the chain's native token) wherever a preset takes a token. */
export const NATIVE: Address = ZERO

/** Matches `address` itself, or any of several. */
export const oneOf = (addresses: readonly Address[]) =>
  addresses.length === 1
    ? addresses[0]!
    : c.or(...(addresses as [Address, Address, ...Address[]]))

/** "a", "a and b", "a, b and c". */
export const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
