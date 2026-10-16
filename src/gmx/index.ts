import { c, type ConditionFunction } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from '../kit'
import { oneOf, ZERO } from '../utils'

// GMX v2 (gmx.io, "Synthetics"): perpetuals and GM/GLV liquidity pools.
//
// GMX works in two steps. The account sends tokens and an execution fee to a
// GMX vault and creates a request (an order, a deposit, a withdrawal); a GMX
// keeper executes it later at oracle prices and pays the output and the unused
// fee to the request's `receiver`. The account approves one contract, the GMX
// `Router`, through which every GMX router pulls tokens.
//
// Two facts shape these presets (verified source on Sourcify):
// - A vault credits its tokens to the next request that asks for them, from
//   any account (`recordTransferIn`). Tokens the avatar sends to a vault
//   without a request in the same transaction can be taken by anyone.
// - The GMX interface sends each request as one `ExchangeRouter.multicall`
//   (sendWnt, sendTokens, createOrder). Roles v2 can't check such a multicall
//   call by call: its integrity check requires every element of an array to
//   have the same type tree, so the calls would have to be allowed one by one,
//   leaving the token transfer free of its request.
//
// So orders go through `SubaccountRouter.createOrder(account, params)`: with
// the avatar registered as its own GMX subaccount (`gmx.ownSubaccount`), one
// call pulls the collateral from the avatar and creates the order, and GMX
// itself forces the order's `receiver` to be the account. Only the execution
// fee is a separate `sendWnt`, capped per call and by an ETH allowance.
//
// GM and GLV requests have no such call: their token transfers are separate
// calls, so every transfer needs an allowance. That allowance is the most a
// member can lose by sending tokens without a request.
//
// What stays outside Roles: execution. Keepers execute at oracle prices, and
// `acceptablePrice`, `triggerPrice` and `minOutputAmount` stay open, so a
// member can accept a bad price within the size and collateral limits.

/**
 * GMX v2 contracts by chain id, read on chain on 2026-10-15: the routers hold
 * `ROUTER_PLUGIN` in GMX's RoleStore, the vaults come from the live handlers.
 * GMX redeploys its routers from time to time (the vaults and the `Router`
 * stay); a simulation test checks these against the RoleStore.
 */
export const GMX = {
  42161: {
    router: '0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6',
    exchangeRouter: '0x7dE39FF2e232A2203196788d37e234cF8F1b83f1',
    subaccountRouter: '0x9c05880A2AaD7530c69e18e342eDC9E06cc757db',
    glvRouter: '0x167540D2DFF14120365CfDDF2F86e3045D4fa712',
    claimHandler: '0xc31E7aC86Cc20FF8D7f4642b5Ed67a43B2AC8426',
    orderVault: '0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5',
    depositVault: '0xF89e77e8Dc11691C9e8757e84aaFbCD8A67d7A55',
    withdrawalVault: '0x0628D46b5D145f183AdB6Ef1f2c97eD1C4701C55',
    glvVault: '0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9',
    roleStore: '0x3c3d99FD298f679DBC2CEcd132b4eC4d0F5e6e72',
  }, // Arbitrum
  43114: {
    router: '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68',
    exchangeRouter: '0xc002Db96E682FFF6675966F959677285a0C45Efa',
    subaccountRouter: '0xAda708aFf0f1D784D28cd8Ff4d6D977fF9599e5D',
    glvRouter: '0x603B3D3aB077CA433b888c05fa59c777d5b6dCAD',
    claimHandler: '0x07d8115676362Cf0d6672Dd71B23A43DB1e69C06',
    orderVault: '0xD3D60D22d415aD43b7e64b510D86A30f19B1B12C',
    depositVault: '0x90c670825d0C62ede1c5ee9571d6d9a17A722DFF',
    withdrawalVault: '0xf5F30B10141E1F63FC11eD772931A8294a591996',
    glvVault: '0x527FB0bCfF63C47761039bB386cFE181A92a4701',
    roleStore: '0xA44F830B6a2B6fa76657a3B92C1fe74fcB7C6AfD',
  }, // Avalanche
  4326: {
    router: '0x1eAfB14236C489C28845EC04F78DECA5Fb9879Aa',
    exchangeRouter: '0xF68560cA917717639be497BF6283aC08C9Bf0264',
    subaccountRouter: '0x03B59961bF30b973fBd793A6C8ad57dA38D4D0a6',
    glvRouter: '0xef1BA2A3fcf0244361d63FCAe0c4772586Cd1925',
    claimHandler: '0xf9B01d45B2c5022429c3f745e5A2E700B02cEBeb',
    orderVault: '0xD5AE04762E2afb1506695b3F36286EBE7B0E6772',
    depositVault: '0x8231A60862F9b0bA93fFA050c0E94AC902D901d2',
    withdrawalVault: '0x0Ec53dda9676219dE63eC703212219b07811F33C',
    glvVault: '0x52e4875EB5603d21912d30A1dBA6B0B97192459A',
    roleStore: '0xecA46636BDDbb4F451ca2B7062C7E36744934655',
  }, // MegaETH
} as const satisfies Record<number, Record<string, Address>>

export type GmxChain = keyof typeof GMX

/**
 * The UI fee receiver the GMX interface puts on its orders. Its UI fee factor
 * is 0 on every chain above. Any other address can set its own UI fee of up to
 * 0.1% of each order's size, so `uiFeeReceiver` is pinned to this or 0.
 */
export const GMX_UI_FEE_RECEIVER: Address =
  '0xff00000000000000000000000000000000000001'

/** `Order.OrderType` in gmx-synthetics. Swaps and liquidations are left out. */
const INCREASE = [2, 3, 8] // MarketIncrease, LimitIncrease, StopIncrease
const DECREASE = [4, 5, 6] // MarketDecrease, LimitDecrease, StopLossDecrease

/** keccak256(abi.encode("SUBACCOUNT_ORDER_ACTION")) */
const SUBACCOUNT_ORDER_ACTION: Address =
  '0x2a0791687fd34f2095c484a9fa4e25057d3ef79a97fcd8c61436047a7bdf4cbe'

const ZERO_HASH: Address =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/** GMX prices and sizes in USD with 30 decimals. */
const usd = (amount: number) => BigInt(Math.round(amount * 100)) * 10n ** 28n

type Addresses = readonly [Address, ...Address[]]

export type GmxCollateral = {
  token: Address
  /** Key of an allowance that caps the collateral the orders pull. */
  allowance?: string
  /** Largest single approval of the token to the GMX `Router`. */
  maxApproval?: bigint
}

export type GmxTradeParams = {
  /** Defaults to "Open and close GMX positions". */
  label?: string
  chain: GmxChain
  /** GM market tokens (one per market) the positions may be in. */
  markets: Addresses
  /** Tokens the positions may hold as collateral. */
  collateral: readonly [GmxCollateral, ...GmxCollateral[]]
  /** Largest size one order may add to a position, in USD. */
  maxOrderSizeUsd: number
  /** Key of an allowance, in GMX USD (30 decimals), that caps the size added. */
  sizeAllowance?: string
  /** Largest execution fee per order, in wei of the native token. */
  maxExecutionFee: bigint
  /**
   * Key of an ETH allowance (wei) that caps the call value. Required: GMX keeps
   * value above the fee in its router, where anyone can take it.
   */
  feeAllowance: string
}

export type GmxOwnSubaccountParams = {
  /** Defaults to "Register the avatar as its own GMX subaccount". */
  label?: string
  chain: GmxChain
  /** Latest expiry the registration may get. */
  expiresBefore: Date
  /** Highest lifetime action count (GMX never resets the count). */
  maxActions: bigint
}

export type GmxPool = {
  /** GM market token, or GLV token. */
  token: Address
  /** Key of an allowance that caps the tokens sent for withdrawals. */
  allowance: string
}

export type GmxGlv = GmxPool & {
  /** GM markets of the GLV that deposits and withdrawals may go through. */
  markets: Addresses
}

export type GmxDepositParams = {
  /** Defaults to "Deposit into GMX pools". */
  label?: string
  chain: GmxChain
  /** GM markets to deposit into. */
  markets?: readonly Address[]
  /** GLVs to deposit into. */
  glvs?: readonly Omit<GmxGlv, 'allowance'>[]
  /** Tokens to deposit, each with an allowance on what the avatar sends. */
  tokens: readonly [
    { token: Address; allowance: string; maxApproval?: bigint },
    ...{ token: Address; allowance: string; maxApproval?: bigint }[],
  ]
  maxExecutionFee: bigint
  /** Key of an ETH allowance (wei) that caps the call value. */
  feeAllowance: string
  /** Markets the deposits may swap through. Defaults to none. */
  swapMarkets?: readonly Address[]
}

export type GmxWithdrawParams = {
  /** Defaults to "Withdraw from GMX pools". */
  label?: string
  chain: GmxChain
  markets?: readonly GmxPool[]
  glvs?: readonly GmxGlv[]
  maxExecutionFee: bigint
  /** Key of an ETH allowance (wei) that caps the call value. */
  feeAllowance: string
  /** Markets the withdrawals may swap through. Defaults to none. */
  swapMarkets?: readonly Address[]
}

export type GmxTradingKeysParams = {
  /** Defaults to "Register GMX trading keys". */
  label?: string
  chain: GmxChain
  /** EOAs that may trade for the avatar (GMX one-click trading). */
  keys: Addresses
  /** Latest expiry a key may get. */
  expiresBefore: Date
  /** Highest lifetime action count per key. */
  maxActions: bigint
  /** Highest WETH (wrapped native token) top-up per action, for the key's gas. */
  maxTopUp: bigint
}

/**
 * Open and close positions in `markets`. Orders go through the
 * SubaccountRouter, so the avatar must be its own GMX subaccount
 * (`gmx.ownSubaccount`). A member sends the fee (`sendWnt`) and the order
 * (`createOrder`) in one transaction, e.g. a MultiSend.
 */
const trade = ({
  label,
  chain,
  markets,
  collateral,
  maxOrderSizeUsd,
  sizeAllowance,
  maxExecutionFee,
  feeAllowance,
}: GmxTradeParams) => {
  const gmx = GMX[chain]
  const size = sizeAllowance
    ? c.and(c.lte(usd(maxOrderSizeUsd)), c.withinAllowance(sizeAllowance))
    : c.lte(usd(maxOrderSizeUsd))

  // The order's own addresses. `receiver` gets the output and the fee refund,
  // `cancellationReceiver` (0 means the account) the collateral of a
  // cancelled order; GMX already forces both to the account on this router.
  // A callback contract would be called with the order, and any other UI fee
  // receiver could take up to 0.1% of each order.
  const addresses = (initialCollateralToken: Address | Branch) => ({
    receiver: c.avatar,
    cancellationReceiver: oneOf([c.avatar, ZERO]),
    callbackContract: ZERO,
    uiFeeReceiver: oneOf([ZERO, GMX_UI_FEE_RECEIVER]),
    market: oneOf(markets),
    initialCollateralToken,
    swapPath: everyOneOf(markets),
  })

  // Left open on every order: `triggerPrice`, `acceptablePrice` and
  // `minOutputAmount` (the price risk of the trade itself), `executionFee`
  // (GMX takes the fee from what `sendWnt` sent), `validFromTime`,
  // `isLong`, `shouldUnwrapNativeToken`, `autoCancel`,
  // `decreasePositionSwapType` and `dataList` (stored and emitted only; it
  // bridges out only for requests from another chain).
  const increase = ({ token, allowance }: GmxCollateral) => ({
    addresses: addresses(token),
    numbers: {
      sizeDeltaUsd: size,
      // The SubaccountRouter pulls exactly this amount from the avatar.
      ...(allowance
        ? { initialCollateralDeltaAmount: c.withinAllowance(allowance) }
        : {}),
      callbackGasLimit: 0,
    },
    orderType: oneOf(INCREASE),
    // A code pays a referrer; 0 leaves the avatar's code unchanged.
    referralCode: ZERO_HASH,
  })

  // A decrease pulls nothing and pays out to the receiver.
  const decrease = {
    addresses: addresses(oneOf(collateral.map(({ token }) => token))),
    numbers: { callbackGasLimit: 0 },
    orderType: oneOf(DECREASE),
    referralCode: ZERO_HASH,
  }

  return custom({
    label: label ?? 'Open and close GMX positions',
    permissions: [
      ...collateral.map(({ token, maxApproval }) =>
        at('erc20', token).approve(
          gmx.router,
          maxApproval === undefined ? undefined : c.lte(maxApproval)
        )
      ),
      // ETH that `sendWnt` does not wrap stays in the router, so the value is
      // capped by the allowance.
      at('gmx_exchange_router', gmx.exchangeRouter).sendWnt(
        gmx.orderVault,
        c.lte(maxExecutionFee),
        { send: true, etherWithinAllowance: feeAllowance }
      ),
      at('gmx_subaccount_router', gmx.subaccountRouter).createOrder(
        c.avatar, // account
        oneOf([...collateral.map(increase), decrease])
      ),
      // GMX lets an account cancel only its own orders. `updateOrder` is left
      // out: it could raise an order's size after the role checked it.
      at('gmx_subaccount_router', gmx.subaccountRouter).cancelOrder(),
      at('gmx_exchange_router', gmx.exchangeRouter).cancelOrder(),
    ],
  })
}

/**
 * Register the avatar as its own GMX subaccount, which `gmx.trade` needs.
 * Removing it (`gmx.revoke`) stops every `gmx.trade` order.
 */
const ownSubaccount = ({
  label,
  chain,
  expiresBefore,
  maxActions,
}: GmxOwnSubaccountParams) => {
  const subaccountRouter = at(
    'gmx_subaccount_router',
    GMX[chain].subaccountRouter
  )

  return custom({
    label: label ?? 'Register the avatar as its own GMX subaccount',
    permissions: [
      subaccountRouter.addSubaccount(c.avatar),
      subaccountRouter.setSubaccountExpiresAt(
        c.avatar,
        SUBACCOUNT_ORDER_ACTION,
        c.lte(seconds(expiresBefore))
      ),
      subaccountRouter.setMaxAllowedSubaccountActionCount(
        c.avatar,
        SUBACCOUNT_ORDER_ACTION,
        c.lte(maxActions)
      ),
    ],
  })
}

/**
 * Deposit tokens into GM markets and GLVs, minting the pool tokens to the
 * avatar. A member sends the fee, the tokens and the request in one
 * transaction.
 */
const deposit = ({
  label,
  chain,
  markets = [],
  glvs = [],
  tokens,
  maxExecutionFee,
  feeAllowance,
  swapMarkets = [],
}: GmxDepositParams) => {
  if (markets.length === 0 && glvs.length === 0) {
    throw new Error('GMX deposits need markets or GLVs')
  }
  const gmx = GMX[chain]
  const fee = { send: true, etherWithinAllowance: feeAllowance }

  // `initialLongToken` and `initialShortToken` stay open: they only decide
  // which tokens in the vault this request counts, and what it mints goes to
  // `receiver`.
  const pinned = {
    receiver: c.avatar,
    callbackContract: ZERO,
    uiFeeReceiver: oneOf([ZERO, GMX_UI_FEE_RECEIVER]),
    longTokenSwapPath: everyOneOf(swapMarkets),
    shortTokenSwapPath: everyOneOf(swapMarkets),
  }

  // A transfer can't be tied to its request (see the top of this file), so
  // each one is capped by its token's allowance.
  const exchangeRouter = at('gmx_exchange_router', gmx.exchangeRouter)
  const glvRouter = at('gmx_glv_router', gmx.glvRouter)

  return custom({
    label: label ?? 'Deposit into GMX pools',
    permissions: [
      ...tokens.map(({ token, maxApproval }) =>
        at('erc20', token).approve(
          gmx.router,
          maxApproval === undefined ? undefined : c.lte(maxApproval)
        )
      ),
      ...(markets.length > 0
        ? [
            exchangeRouter.sendWnt(
              gmx.depositVault,
              c.lte(maxExecutionFee),
              fee
            ),
            ...tokens.map(({ token, allowance }) =>
              exchangeRouter.sendTokens(
                token,
                gmx.depositVault,
                c.withinAllowance(allowance)
              )
            ),
            exchangeRouter.createDeposit({
              addresses: { ...pinned, market: oneOf(markets) },
              callbackGasLimit: 0,
            }),
            exchangeRouter.cancelDeposit(),
          ]
        : []),
      ...(glvs.length > 0
        ? [
            glvRouter.sendWnt(gmx.glvVault, c.lte(maxExecutionFee), fee),
            ...tokens.map(({ token, allowance }) =>
              glvRouter.sendTokens(
                token,
                gmx.glvVault,
                c.withinAllowance(allowance)
              )
            ),
            glvRouter.createGlvDeposit(
              oneOf(
                glvs.map(({ token, markets }) => ({
                  addresses: {
                    ...pinned,
                    glv: token,
                    market: oneOf(markets),
                  },
                  callbackGasLimit: 0,
                  // A market-token deposit would need GM tokens sent along.
                  isMarketTokenDeposit: false,
                }))
              )
            ),
            glvRouter.cancelGlvDeposit(),
          ]
        : []),
    ],
  })
}

/**
 * Withdraw from GM markets and GLVs, paying the tokens out to the avatar. A
 * member sends the fee, the pool tokens and the request in one transaction.
 */
const withdraw = ({
  label,
  chain,
  markets = [],
  glvs = [],
  maxExecutionFee,
  feeAllowance,
  swapMarkets = [],
}: GmxWithdrawParams) => {
  if (markets.length === 0 && glvs.length === 0) {
    throw new Error('GMX withdrawals need markets or GLVs')
  }
  const gmx = GMX[chain]
  const fee = { send: true, etherWithinAllowance: feeAllowance }
  const pinned = {
    receiver: c.avatar,
    callbackContract: ZERO,
    uiFeeReceiver: oneOf([ZERO, GMX_UI_FEE_RECEIVER]),
    longTokenSwapPath: everyOneOf(swapMarkets),
    shortTokenSwapPath: everyOneOf(swapMarkets),
  }

  return custom({
    label: label ?? 'Withdraw from GMX pools',
    permissions: [
      // Uncapped: the GMX routers pull pool tokens only for the avatar's own
      // requests, and those transfers are capped below. (A trading key's
      // order with a pool token as collateral fails and refunds the avatar.)
      ...[...markets, ...glvs].map(({ token }) =>
        at('erc20', token).approve(gmx.router)
      ),
      ...(markets.length > 0
        ? [
            at('gmx_exchange_router', gmx.exchangeRouter).sendWnt(
              gmx.withdrawalVault,
              c.lte(maxExecutionFee),
              fee
            ),
            ...markets.map(({ token, allowance }) =>
              at('gmx_exchange_router', gmx.exchangeRouter).sendTokens(
                token,
                gmx.withdrawalVault,
                c.withinAllowance(allowance)
              )
            ),
            at('gmx_exchange_router', gmx.exchangeRouter).createWithdrawal({
              addresses: {
                ...pinned,
                market: oneOf(markets.map(({ token }) => token)),
              },
              callbackGasLimit: 0,
            }),
            at('gmx_exchange_router', gmx.exchangeRouter).cancelWithdrawal(),
          ]
        : []),
      ...(glvs.length > 0
        ? [
            at('gmx_glv_router', gmx.glvRouter).sendWnt(
              gmx.glvVault,
              c.lte(maxExecutionFee),
              fee
            ),
            ...glvs.map(({ token, allowance }) =>
              at('gmx_glv_router', gmx.glvRouter).sendTokens(
                token,
                gmx.glvVault,
                c.withinAllowance(allowance)
              )
            ),
            at('gmx_glv_router', gmx.glvRouter).createGlvWithdrawal(
              oneOf(
                glvs.map(({ token, markets }) => ({
                  addresses: { ...pinned, glv: token, market: oneOf(markets) },
                  callbackGasLimit: 0,
                }))
              )
            ),
            at('gmx_glv_router', gmx.glvRouter).cancelGlvWithdrawal(),
          ]
        : []),
    ],
  })
}

/**
 * Register EOAs as GMX subaccounts ("one-click trading") that trade for the
 * avatar without Roles. GMX forces their orders' receiver to the avatar, but
 * a key picks market, size, leverage and collateral itself and pulls the
 * collateral through the avatar's Router approval. Keep approvals small.
 */
const tradingKeys = ({
  label,
  chain,
  keys,
  expiresBefore,
  maxActions,
  maxTopUp,
}: GmxTradingKeysParams) => {
  const subaccountRouter = at(
    'gmx_subaccount_router',
    GMX[chain].subaccountRouter
  )

  return custom({
    label: label ?? 'Register GMX trading keys',
    permissions: [
      subaccountRouter.addSubaccount(oneOf(keys)),
      subaccountRouter.setSubaccountExpiresAt(
        oneOf(keys),
        SUBACCOUNT_ORDER_ACTION,
        c.lte(seconds(expiresBefore))
      ),
      subaccountRouter.setMaxAllowedSubaccountActionCount(
        oneOf(keys),
        SUBACCOUNT_ORDER_ACTION,
        c.lte(maxActions)
      ),
      subaccountRouter.setSubaccountAutoTopUpAmount(
        oneOf(keys),
        c.lte(maxTopUp)
      ),
    ],
  })
}

/**
 * Stop GMX activity: remove any subaccount (the avatar itself stops
 * `gmx.trade`), cancel the avatar's orders, and set the Router approval of
 * `tokens` to 0, which stops every GMX router and subaccount from pulling
 * them. Safe to hand to many people.
 */
const revoke = ({
  label,
  chain,
  tokens = [],
}: {
  /** Defaults to "Stop GMX activity". */
  label?: string
  chain: GmxChain
  tokens?: readonly Address[]
}) => {
  const gmx = GMX[chain]

  return custom({
    label: label ?? 'Stop GMX activity',
    permissions: [
      at('gmx_subaccount_router', gmx.subaccountRouter).removeSubaccount(),
      at('gmx_subaccount_router', gmx.subaccountRouter).cancelOrder(),
      at('gmx_exchange_router', gmx.exchangeRouter).cancelOrder(),
      ...tokens.map((token) => at('erc20', token).approve(gmx.router, 0)),
    ],
  })
}

/**
 * Claim funding fees, claimable collateral and GMX distributions to the
 * avatar. GMX always claims for the caller, so markets, tokens and
 * distributions stay open.
 */
const claim = ({
  label,
  chain,
}: {
  /** Defaults to "Claim from GMX". */
  label?: string
  chain: GmxChain
}) => {
  const gmx = GMX[chain]
  const exchangeRouter = at('gmx_exchange_router', gmx.exchangeRouter)

  return custom({
    label: label ?? 'Claim from GMX',
    permissions: [
      exchangeRouter.claimFundingFees(undefined, undefined, c.avatar),
      exchangeRouter.claimCollateral(undefined, undefined, undefined, c.avatar),
      at('gmx_claim_handler', gmx.claimHandler).acceptTermsAndClaim(
        undefined,
        c.avatar
      ),
    ],
  })
}

export const gmx = {
  trade,
  ownSubaccount,
  deposit,
  withdraw,
  tradingKeys,
  revoke,
  claim,
}

type Branch = ReturnType<typeof c.eq>

/** Unix seconds. */
const seconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000))

// Every element is one of `values`, and an empty list passes. With no values,
// the list must be empty. The cast: `c.every` is typed for mutable arrays, the
// kit types address lists as readonly.
const everyOneOf = (values: readonly Address[]) =>
  (values.length === 0
    ? c.eq([])
    : c.every(oneOf(values))) as ConditionFunction<readonly Address[]>
