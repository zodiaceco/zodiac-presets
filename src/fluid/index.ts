import { c } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from '../kit'
import { list, NATIVE } from '../utils'
import { F_TOKENS } from './fTokens'

// Fluid lending: fTokens are ERC-4626 vaults over one token each. The fToken
// over the chain's wrapped native token (fWETH, fWPOL, fWBNB) also takes and
// pays out the native token itself, through `depositNative`, `withdrawNative`
// and `redeemNative`.
//
// fTokens (verified source on Sourcify) only ever pull the deposit from
// `msg.sender` — here the avatar — so approving the token to its fToken is
// safe for any amount, and so is leaving the amounts unconstrained: the
// receiver and owner are pinned to the avatar, so the shares and the assets
// never leave it. Withdrawing from the avatar's own position needs no share
// approval, natively or not, since the owner is the caller.
//
// The permissions are DeFi Kit's `fluid.deposit`, split in two. Like DeFi Kit,
// they leave out `mint`/`mintNative`, the min/max-amount overloads and the
// signature-based variants: the Fluid app deposits and withdraws by amount.

export { F_TOKENS }

/** The chains both Fluid lending and Zodiac are deployed on, by chain id. */
export type FluidChain = keyof typeof F_TOKENS

export type FluidParams = {
  /**
   * Defaults to "Deposit USDC, WETH and ETH into Fluid", or "Withdraw … from
   * Fluid".
   */
  label?: string
  chain: FluidChain
  /** Underlying tokens by address, `NATIVE` for the chain's native token. */
  tokens: readonly Address[]
}

type Position = {
  /** The fToken. */
  fToken: Address
  /** The ERC-20 deposited, or `NATIVE`. */
  token: Address
  symbol: string
}

/**
 * Deposit tokens into their Fluid fTokens, receiving the shares in the avatar.
 */
const deposit = async ({ label, chain, tokens }: FluidParams) => {
  const positions = resolve(chain, tokens)

  return custom({
    label: label ?? `Deposit ${symbols(positions)} into Fluid`,
    permissions: positions.flatMap(({ fToken, token }) =>
      token === NATIVE
        ? [
            at('fluid_ftoken_native', fToken)['depositNative(address)'](
              c.avatar,
              { send: true }
            ),
          ]
        : [
            at('erc20', token).approve(fToken),
            at('erc4626', fToken).deposit(undefined, c.avatar),
          ]
    ),
  })
}

/**
 * Withdraw tokens from their Fluid fTokens, paying them out to the avatar.
 */
const withdraw = async ({ label, chain, tokens }: FluidParams) => {
  const positions = resolve(chain, tokens)

  return custom({
    label: label ?? `Withdraw ${symbols(positions)} from Fluid`,
    permissions: positions.flatMap(({ fToken, token }) => {
      if (token === NATIVE) {
        const fNative = at('fluid_ftoken_native', fToken)

        return [
          fNative['withdrawNative(uint256,address,address)'](
            undefined, // assets
            c.avatar,
            c.avatar
          ),
          fNative['redeemNative(uint256,address,address)'](
            undefined, // shares
            c.avatar,
            c.avatar
          ),
        ]
      }

      const vault = at('erc4626', fToken)

      return [
        vault.withdraw(undefined, c.avatar, c.avatar),
        vault.redeem(undefined, c.avatar, c.avatar),
      ]
    }),
  })
}

/** Each token's fToken, once per token, in the order given. */
const resolve = (chain: FluidChain, tokens: readonly Address[]) => {
  const fTokens = F_TOKENS[chain]
  if (fTokens == null) {
    throw new Error(`Fluid lending is not on chain ${chain}.`)
  }
  if (tokens.length === 0) {
    throw new Error('Pass at least one token.')
  }

  const unique = [...new Set(tokens.map((token) => token.toLowerCase()))]

  return unique.map((token): Position => {
    if (token === NATIVE) {
      const entry = fTokens.find((f) => 'native' in f)
      if (entry == null) {
        throw new Error(
          `Fluid has no fToken for the native token on chain ${chain}.`
        )
      }
      return { fToken: entry.fToken, token: NATIVE, symbol: entry.native }
    }

    const entry = fTokens.find((f) => f.asset.toLowerCase() === token)
    if (entry == null) {
      throw new Error(`Fluid has no fToken for ${token} on chain ${chain}.`)
    }
    return { fToken: entry.fToken, token: entry.asset, symbol: entry.symbol }
  })
}

const symbols = (positions: Position[]) =>
  list(positions.map(({ symbol }) => symbol))

export const fluid = { deposit, withdraw }
