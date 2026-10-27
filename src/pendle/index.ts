import { c, type ConditionFunction } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { getAddress } from 'ethers'
import { at, type Address } from '../kit'
import { NATIVE, oneOf, ZERO } from '../utils'
import { PENDLE } from './chains'

// Pendle V2: an SY wraps a yield-bearing token, and each market splits it
// into a principal token (PT, which redeems 1:1 for the underlying asset at
// the market's expiry, so buying it below par locks in a fixed yield) and a
// yield token (YT, which earns the variable yield until the expiry). The
// market contract is also the LP token of its PT/SY pool.
//
// A Safe acts through one contract, the router (PendleRouterV4, verified
// source in pendle-finance/pendle-core-v2-public). It has no functions of its
// own and forwards each selector to a facet. It only ever pulls tokens from
// `msg.sender` (here the avatar); its callbacks only move tokens it holds
// during a call. So approving tokens, PT, YT and LP to the router is safe for
// any amount.
//
// What the router does not check, the presets pin:
// - `receiver` (and `user` of claims): every payout goes to the avatar.
// - `market` and `YT`: the router sends the avatar's tokens to the market it
//   is given, so a fake one would keep them.
// - TokenInput and TokenOutput: any swap type other than 0 (none) or 3 (WETH
//   to ETH) sends the tokens to `pendleSwap`, any address, and calls it with
//   arbitrary data. Roles can't compare `tokenIn` with `tokenMintSy`, so each
//   allowed token is its own branch fixing both.
// - LimitOrderData: a fill trades the avatar's tokens against other parties'
//   signed orders, at their price. Both fill lists must be empty.
//
// Amounts, slippage minimums and the approximation hints (`guess…`) stay
// open: everything ends up with the avatar, and Roles can't know a fair
// price. A member who sets a minimum of zero can lose value to a sandwich;
// cap that with an allowance per token. A token a market's SY doesn't take
// passes the Roles mod and reverts in the SY.
//
// Markets expire, so they're a parameter: `pendleMarkets()` reads them from
// Pendle's API. After the expiry, swaps revert, PT redeems through `redeem`
// alone and LP comes out through `removeLiquidity`; keep a market in the list
// until the avatar holds none of its PT, YT or LP, and build `redeem` again
// after a market expires to add the app's exit route for it.

export { PENDLE }

/** The chains both Pendle and Zodiac are deployed on, by chain id. */
export type PendleChain = keyof typeof PENDLE

/** A Pendle market and its tokens, as `pendleMarkets()` returns them. */
export type PendleMarket = {
  /** The market, also its LP token. */
  market: Address
  pt: Address
  yt: Address
  sy: Address
  /** For labels, e.g. "sUSDe". */
  name?: string
  expiry?: Date
  /** Tokens the SY takes (`SY.getTokensIn()`), `NATIVE` for the native token. */
  tokensMintSy?: readonly Address[]
  /** Tokens the SY pays out (`SY.getTokensOut()`). */
  tokensRedeemSy?: readonly Address[]
}

/** Markets, e.g. from `pendleMarkets()`. At least one (`oneOf` throws otherwise). */
type Markets = readonly PendleMarket[]

/** A token the avatar pays with. */
export type PendleTokenIn = {
  token: Address
  /** Key of an allowance on the same Roles mod that caps the amounts paid. */
  allowance?: string
}

export type PendleInParams = {
  /** Defaults to e.g. "Buy Pendle PT (sUSDe 26 Nov 2026)". */
  label?: string
  chain: PendleChain
  markets: Markets
  tokens: readonly [PendleTokenIn, ...PendleTokenIn[]]
}

export type PendleOutParams = {
  /** Defaults to e.g. "Sell Pendle PT (sUSDe 26 Nov 2026)". */
  label?: string
  chain: PendleChain
  markets: Markets
  /** Tokens the avatar gets back. */
  tokens: readonly [Address, ...Address[]]
}

export type PendleClaimParams = {
  /** Defaults to e.g. "Claim Pendle interest and rewards (sUSDe 26 Nov 2026)". */
  label?: string
  chain: PendleChain
  markets: Markets
}

/** Buy PT with the listed tokens, receiving it in the avatar. */
const buyPt = ({ label, chain, markets, tokens }: PendleInParams) =>
  custom({
    label: label ?? `Buy Pendle PT ${describe(markets)}`,
    permissions: [
      ...approveTokens(chain, tokens),
      router(chain).swapExactTokenForPt(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // minPtOut
        undefined, // guessPtOut
        tokenInput(chain, markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/** Sell PT before the expiry, paying the listed tokens out to the avatar. */
const sellPt = ({ label, chain, markets, tokens }: PendleOutParams) =>
  custom({
    label: label ?? `Sell Pendle PT ${describe(markets)}`,
    permissions: [
      ...markets.map((m) => at('erc20', m.pt).approve(PENDLE[chain].router)),
      router(chain).swapExactPtForToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // exactPtIn
        tokenOutput(markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/**
 * Redeem PT for the listed tokens, paid out to the avatar. After the expiry
 * PT alone redeems; before it, the call also burns as much YT, which needs a
 * YT approval (from `sellYt` on the same Safe).
 *
 * Markets that had expired when the preset is built also get
 * `exitPostExpToToken`, the route Pendle's app takes after the expiry (PT
 * and, with an LP approval from `removeLiquidity`, LP in one call). It does
 * not check the expiry itself: before it, the YT contract redeems only as
 * much PT as it holds YT, and the rest stays there for whoever redeems next.
 * So it's left out for markets that haven't expired, or whose `expiry` is
 * unknown; build the preset again after a market expires.
 */
const redeem = ({ label, chain, markets, tokens }: PendleOutParams) => {
  const expired = markets.filter(
    (m) => m.expiry != null && m.expiry.getTime() <= Date.now()
  )

  return custom({
    label: label ?? `Redeem Pendle PT ${describe(markets)}`,
    permissions: [
      ...markets.map((m) => at('erc20', m.pt).approve(PENDLE[chain].router)),
      router(chain).redeemPyToToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.yt)),
        undefined, // netPyIn
        tokenOutput(markets, tokens)
      ),
      ...(expired.length > 0
        ? [
            router(chain).exitPostExpToToken(
              c.avatar, // receiver
              oneOf(expired.map((m) => m.market)),
              undefined, // netPtIn
              undefined, // netLpIn
              tokenOutput(markets, tokens)
            ),
          ]
        : []),
    ],
  })
}

/** Add liquidity with one of the listed tokens, receiving LP in the avatar. */
const addLiquidity = ({ label, chain, markets, tokens }: PendleInParams) =>
  custom({
    label: label ?? `Provide liquidity on Pendle ${describe(markets)}`,
    permissions: [
      ...approveTokens(chain, tokens),
      router(chain).addLiquiditySingleToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // minLpOut
        undefined, // guessPtReceivedFromSy
        tokenInput(chain, markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/** Remove liquidity for the listed tokens, before or after the expiry. */
const removeLiquidity = ({ label, chain, markets, tokens }: PendleOutParams) =>
  custom({
    label: label ?? `Remove liquidity from Pendle ${describe(markets)}`,
    permissions: [
      ...markets.map((m) =>
        at('erc20', m.market).approve(PENDLE[chain].router)
      ),
      router(chain).removeLiquiditySingleToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // netLpToRemove
        tokenOutput(markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/**
 * Exit PT, YT and LP of a market in one call before the expiry, as the
 * Withdraw tab of Pendle's app does by default: the LP is burned, PT and YT
 * are redeemed in pairs, whatever is left of either is sold on the market,
 * and the SY pays the listed tokens out to the avatar. That sells PT and YT
 * too, so the preset approves all three to the router. After the expiry the
 * app exits through `exitPostExpToToken`, which `redeem` allows.
 */
const exit = ({ label, chain, markets, tokens }: PendleOutParams) =>
  custom({
    label: label ?? `Exit Pendle positions ${describe(markets)}`,
    permissions: [
      ...markets.flatMap((m) =>
        [m.market, m.pt, m.yt].map((token) =>
          at('erc20', token).approve(PENDLE[chain].router)
        )
      ),
      router(chain).exitPreExpToToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // netPtIn
        undefined, // netYtIn
        undefined, // netLpIn
        tokenOutput(markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/**
 * Buy YT with the listed tokens. YT is worth nothing after the expiry and
 * moves far more than PT, so it's a preset of its own.
 */
const buyYt = ({ label, chain, markets, tokens }: PendleInParams) =>
  custom({
    label: label ?? `Buy Pendle YT ${describe(markets)}`,
    permissions: [
      ...approveTokens(chain, tokens),
      router(chain).swapExactTokenForYt(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // minYtOut
        undefined, // guessYtOut
        tokenInput(chain, markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/** Sell YT before the expiry, paying the listed tokens out to the avatar. */
const sellYt = ({ label, chain, markets, tokens }: PendleOutParams) =>
  custom({
    label: label ?? `Sell Pendle YT ${describe(markets)}`,
    permissions: [
      ...markets.map((m) => at('erc20', m.yt).approve(PENDLE[chain].router)),
      router(chain).swapExactYtForToken(
        c.avatar, // receiver
        oneOf(markets.map((m) => m.market)),
        undefined, // exactYtIn
        tokenOutput(markets, tokens),
        NO_LIMIT_ORDERS
      ),
    ],
  })

/**
 * Claim the interest of YT and the rewards of SY and LP positions. The
 * claims always pay the `user` they're made for, which is pinned to the
 * avatar; the lists can be empty.
 *
 * Pendle's app claims through `redeemDueInterestAndRewardsV2`, which claims
 * for the caller and has the SY pay YT interest out as a token: the router
 * pulls the interest back from the avatar as SY, hence the SY approvals.
 * Its `swaps` would send the claimed tokens through `pendleSwap`, any
 * contract, so the list must be empty; without swaps `pendleSwap` is unused.
 */
const claim = ({ label, chain, markets }: PendleClaimParams) => {
  const sys = unique(markets.map((m) => m.sy))
  const yts = markets.map((m) => m.yt)
  const listed = markets.map((m) => m.market)

  return custom({
    label: label ?? `Claim Pendle interest and rewards ${describe(markets)}`,
    permissions: [
      router(chain).redeemDueInterestAndRewards(
        c.avatar, // user
        everyOneOf(sys),
        everyOneOf(yts),
        everyOneOf(listed)
      ),
      ...sys.map((sy) => at('erc20', sy).approve(PENDLE[chain].router)),
      router(chain).redeemDueInterestAndRewardsV2(
        everyOneOf(sys),
        everyYtOneOf(yts),
        everyOneOf(listed),
        undefined, // pendleSwap
        []
      ),
    ],
  })
}

export const pendle = {
  buyPt,
  sellPt,
  redeem,
  addLiquidity,
  removeLiquidity,
  exit,
  buyYt,
  sellYt,
  claim,
}

export const PENDLE_API = 'https://api-v2.pendle.finance/core'

/**
 * Pendle markets on `chain`, from Pendle's API: the active ones with the
 * given names (e.g. "sUSDe"), and any market, expired or not, at the given
 * addresses. Without either, every active market.
 */
export const pendleMarkets = async ({
  chain,
  names = [],
  addresses = [],
}: {
  chain: PendleChain
  names?: readonly string[]
  addresses?: readonly Address[]
}): Promise<PendleMarket[]> => {
  const active = await api<{ markets: ApiMarket[] }>(
    `/v1/${chain}/markets/active`
  )
  const expired =
    addresses.length > 0
      ? await api<{ markets: ApiMarket[] }>(`/v1/${chain}/markets/inactive`)
      : { markets: [] }

  const wanted = new Set(addresses.map((a) => a.toLowerCase()))
  const byName = new Set(names.map((n) => n.toLowerCase()))
  const found =
    names.length === 0 && addresses.length === 0
      ? active.markets
      : [
          ...active.markets.filter((m) => byName.has(m.name.toLowerCase())),
          ...[...active.markets, ...expired.markets].filter((m) =>
            wanted.has(m.address.toLowerCase())
          ),
        ]

  for (const address of wanted) {
    if (!found.some((m) => m.address.toLowerCase() === address)) {
      throw new Error(
        `Pendle's API knows no market ${address} on chain ${chain}`
      )
    }
  }

  return Promise.all(
    found.map(async (m) => {
      const tokens = await api<{
        tokensMintSy: string[]
        tokensRedeemSy: string[]
      }>(`/v1/sdk/${chain}/markets/${m.address}/tokens`)

      return {
        market: checksum(m.address),
        pt: checksum(m.pt),
        yt: checksum(m.yt),
        sy: checksum(m.sy),
        name: m.name,
        expiry: new Date(m.expiry),
        tokensMintSy: tokens.tokensMintSy.map(checksum),
        tokensRedeemSy: tokens.tokensRedeemSy.map(checksum),
      }
    })
  )
}

type ApiMarket = {
  name: string
  address: string
  expiry: string
  pt: string
  yt: string
  sy: string
}

const api = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${PENDLE_API}${path}`)
  if (!response.ok) {
    throw new Error(`Pendle's API answered ${response.status} for ${path}`)
  }
  return (await response.json()) as T
}

// The API writes addresses as "<chainId>-0x…", in lower case.
const checksum = (value: string) =>
  getAddress(value.replace(/^\d+-/, '')) as Address

// Swap types the presets allow (IPSwapAggregator.SwapType)
const SWAP_NONE = 0
const SWAP_ETH_WETH = 3

const NO_LIMIT_ORDERS = c.matches({
  limitRouter: ZERO,
  normalFills: [],
  flashFills: [],
})

const router = (chain: PendleChain) => at('pendle_router', PENDLE[chain].router)

const approveTokens = (chain: PendleChain, tokens: readonly PendleTokenIn[]) =>
  tokens.map(({ token }) => at('erc20', token).approve(PENDLE[chain].router))

/**
 * One branch per token: the router deposits it into the SY as it is. The
 * chain's wrapped native token gets a second branch where the router unwraps
 * it and deposits the native token (`_wrap_unwrap_ETH` only calls the wrapped
 * token's `withdraw` then), which is how Pendle's own API pays WETH into an
 * SY that takes ETH.
 */
const tokenInput = (
  chain: PendleChain,
  markets: Markets,
  tokens: readonly PendleTokenIn[]
) => {
  const { wrappedNative } = PENDLE[chain]

  return oneOf(
    tokens.flatMap(({ token, allowance }) => {
      if (token === NATIVE) {
        throw new Error(
          'Pendle presets take ERC-20 tokens only: pay with the wrapped native token'
        )
      }
      check(token, markets, 'tokensMintSy', 'takes')

      const route = (tokenMintSy: Address, swapType: number) =>
        c.matches({
          tokenIn: token,
          netTokenIn: allowance ? c.withinAllowance(allowance) : undefined,
          tokenMintSy,
          pendleSwap: ZERO,
          swapData: { swapType },
        })

      return token === wrappedNative
        ? [route(token, SWAP_NONE), route(NATIVE, SWAP_ETH_WETH)]
        : [route(token, SWAP_NONE)]
    })
  )
}

/** One branch per token: the SY pays it out directly. */
const tokenOutput = (markets: Markets, tokens: readonly Address[]) =>
  oneOf(
    tokens.map((token) => {
      check(token, markets, 'tokensRedeemSy', 'pays out')

      return c.matches({
        tokenOut: token,
        tokenRedeemSy: token,
        pendleSwap: ZERO,
        swapData: { swapType: SWAP_NONE },
      })
    })
  )

/**
 * Throws if the markets' SYs are known (as `pendleMarkets()` returns them) and
 * none takes or pays out `token`. The wrapped native token counts for an SY
 * that takes the native token.
 */
const check = (
  token: Address,
  markets: Markets,
  side: 'tokensMintSy' | 'tokensRedeemSy',
  verb: string
) => {
  if (markets.some((m) => m[side] == null)) return
  const ok = markets.some((m) =>
    m[side]!.some((t) => t.toLowerCase() === token.toLowerCase())
  )
  const unwraps =
    side === 'tokensMintSy' && markets.some((m) => m[side]!.includes(NATIVE))
  if (!ok && !unwraps) {
    throw new Error(`No SY of these Pendle markets ${verb} ${token}`)
  }
}

/**
 * Every element is one of `values`; an empty list passes. `c.every` is typed
 * for mutable arrays while the kit types array parameters as readonly, hence
 * the cast.
 */
const everyOneOf = (values: readonly Address[]) =>
  c.every(oneOf(values)) as ConditionFunction<readonly Address[]>

/** Every YT entry of `redeemDueInterestAndRewardsV2` names one of `yts`. */
const everyYtOneOf = (yts: readonly Address[]) =>
  c.every(c.matches({ yt: oneOf(yts) })) as ConditionFunction<
    readonly { yt: Address }[]
  >

const unique = (values: readonly Address[]) => [
  ...new Map(values.map((v) => [v.toLowerCase(), v])).values(),
]

/** "(sUSDe 26 Nov 2026, wstETH 30 Dec 2027)", or the market addresses. */
const describe = (markets: Markets) =>
  `(${markets
    .map((m) =>
      m.name ? `${m.name}${m.expiry ? ` ${date(m.expiry)}` : ''}` : m.market
    )
    .join(', ')})`

const date = (d: Date) =>
  `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
