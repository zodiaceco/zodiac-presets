import { c } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from '../kit'
import { list, NATIVE } from '../utils'
import { AAVE_V3, type AaveMarket } from './markets'

// Aave v3: supply and withdraw, borrow and repay, the way the Aave app does
// it — straight through the pool for ERC-20 reserves, and through the
// market's WrappedTokenGatewayV3 for the chain's native token.
//
// Every call that moves funds pins where they go (`onBehalfOf`, `to`) to the
// avatar. Amounts and referral codes are left open: they can't send anything
// elsewhere. The gateway's first parameter is the pool, which current
// gateways ignore (they use the pool they were deployed for); it's pinned to
// the pool anyway, as DeFi Kit does.

export { AAVE_V3, type AaveMarket } from './markets'

export type AaveChain = keyof typeof AAVE_V3

type MarketName<C extends AaveChain> = keyof (typeof AAVE_V3)[C] & string

/** The market, on chains that have several (Ethereum: Core, Prime, EtherFi). */
type ChainAndMarket = {
  [C in AaveChain]: { chain: C } & ([MarketName<C>] extends ['Core']
    ? { market?: never }
    : {
        /** Defaults to Core. */
        market?: MarketName<C>
      })
}[AaveChain]

export type AaveParams = ChainAndMarket & {
  /** Defaults to e.g. "Deposit USDC, WETH and ETH into Aave v3". */
  label?: string
  /** Reserves by their underlying token, or `NATIVE` for the native token. */
  tokens: readonly [Address, ...Address[]]
}

/**
 * Supply tokens to an Aave v3 market for the avatar, and use them as
 * collateral or not. `NATIVE` supplies the native token through the market's
 * gateway, which wraps it first.
 */
const deposit = async (params: AaveParams) => {
  const { tokens, protocol, market, reserves, native } = resolve(params)
  const pool = at('aave_v3_pool', market.pool)

  return custom({
    label: params.label ?? `Deposit ${tokens} into ${protocol}`,
    permissions: [
      ...reserves.flatMap(({ token }) => [
        at('erc20', token).approve(market.pool),
        pool['supply(address,uint256,address,uint16)'](
          token,
          undefined, // amount
          c.avatar
        ),
        // On or off: it only changes what the avatar's own position may
        // borrow against, and the pool refuses to turn collateral off where
        // that would make the position liquidatable.
        pool['setUserUseReserveAsCollateral(address,bool)'](token),
      ]),

      ...(native
        ? [
            at('aave_v3_wrapped_token_gateway', native.address).depositETH(
              market.pool,
              c.avatar,
              undefined, // referralCode
              { send: true }
            ),
            pool['setUserUseReserveAsCollateral(address,bool)'](native.wrapped),
          ]
        : []),
    ],
  })
}

/**
 * Withdraw tokens from an Aave v3 market to the avatar, and claim the
 * market's supply rewards. `NATIVE` withdraws the wrapped native token
 * through the gateway, which unwraps it.
 */
const withdraw = async (params: AaveParams) => {
  const { tokens, protocol, market, reserves, native } = resolve(params)
  const pool = at('aave_v3_pool', market.pool)

  return custom({
    label: params.label ?? `Withdraw ${tokens} from ${protocol}`,
    permissions: [
      ...reserves.flatMap(({ token, id }) => [
        pool['withdraw(address,uint256,address)'](
          token,
          undefined, // amount
          c.avatar
        ),

        // An L2Pool's compact withdraw always pays out to the caller, so only
        // the reserve, by its id, needs pinning.
        ...(market.l2Pool ? [pool['withdraw(bytes32)'](reserveId(id))] : []),
      ]),

      ...(native
        ? [
            // The gateway pulls the aTokens to withdraw them
            at('erc20', native.aToken).approve(native.address),
            at('aave_v3_wrapped_token_gateway', native.address).withdrawETH(
              market.pool,
              undefined, // amount
              c.avatar
            ),
          ]
        : []),

      // Rewards go to the avatar. Which assets' rewards, how much and which
      // reward token can be left open: claiming moves nothing but the
      // avatar's own rewards.
      //
      // Unlike DeFi Kit, which only allows this on Ethereum, on every market:
      // each has a rewards controller, which pays out whatever incentives the
      // market runs.
      at('aave_v3_rewards_controller', market.rewardsController).claimRewards(
        undefined, // assets
        undefined, // amount
        c.avatar
      ),
    ],
  })
}

/**
 * Borrow tokens from an Aave v3 market against the avatar's collateral, and
 * repay them. `NATIVE` borrows and repays the native token through the
 * gateway.
 */
const borrow = async (params: AaveParams) => {
  const { tokens, protocol, market, reserves, native } = resolve(params)
  const pool = at('aave_v3_pool', market.pool)

  return custom({
    label: params.label ?? `Borrow ${tokens} from ${protocol}`,
    permissions: [
      ...reserves.flatMap(({ token, id }) => [
        // For repaying
        at('erc20', token).approve(market.pool),
        pool['borrow(address,uint256,uint256,uint16,address)'](
          token,
          undefined, // amount
          undefined, // interestRateMode
          undefined, // referralCode
          c.avatar
        ),
        pool['repay(address,uint256,uint256,address)'](
          token,
          undefined, // amount
          undefined, // interestRateMode
          c.avatar
        ),

        // An L2Pool's compact repay always repays the caller's debt.
        ...(market.l2Pool ? [pool['repay(bytes32)'](reserveId(id))] : []),
      ]),

      ...(native
        ? [
            // The gateway borrows the wrapped native token against the
            // delegated credit, but only ever for its caller and paying out to
            // the caller, so the amount delegated can be left open.
            at(
              'aave_v3_variable_debt_token',
              native.variableDebtToken
            ).approveDelegation(native.address),
            at('aave_v3_wrapped_token_gateway', native.address).borrowETH(
              market.pool,
              undefined, // amount
              undefined // referralCode
            ),
            at('aave_v3_wrapped_token_gateway', native.address).repayETH(
              market.pool,
              undefined, // amount
              c.avatar,
              { send: true }
            ),
          ]
        : []),
    ],
  })
}

/**
 * Matches the compact calldata of an L2Pool call for reserve `id`: its last
 * two bytes (`args` is `amount << 16 | assetId`).
 */
const reserveId = (id: number) =>
  c.bitmask({
    shift: 30,
    mask: '0xffff',
    value: `0x${id.toString(16).padStart(4, '0')}`,
  })

type Reserve = { token: Address; id: number }

const resolve = ({
  chain,
  market: marketName = 'Core',
  tokens,
}: AaveParams) => {
  const markets: Record<string, AaveMarket> | undefined = AAVE_V3[chain]
  const market = markets?.[marketName]
  const where = `Aave v3 ${marketName} market on chain ${chain}`

  if (markets == null || market == null) {
    throw new Error(`There is no ${where}.`)
  }

  const reserves: Reserve[] = []
  let native: AaveMarket['gateway']
  // In the order given, for the label
  const symbols: string[] = []

  for (const token of tokens) {
    if (token.toLowerCase() === NATIVE) {
      if (market.gateway == null) {
        throw new Error(
          `The ${where} takes no native token: it has no gateway that wraps it.`
        )
      }
      native = market.gateway
      symbols.push(native.native)
      continue
    }

    const id = market.reserves.findIndex(
      ([, underlying]) => underlying.toLowerCase() === token.toLowerCase()
    )

    if (id === -1) {
      throw new Error(`${token} is not a reserve of the ${where}.`)
    }

    reserves.push({ token, id })
    symbols.push(market.reserves[id]![0])
  }

  return {
    /** e.g. "USDC, WETH and ETH" */
    tokens: list(symbols),
    /** Named after the market where the chain has several. */
    protocol:
      Object.keys(markets).length > 1 ? `Aave v3 ${marketName}` : 'Aave v3',
    market,
    reserves,
    native,
  }
}

export const aave = { deposit, withdraw, borrow }
