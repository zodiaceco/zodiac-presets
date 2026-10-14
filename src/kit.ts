import { fileURLToPath } from 'node:url'
import { buildAllowKit } from '@zodiaceco/sdk'
import type { AllowKit as Kit } from './kit.generated'

export type Address = `0x${string}`

/** The ABIs presets can bind to an address, from `abis/any/`. */
export type Abi = keyof Kit['any']

// Next to `src/` while developing and next to `dist/` once published.
const ABIS_DIR = fileURLToPath(new URL('../abis', import.meta.url))

/**
 * The `allow` kit for the contract at `address`, typed by the ABI it
 * implements: `at('erc20', usdc).approve(spender)`.
 */
export const at = <A extends Abi>(abi: A, address: Address): Kit['any'][A] =>
  (buildAllowKit(ABIS_DIR, { any: { [abi]: address } }) as unknown as Kit).any[
    abi
  ]
