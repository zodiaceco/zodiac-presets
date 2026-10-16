import { describe, expect, it } from 'bun:test'
import {
  AbiCoder,
  getAddress,
  Interface,
  keccak256,
  MaxUint256,
  parseEther,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import routerAbi from '../../abis/any/pendle_router.json'
import type { Address } from '../kit'
import {
  AVATAR,
  simulate,
  simulationEnabled,
  STRANGER,
  type Case,
} from '../test/simulate'
import { PENDLE, pendle, pendleMarkets, type PendleTokenIn } from '.'
import app from './app-calls.json'

// The Pendle presets against Ethereum mainnet state: PT, LP and YT trades go
// through and execute against the live markets, calls built by Pendle's own
// Convert API (no aggregator, no limit orders) pass as they are, and every
// call that would hand funds to someone else, route through an aggregator or
// fill a limit order stops at the Roles mod. Calls recorded from
// app.pendle.finance (`app-calls.json`) get the outcome their content calls
// for, with the router's multicall unfolded into its calls as Zodiac Pilot
// does. Run with `bun test:sim`; it also asks Pendle's API for the markets and
// for the Convert API calls.

const RPC = process.env.RPC_1 ?? 'https://ethereum-rpc.publicnode.com'
const ROUTER = PENDLE[1].router
const LIMIT_ROUTER = '0x000000000000c9B3E2C3Ec88B1B4c0cD853f4321'
const PENDLE_SWAP = '0xd4F480965D2347d421F1bEC7F545682E5Ec2151D'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'
const SUSDE = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const WSTETH_DEC27 = '0x34280882267ffa6383B363E278B027Be083bBe3b'
const SUSDE_NOV26 = '0x47ad2Cd1DD15739A7a035b9d3B7828d916FEF77E'
const SUSDE_AUG26 = '0x177768caf9D0e036725A51D3f60d7E20F2D4D194' // expired
const UNLISTED_MARKET = '0x9c560ebaf78e596cbcc27411d633a74d628dd7dc' // sUSDS 26 Nov 2026
const UNLISTED_YT = '0x30775b422b9c7415349855346352faa61fd97e41' // sUSDe 7 May 2026

const router = new Interface(routerAbi)
const erc20 = new Interface(['function approve(address,uint256)'])
const abi = AbiCoder.defaultAbiCoder()
const e18 = (n: bigint) => n * 10n ** 18n

const NO_SWAP = {
  swapType: 0,
  extRouter: STRANGER,
  extCalldata: '0x',
  needScale: false,
}
const AGGREGATOR = {
  swapType: 1,
  extRouter: STRANGER,
  extCalldata: '0xdeadbeef',
  needScale: false,
}
const APPROX = {
  guessMin: 0,
  guessMax: MaxUint256,
  guessOffchain: 0,
  maxIteration: 256,
  eps: 10n ** 14n,
}
const EMPTY_LIMIT = {
  limitRouter: getAddress(toBeHex(0, 20)),
  epsSkipMarket: 0,
  normalFills: [],
  flashFills: [],
  optData: '0x',
}
const FILL = {
  order: {
    salt: 1,
    expiry: 2_000_000_000,
    nonce: 0,
    orderType: 0,
    token: WETH,
    YT: STRANGER,
    maker: STRANGER,
    receiver: STRANGER,
    makingAmount: e18(10n),
    lnImpliedRate: 1,
    failSafeRate: 0,
    permit: '0x',
  },
  signature: '0x',
  makingAmount: e18(10n),
}
const ZERO = EMPTY_LIMIT.limitRouter

const input = (token: string, amount: bigint, o: object = {}) => ({
  tokenIn: token,
  netTokenIn: amount,
  tokenMintSy: token,
  pendleSwap: ZERO,
  swapData: NO_SWAP,
  ...o,
})
const output = (token: string, o: object = {}) => ({
  tokenOut: token,
  minTokenOut: 0,
  tokenRedeemSy: token,
  pendleSwap: ZERO,
  swapData: NO_SWAP,
  ...o,
})
const limit = (o: object = {}) => ({ ...EMPTY_LIMIT, ...o })
const call = (name: string, args: unknown[]) =>
  router.encodeFunctionData(name, args)
const buyPt = (
  market: string,
  inp: object,
  o: { receiver?: string; limit?: object } = {}
) =>
  call('swapExactTokenForPt', [
    o.receiver ?? AVATAR,
    market,
    0,
    APPROX,
    inp,
    o.limit ?? limit(),
  ])
const sellPt = (
  market: string,
  amount: bigint,
  out: object,
  receiver: string = AVATAR
) => call('swapExactPtForToken', [receiver, market, amount, out, limit()])
const redeem = (
  yt: string,
  amount: bigint,
  out: object,
  receiver: string = AVATAR
) => call('redeemPyToToken', [receiver, yt, amount, out])
const exit = (
  market: string,
  netPtIn: bigint,
  netLpIn: bigint,
  out: object,
  receiver: string = AVATAR
) => call('exitPostExpToToken', [receiver, market, netPtIn, netLpIn, out])
const exitPreExp = (
  market: string,
  [netPtIn, netYtIn, netLpIn]: [bigint, bigint, bigint],
  out: object,
  o: { receiver?: string; limit?: object } = {}
) =>
  call('exitPreExpToToken', [
    o.receiver ?? AVATAR,
    market,
    netPtIn,
    netYtIn,
    netLpIn,
    out,
    o.limit ?? limit(),
  ])
const addLp = (market: string, inp: object, receiver: string = AVATAR) =>
  call('addLiquiditySingleToken', [receiver, market, 0, APPROX, inp, limit()])
const removeLp = (market: string, amount: bigint, out: object) =>
  call('removeLiquiditySingleToken', [AVATAR, market, amount, out, limit()])
const claim = (user: string, sys: string[], yts: string[], markets: string[]) =>
  call('redeemDueInterestAndRewards', [user, sys, yts, markets])
// The app's claim: `pendleSwap` set, no swaps
const claimV2 = (
  sys: string[],
  yts: object[],
  markets: string[],
  swaps: object[] = []
) =>
  call('redeemDueInterestAndRewardsV2', [sys, yts, markets, PENDLE_SWAP, swaps])
const ytIncome = (yt: string, o: object = {}) => ({
  yt,
  doRedeemInterest: true,
  doRedeemRewards: true,
  tokenRedeemSy: SUSDE,
  minTokenRedeemOut: 0,
  ...o,
})
const approve = (spender: string) =>
  erc20.encodeFunctionData('approve', [spender, MaxUint256])

// Pendle's Convert API, the backend of its SDK, with the avatar as receiver.
const convert = async (
  tokenIn: string,
  amount: bigint,
  tokenOut: string,
  options: Record<string, string>
) => {
  const query = new URLSearchParams({
    receiver: AVATAR,
    slippage: '0.01',
    tokensIn: tokenIn,
    amountsIn: String(amount),
    tokensOut: tokenOut,
    ...options,
  })
  const response = await fetch(
    `https://api-v2.pendle.finance/core/v2/sdk/1/convert?${query}`
  )
  if (!response.ok)
    throw new Error(
      `Convert API answered ${response.status}: ${await response.text()}`
    )
  const { routes } = (await response.json()) as {
    routes: {
      tx: { to: string; data: string }
      contractParamInfo: {
        method: string
        contractCallParamsName: string[]
        contractCallParams: any[]
      }
    }[]
  }
  const { tx, contractParamInfo: info } = routes[0]!
  expect(getAddress(tx.to)).toBe(ROUTER)
  const limitData =
    info.contractCallParams[info.contractCallParamsName.indexOf('limit')]
  const fills =
    limitData == null
      ? 0
      : limitData.normalFills.length + limitData.flashFills.length
  return { data: tx.data, method: info.method, fills }
}
const PLAIN = { enableAggregator: 'false', useLimitOrder: 'false' }

const balanceSlot = (holder: string, index: number) =>
  keccak256(abi.encode(['address', 'uint256'], [holder, index]))
const word = (value: bigint) => zeroPadValue(toBeHex(value), 32)
const ONE_WEEK = 7n * 24n * 60n * 60n

// The website's calls, recorded with another Safe as the receiver. They carry
// the price limits of the recording's block, so an allowed one only has to
// pass the Roles mod: Pendle may revert it once the market has moved.
const recordedSafe = app.safe.slice(2).toLowerCase()
// The router functions the app's role allows
const APP_FUNCTIONS = [
  'swapExactTokenForPt',
  'swapExactPtForToken',
  'redeemPyToToken',
  'exitPostExpToToken',
  'exitPreExpToToken',
  'redeemDueInterestAndRewardsV2',
]
const fromApp = (flow: string) =>
  app.calls
    .filter((c) => c.flow === flow)
    .flatMap(({ to, data }) => {
      const call = data.replaceAll(recordedSafe, AVATAR.slice(2).toLowerCase())
      if (getAddress(to) !== ROUTER)
        return [{ to, data: call, about: 'approve', plain: false }]
      const { name, args } = router.parseTransaction({ data: call })!
      // Roles can't scope the calls inside a multicall; Pilot unfolds it
      const calls: string[] =
        name === 'multicall'
          ? args.calls.map((c: { callData: string }) => c.callData)
          : [call]
      return calls.map((data) => ({ to, data, ...describeAppCall(data) }))
    })
const describeAppCall = (data: string) => {
  const { name, args } = router.parseTransaction({ data })!
  const swap = args.input ?? args.output
  const fills = args.limit
    ? args.limit.normalFills.length + args.limit.flashFills.length
    : 0
  // A TokenInput or TokenOutput through pendleSwap, or a claim's swaps
  const aggregator = swap
    ? swap.pendleSwap !== ZERO
    : (args.swaps?.length ?? 0) > 0
  return {
    about: `${name}${fills ? `, ${fills} limit fills` : ''}${aggregator ? `, ${swap ? `swap type ${swap.swapData.swapType}` : 'swaps'} through pendleSwap` : ''}`,
    plain: APP_FUNCTIONS.includes(name) && fills === 0 && !aggregator,
  }
}

type PendleCase = Case & {
  refusedBy?: 'roles' | 'pendle'
  recorded?: boolean
}

const allowed = (
  label: string,
  role: string,
  to: string,
  data: string
): PendleCase => ({ label, role, to: to as Address, data, allowed: true })
const refused =
  (refusedBy: 'roles' | 'pendle') =>
  (label: string, role: string, to: string, data: string): PendleCase => ({
    label,
    role,
    to: to as Address,
    data,
    allowed: false,
    refusedBy,
  })
const roles = refused('roles')
const byPendle = refused('pendle')
// A recorded flow for `role`: approvals and calls without fills or
// aggregators are allowed, the rest refused by the Roles mod
const fromAppCase =
  (role: string, label: string) =>
  (c: ReturnType<typeof fromApp>[number]): PendleCase =>
    c.about === 'approve'
      ? allowed(`App: ${label}, approve`, role, c.to, c.data)
      : c.plain
        ? {
            ...allowed(`App: ${label} (${c.about})`, role, c.to, c.data),
            recorded: true,
          }
        : roles(`App: ${label} (${c.about})`, role, c.to, c.data)

type Simulated = Awaited<ReturnType<typeof simulate>>

const report = ({ block, failedSetup, cases: results }: Simulated) => {
  console.log(`Ethereum block ${block}`)
  type Result = (typeof results)[number] & PendleCase
  const wrongReason = (c: Result) =>
    !c.allowed &&
    (c.refusedBy === 'roles'
      ? !c.detail.startsWith('ConditionViolation')
      : c.detail !== 'ModuleTransactionFailed')
  // An allowed recorded call runs, or passes the Roles mod and reverts in Pendle
  const failed = (c: Result) =>
    c.recorded
      ? !['executed', 'ModuleTransactionFailed'].includes(c.detail)
      : !c.passed || wrongReason(c)
  for (const c of results as Result[]) {
    console.log(
      `${failed(c) ? 'FAIL' : 'ok  '} ${c.allowed ? 'allowed' : `refused (${c.refusedBy})`.padEnd(17)}  ${c.role.padEnd(11)} ${c.label.padEnd(62)} ${c.detail}`
    )
  }
  expect(failedSetup).toEqual([])
  expect((results as Result[]).filter(failed)).toEqual([])
}

describe.skipIf(!simulationEnabled)('pendle presets on mainnet state', () => {
  it(
    'allow PT, LP and YT trades and block everything else',
    async () => {
      const [wstEthDec27, sUsdeNov26, sUsdeAug26] = await pendleMarkets({
        chain: 1,
        addresses: [WSTETH_DEC27, SUSDE_NOV26, SUSDE_AUG26],
      }).then((found) =>
        [WSTETH_DEC27, SUSDE_NOV26, SUSDE_AUG26].map((a) =>
          found.find((m) => m.market === a)!
        )
      )
      const markets = [wstEthDec27!, sUsdeNov26!, sUsdeAug26!]
      const tokensIn = [
        { token: WETH, allowance: 'pendle_weth' },
        { token: WSTETH, allowance: 'pendle_wsteth' },
        { token: USDE, allowance: 'pendle_usde' },
        { token: SUSDE, allowance: 'pendle_susde' },
      ] as const satisfies readonly PendleTokenIn[]
      const tokensOut = [WSTETH, SUSDE] as const
      const params = { chain: 1 as const, markets }

      const api = {
        buyPtUsde: await convert(USDE, e18(10_000n), sUsdeNov26!.pt, PLAIN),
        buyPtWeth: await convert(WETH, e18(10n), wstEthDec27!.pt, PLAIN),
        sellPt: await convert(sUsdeNov26!.pt, e18(5_000n), SUSDE, PLAIN),
        redeemPt: await convert(sUsdeAug26!.pt, e18(1_000n), SUSDE, PLAIN),
        addLp: await convert(WSTETH, e18(5n), WSTETH_DEC27, PLAIN),
        removeLp: await convert(WSTETH_DEC27, e18(1n), WSTETH, PLAIN),
        buyYt: await convert(USDE, e18(1_000n), sUsdeNov26!.yt, PLAIN),
        sellYt: await convert(sUsdeNov26!.yt, e18(100n), SUSDE, PLAIN),
        buyYtDefaults: await convert(SUSDE, e18(1_000n), sUsdeNov26!.yt, {}),
        buyPtAggregator: await convert(
          USDC,
          10_000n * 10n ** 6n,
          sUsdeNov26!.pt,
          { enableAggregator: 'true', useLimitOrder: 'false' }
        ),
      }
      const via = ({ method, fills }: { method: string; fills: number }) =>
        `${method}${fills ? `, ${fills} limit fills` : ''}`

      const PT = 'pendle_pt'
      const LP = 'pendle_lp'
      const YT = 'pendle_yt'
      // USDe allowance: 50,000 a week. The allowed cases before the allowance
      // cases use 10,000 (PT) and 1,000 (YT), so 39,000 are left.
      const USDE_LEFT = e18(39_000n)
      const APP = 'pendle_app'

      const cases: PendleCase[] = [
        // PT: approvals, then calls from Pendle's Convert API, then calls built here
        allowed('approve WETH', PT, WETH, approve(ROUTER)),
        allowed('approve USDe', PT, USDE, approve(ROUTER)),
        allowed('approve sUSDe', PT, SUSDE, approve(ROUTER)),
        ...markets.map((m) =>
          allowed(
            `approve PT of ${m.name} ${m.expiry?.toISOString().slice(0, 10)}`,
            PT,
            m.pt,
            approve(ROUTER)
          )
        ),
        allowed(
          `API: buy PT with 10,000 USDe (${via(api.buyPtUsde)})`,
          PT,
          ROUTER,
          api.buyPtUsde.data
        ),
        allowed(
          `API: buy PT with 10 WETH, unwrapped (${via(api.buyPtWeth)})`,
          PT,
          ROUTER,
          api.buyPtWeth.data
        ),
        allowed(
          `API: sell 5,000 PT for sUSDe (${via(api.sellPt)})`,
          PT,
          ROUTER,
          api.sellPt.data
        ),
        allowed(
          `API: redeem 1,000 expired PT (${via(api.redeemPt)})`,
          PT,
          ROUTER,
          api.redeemPt.data
        ),
        allowed(
          'buy PT with 10 WETH, deposited as WETH',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(10n)))
        ),
        allowed(
          'sell 5 PT for wstETH',
          PT,
          ROUTER,
          sellPt(WSTETH_DEC27, e18(5n), output(WSTETH))
        ),
        allowed(
          'buy PT with 5,000 sUSDe',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(SUSDE, e18(5_000n)))
        ),
        allowed(
          'redeem 500 expired PT',
          PT,
          ROUTER,
          redeem(sUsdeAug26!.yt, e18(500n), output(SUSDE))
        ),
        byPendle(
          'redeem PT before expiry, no YT approval yet',
          PT,
          ROUTER,
          redeem(sUsdeNov26!.yt, e18(1n), output(SUSDE))
        ),
        // LP
        allowed('approve wstETH', LP, WSTETH, approve(ROUTER)),
        allowed(
          'approve LP wstETH Dec 2027',
          LP,
          WSTETH_DEC27,
          approve(ROUTER)
        ),
        allowed(
          'approve LP sUSDe Aug 2026 (expired)',
          LP,
          SUSDE_AUG26,
          approve(ROUTER)
        ),
        // The app's exit route, only for markets that had already expired
        allowed(
          'exit 200 expired PT (exitPostExpToToken)',
          PT,
          ROUTER,
          exit(SUSDE_AUG26, e18(200n), 0n, output(SUSDE))
        ),
        allowed(
          'exit 100 expired PT and 50 LP in one call (LP approval above)',
          PT,
          ROUTER,
          exit(SUSDE_AUG26, e18(100n), e18(50n), output(SUSDE))
        ),
        roles(
          'exit a market before its expiry',
          PT,
          ROUTER,
          exit(SUSDE_NOV26, e18(1n), 0n, output(SUSDE))
        ),
        roles(
          'exit for a stranger',
          PT,
          ROUTER,
          exit(SUSDE_AUG26, e18(1n), 0n, output(SUSDE), STRANGER)
        ),
        roles(
          'exit through an aggregator',
          PT,
          ROUTER,
          exit(
            SUSDE_AUG26,
            e18(1n),
            0n,
            output(SUSDE, { pendleSwap: PENDLE_SWAP, swapData: AGGREGATOR })
          )
        ),
        allowed(
          `API: add liquidity with 5 wstETH (${via(api.addLp)})`,
          LP,
          ROUTER,
          api.addLp.data
        ),
        allowed(
          `API: remove 1 LP for wstETH (${via(api.removeLp)})`,
          LP,
          ROUTER,
          api.removeLp.data
        ),
        allowed(
          'remove 100 LP of the expired market',
          LP,
          ROUTER,
          removeLp(SUSDE_AUG26, e18(100n), output(SUSDE))
        ),
        allowed(
          'claim rewards of the wstETH market',
          LP,
          ROUTER,
          claim(AVATAR, [wstEthDec27!.sy], [], [WSTETH_DEC27])
        ),
        // YT
        allowed(
          'approve YT sUSDe Nov 2026',
          YT,
          sUsdeNov26!.yt,
          approve(ROUTER)
        ),
        allowed(
          `API: buy YT with 1,000 USDe (${via(api.buyYt)})`,
          YT,
          ROUTER,
          api.buyYt.data
        ),
        allowed(
          `API: sell 100 YT for sUSDe (${via(api.sellYt)})`,
          YT,
          ROUTER,
          api.sellYt.data
        ),
        allowed(
          'claim YT interest',
          YT,
          ROUTER,
          claim(AVATAR, [], [sUsdeNov26!.yt], [])
        ),
        // An approval belongs to the Safe, not to the preset that gave it
        allowed(
          'PT role redeems PT + YT before expiry with the YT approval',
          PT,
          ROUTER,
          redeem(sUsdeNov26!.yt, e18(1n), output(SUSDE))
        ),
        // The weekly USDe allowance
        roles(
          'buy PT with 39,001 USDe (1 USDe over the allowance)',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(USDE, USDE_LEFT + e18(1n)))
        ),
        allowed(
          'buy PT with 39,000 USDe (the rest of the allowance)',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(USDE, USDE_LEFT))
        ),
        roles(
          'buy PT with 1 more USDe',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(USDE, e18(1n)))
        ),
        // Stopped at the Roles mod
        {
          ...refused(api.buyYtDefaults.fills > 0 ? 'roles' : 'pendle')(
            `API defaults: buy YT with 1,000 sUSDe (${via(api.buyYtDefaults)})`,
            YT,
            ROUTER,
            api.buyYtDefaults.data
          ),
          allowed: api.buyYtDefaults.fills === 0,
        },
        roles(
          `API with aggregator: buy PT with USDC (${via(api.buyPtAggregator)})`,
          PT,
          ROUTER,
          api.buyPtAggregator.data
        ),
        roles(
          'approve WETH to a stranger',
          PT,
          WETH,
          erc20.encodeFunctionData('approve', [STRANGER, 1])
        ),
        roles(
          'approve PT to a stranger',
          PT,
          wstEthDec27!.pt,
          erc20.encodeFunctionData('approve', [STRANGER, 1])
        ),
        roles(
          'buy PT for a stranger',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n)), { receiver: STRANGER })
        ),
        roles(
          'buy PT in an unlisted market',
          PT,
          ROUTER,
          buyPt(UNLISTED_MARKET, input(SUSDE, e18(1_000n)))
        ),
        roles(
          'buy PT through an aggregator',
          PT,
          ROUTER,
          buyPt(
            WSTETH_DEC27,
            input(WETH, e18(1n), {
              pendleSwap: PENDLE_SWAP,
              swapData: AGGREGATOR,
            })
          )
        ),
        roles(
          'buy PT with pendleSwap set',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n), { pendleSwap: PENDLE_SWAP }))
        ),
        roles(
          'buy PT filling a limit order',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n)), {
            limit: limit({ limitRouter: LIMIT_ROUTER, normalFills: [FILL] }),
          })
        ),
        roles(
          'buy PT with a flash fill',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n)), {
            limit: limit({ limitRouter: LIMIT_ROUTER, flashFills: [FILL] }),
          })
        ),
        roles(
          'buy PT with a fill and limitRouter 0',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n)), {
            limit: limit({ normalFills: [FILL] }),
          })
        ),
        roles(
          'buy PT with a stranger as limitRouter',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n)), {
            limit: limit({ limitRouter: STRANGER }),
          })
        ),
        roles(
          'buy PT, tokenIn WETH but tokenMintSy wstETH',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WETH, e18(1n), { tokenMintSy: WSTETH }))
        ),
        roles(
          'buy PT with ETH',
          PT,
          ROUTER,
          buyPt(WSTETH_DEC27, input(ZERO, e18(1n)))
        ),
        roles(
          'buy PT with an unlisted token (USDC)',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(USDC, 1_000n * 10n ** 6n))
        ),
        roles(
          'sell PT for a stranger',
          PT,
          ROUTER,
          sellPt(WSTETH_DEC27, e18(1n), output(WSTETH), STRANGER)
        ),
        roles(
          'sell PT through an aggregator',
          PT,
          ROUTER,
          sellPt(
            WSTETH_DEC27,
            e18(1n),
            output(WSTETH, { pendleSwap: PENDLE_SWAP, swapData: AGGREGATOR })
          )
        ),
        roles(
          'sell PT for an unlisted token (WETH)',
          PT,
          ROUTER,
          sellPt(WSTETH_DEC27, e18(1n), output(WETH))
        ),
        roles(
          'redeem PT for a stranger',
          PT,
          ROUTER,
          redeem(sUsdeAug26!.yt, e18(1n), output(SUSDE), STRANGER)
        ),
        roles(
          'redeem PT of an unlisted YT',
          PT,
          ROUTER,
          redeem(UNLISTED_YT, e18(1n), output(SUSDE))
        ),
        roles(
          'multicall',
          PT,
          ROUTER,
          call('multicall', [
            [
              {
                allowFailure: false,
                callData: buyPt(WSTETH_DEC27, input(WETH, e18(1n))),
              },
            ],
          ])
        ),
        roles(
          'callAndReflect',
          PT,
          ROUTER,
          call('callAndReflect', [STRANGER, '0x', '0x', '0x'])
        ),
        roles(
          'swapExactTokenForPtSimple',
          PT,
          ROUTER,
          call('swapExactTokenForPtSimple', [
            AVATAR,
            WSTETH_DEC27,
            0,
            input(WETH, e18(1n)),
          ])
        ),
        roles(
          'add liquidity for a stranger',
          LP,
          ROUTER,
          addLp(WSTETH_DEC27, input(WSTETH, e18(1n)), STRANGER)
        ),
        roles(
          'remove liquidity through an aggregator',
          LP,
          ROUTER,
          removeLp(
            WSTETH_DEC27,
            e18(1n),
            output(WSTETH, { pendleSwap: PENDLE_SWAP, swapData: AGGREGATOR })
          )
        ),
        roles(
          'claim for a stranger',
          LP,
          ROUTER,
          claim(STRANGER, [wstEthDec27!.sy], [], [WSTETH_DEC27])
        ),
        roles(
          'claim from an unlisted market',
          LP,
          ROUTER,
          claim(AVATAR, [], [], [UNLISTED_MARKET])
        ),
        roles(
          'PT role adds liquidity',
          PT,
          ROUTER,
          addLp(WSTETH_DEC27, input(WSTETH, e18(1n)))
        ),
        roles('PT role approves YT', PT, sUsdeNov26!.yt, approve(ROUTER)),
        roles(
          'LP role buys PT',
          LP,
          ROUTER,
          buyPt(WSTETH_DEC27, input(WSTETH, e18(1n)))
        ),
        roles(
          'YT role redeems PT',
          YT,
          ROUTER,
          redeem(sUsdeAug26!.yt, e18(1n), output(SUSDE))
        ),
        // Through the Roles mod, refused by Pendle
        byPendle(
          'buy PT in the expired market',
          PT,
          ROUTER,
          buyPt(SUSDE_AUG26, input(SUSDE, e18(1_000n)))
        ),
        byPendle(
          'pay WETH into the sUSDe market',
          PT,
          ROUTER,
          buyPt(SUSDE_NOV26, input(WETH, e18(1n)))
        ),
        // What app.pendle.finance sends, with its default settings unless the
        // label says otherwise: limit-order fills when the book matches, an
        // aggregator when its quote is better, exitPostExpToToken to redeem
        // after the expiry
        ...fromApp('buy_pt_1000_susde').map(
          fromAppCase(APP, 'buy PT with 1,000 sUSDe')
        ),
        ...fromApp('buy_pt_200000_susde').map(
          fromAppCase(APP, 'buy PT with 200,000 sUSDe')
        ),
        ...fromApp('sell_pt_1000_susde').map(
          fromAppCase(APP, 'sell 1,000 PT for sUSDe')
        ),
        ...fromApp('redeem_expired_pt_1000').map(
          fromAppCase(APP, 'redeem 1,000 expired PT')
        ),
        ...fromApp('buy_pt_10000_usde').map(
          fromAppCase(APP, 'buy PT with 10,000 USDe')
        ),
        ...fromApp('buy_pt_10000_usde_no_aggregators').map(
          fromAppCase(APP, 'aggregators off, buy PT with 10,000 USDe')
        ),
      ]

      const simulated = await simulate({
        rpc: RPC,
        roles: {
          [PT]: [
            pendle.buyPt({ ...params, tokens: tokensIn }),
            pendle.sellPt({ ...params, tokens: tokensOut }),
            pendle.redeem({ ...params, tokens: tokensOut }),
          ],
          [LP]: [
            pendle.addLiquidity({ ...params, tokens: tokensIn }),
            pendle.removeLiquidity({ ...params, tokens: tokensOut }),
            pendle.claim(params),
          ],
          [YT]: [
            pendle.buyYt({ ...params, tokens: tokensIn }),
            pendle.sellYt({ ...params, tokens: tokensOut }),
            pendle.claim(params),
          ],
          // The PT presets without the allowances, which the cases above use up
          [APP]: [
            pendle.buyPt({
              ...params,
              tokens: [
                { token: WETH },
                { token: WSTETH },
                { token: USDE },
                { token: SUSDE },
              ],
            }),
            pendle.sellPt({ ...params, tokens: tokensOut }),
            pendle.redeem({ ...params, tokens: tokensOut }),
          ],
        },
        allowances: [
          { key: 'pendle_weth', balance: e18(100n), period: ONE_WEEK },
          { key: 'pendle_wsteth', balance: e18(100n), period: ONE_WEEK },
          { key: 'pendle_usde', balance: e18(50_000n), period: ONE_WEEK },
          { key: 'pendle_susde', balance: e18(50_000n), period: ONE_WEEK },
        ],
        stateOverrides: {
          // balanceOf slots: WETH9 3, wstETH 0, USDe 2, sUSDe 4, PT 0, market (LP) 3
          [WETH]: { stateDiff: { [balanceSlot(AVATAR, 3)]: word(e18(100n)) } },
          [WSTETH]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(e18(100n)) },
          },
          [USDE]: {
            stateDiff: { [balanceSlot(AVATAR, 2)]: word(e18(200_000n)) },
          },
          [SUSDE]: {
            stateDiff: { [balanceSlot(AVATAR, 4)]: word(e18(100_000n)) },
          },
          [sUsdeAug26!.pt]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(e18(10_000n)) },
          },
          [SUSDE_AUG26]: {
            stateDiff: { [balanceSlot(AVATAR, 3)]: word(e18(1_000n)) },
          },
        },
        cases,
      })

      report(simulated)
    },
    { timeout: 180_000 }
  )

  // A run of its own: the Roles mod's setup and the cases above already use
  // most of the gas an RPC grants one eth_simulateV1 call (50M on geth).
  it(
    "allow the app's exit before the expiry and its claim, and block the rest",
    async () => {
      const [sUsdeNov26] = await pendleMarkets({
        chain: 1,
        addresses: [SUSDE_NOV26],
      })
      const params = { chain: 1 as const, markets: [sUsdeNov26!] }
      const EXIT = 'pendle_exit'
      const LP = 'pendle_lp'

      const cases: PendleCase[] = [
        // The app's Withdraw tab with its defaults: PT, YT and LP ticked,
        // "Claim LP and YT Rewards" on
        ...fromApp('exit_all_claim').map(
          fromAppCase(EXIT, 'exit 5,000 PT, 5,000 YT and 1,000 LP, claim on')
        ),
        // Built here
        ...[SUSDE_NOV26, sUsdeNov26!.pt, sUsdeNov26!.yt].map((token, i) =>
          allowed(
            `approve ${['LP', 'PT', 'YT'][i]} sUSDe Nov 2026`,
            EXIT,
            token,
            approve(ROUTER)
          )
        ),
        allowed(
          'exit 100 PT, 100 YT and 10 LP before the expiry',
          EXIT,
          ROUTER,
          exitPreExp(
            SUSDE_NOV26,
            [e18(100n), e18(100n), e18(10n)],
            output(SUSDE)
          )
        ),
        allowed(
          'exit 50 PT alone, sold on the market',
          EXIT,
          ROUTER,
          exitPreExp(SUSDE_NOV26, [e18(50n), 0n, 0n], output(SUSDE))
        ),
        allowed(
          'claim LP rewards through V2, as the app does',
          EXIT,
          ROUTER,
          claimV2([], [], [SUSDE_NOV26])
        ),
        allowed('approve SY sUSDe', EXIT, sUsdeNov26!.sy, approve(ROUTER)),
        allowed(
          'claim YT interest and SY rewards through V2, paid as sUSDe',
          EXIT,
          ROUTER,
          claimV2([sUsdeNov26!.sy], [ytIncome(sUsdeNov26!.yt)], [SUSDE_NOV26])
        ),
        roles(
          'exit for a stranger',
          EXIT,
          ROUTER,
          exitPreExp(SUSDE_NOV26, [e18(1n), e18(1n), 0n], output(SUSDE), {
            receiver: STRANGER,
          })
        ),
        roles(
          'exit an unlisted market',
          EXIT,
          ROUTER,
          exitPreExp(UNLISTED_MARKET, [e18(1n), e18(1n), 0n], output(SUSDE))
        ),
        roles(
          'exit through an aggregator',
          EXIT,
          ROUTER,
          exitPreExp(
            SUSDE_NOV26,
            [e18(1n), e18(1n), 0n],
            output(SUSDE, { pendleSwap: PENDLE_SWAP, swapData: AGGREGATOR })
          )
        ),
        roles(
          'exit for an unlisted token (USDe)',
          EXIT,
          ROUTER,
          exitPreExp(SUSDE_NOV26, [e18(1n), e18(1n), 0n], output(USDE))
        ),
        roles(
          'exit filling a limit order',
          EXIT,
          ROUTER,
          exitPreExp(SUSDE_NOV26, [e18(1n), 0n, 0n], output(SUSDE), {
            limit: limit({ limitRouter: LIMIT_ROUTER, normalFills: [FILL] }),
          })
        ),
        roles(
          'claim through V2 with a swap through pendleSwap',
          EXIT,
          ROUTER,
          claimV2(
            [],
            [],
            [SUSDE_NOV26],
            [
              {
                tokenIn: SUSDE,
                tokenOut: USDC,
                minOut: 0,
                swapData: AGGREGATOR,
              },
            ]
          )
        ),
        roles(
          'claim through V2 from an unlisted market',
          EXIT,
          ROUTER,
          claimV2([], [], [UNLISTED_MARKET])
        ),
        roles(
          'claim interest of an unlisted YT through V2',
          EXIT,
          ROUTER,
          claimV2([], [ytIncome(UNLISTED_YT)], [])
        ),
        roles(
          'claim rewards of an unlisted SY through V2',
          EXIT,
          ROUTER,
          claimV2([STRANGER], [], [])
        ),
        roles(
          'LP role exits PT and YT',
          LP,
          ROUTER,
          exitPreExp(SUSDE_NOV26, [e18(1n), e18(1n), 0n], output(SUSDE))
        ),
      ]

      const simulated = await simulate({
        rpc: RPC,
        roles: {
          [EXIT]: [
            pendle.exit({ ...params, tokens: [SUSDE] }),
            pendle.claim(params),
          ],
          [LP]: [pendle.removeLiquidity({ ...params, tokens: [SUSDE] })],
        },
        // balanceOf slots: PT and YT 0, market (LP) 3
        stateOverrides: {
          [sUsdeNov26!.pt]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(e18(10_000n)) },
          },
          [sUsdeNov26!.yt]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(e18(10_000n)) },
          },
          [SUSDE_NOV26]: {
            stateDiff: { [balanceSlot(AVATAR, 3)]: word(e18(2_000n)) },
          },
        },
        cases,
      })

      report(simulated)
    },
    { timeout: 180_000 }
  )
})
