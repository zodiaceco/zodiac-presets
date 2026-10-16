import { describe, expect, it } from 'bun:test'
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  keccak256,
  parseEther,
  toBeHex,
  ZeroAddress,
  ZeroHash,
  zeroPadValue,
} from 'ethers'
import { gmx, GMX, GMX_UI_FEE_RECEIVER, type GmxChain } from '.'
import exchangeRouterAbi from '../../abis/any/gmx_exchange_router.json'
import subaccountRouterAbi from '../../abis/any/gmx_subaccount_router.json'
import glvRouterAbi from '../../abis/any/gmx_glv_router.json'
import claimHandlerAbi from '../../abis/any/gmx_claim_handler.json'
import {
  AVATAR,
  simulate,
  simulationEnabled,
  STRANGER,
  type Case,
} from '../test/simulate'

// The GMX presets against Arbitrum state: the avatar registers as its own
// subaccount, opens and closes positions, deposits into and withdraws from GM
// and GLV, sets up a trading key, claims, and revokes; every call that would
// hand funds or rights to someone else stops at the Roles mod. GMX accepts
// each allowed request (it reaches the vaults; keepers would execute it).
// Run with `bun test:sim`.

const RPC: Record<GmxChain, string> = {
  42161: process.env.RPC_42161 ?? 'https://arbitrum-one-rpc.publicnode.com',
  43114:
    process.env.RPC_43114 ?? 'https://avalanche-c-chain-rpc.publicnode.com',
  4326: process.env.RPC_4326 ?? 'https://mainnet.megaeth.com/rpc',
}

const A = GMX[42161]
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
const GM_ETH = '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336' // ETH/USD [WETH-USDC]
const GM_BTC = '0x47c031236e19d024b42f8AE6780E44A573170703' // BTC/USD [WBTC-USDC]
const GM_SOL = '0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9' // SOL/USD, not listed
const GLV_ETH = '0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9' // GLV [WETH-USDC]
const GLV_BTC = '0xdF03EEd325b82bC1d4Db8b49c30ecc9E05104b96' // not listed
const KEY = '0x0000000000000000000000000000000005ab0001'
const OTHER_KEY = '0x0000000000000000000000000000000005ab0002'
const ORDER_ACTION = keccak256(
  AbiCoder.defaultAbiCoder().encode(['string'], ['SUBACCOUNT_ORDER_ACTION'])
)

const er = new Interface(exchangeRouterAbi)
const sub = new Interface(subaccountRouterAbi)
const glv = new Interface(glvRouterAbi)
const claims = new Interface(claimHandlerAbi)
const erc20 = new Interface(['function approve(address,uint256)'])

const usd = (n: bigint) => n * 10n ** 30n
const usdc = (n: bigint) => n * 10n ** 6n
const FEE = parseEther('0.0003')
const DAY = 24n * 60n * 60n
const at = (date: string) => BigInt(Date.parse(date) / 1000)

type Order = Partial<{
  receiver: string
  cancellationReceiver: string
  callbackContract: string
  uiFeeReceiver: string
  market: string
  collateral: string
  swapPath: string[]
  size: bigint
  amount: bigint
  orderType: number
  referralCode: string
}>
const params = (o: Order = {}) => ({
  addresses: {
    receiver: o.receiver ?? AVATAR,
    cancellationReceiver: o.cancellationReceiver ?? ZeroAddress,
    callbackContract: o.callbackContract ?? ZeroAddress,
    uiFeeReceiver: o.uiFeeReceiver ?? GMX_UI_FEE_RECEIVER,
    market: o.market ?? GM_ETH,
    initialCollateralToken: o.collateral ?? USDC,
    swapPath: o.swapPath ?? [],
  },
  numbers: {
    sizeDeltaUsd: o.size ?? usd(250_000n),
    initialCollateralDeltaAmount: o.amount ?? usdc(10_000n),
    triggerPrice: o.orderType === 3 ? 2_000n * 10n ** 12n : 0n,
    acceptablePrice: o.orderType === 4 ? 0n : 2n ** 255n,
    executionFee: FEE,
    callbackGasLimit: o.callbackContract ? 100_000n : 0n,
    minOutputAmount: 0n,
    validFromTime: 0n,
  },
  orderType: o.orderType ?? 2, // MarketIncrease
  decreasePositionSwapType: 0,
  isLong: true,
  shouldUnwrapNativeToken: false,
  autoCancel: false,
  referralCode: o.referralCode ?? ZeroHash,
  dataList: [],
})
const order = (o: Order = {}, account: string = AVATAR) =>
  sub.encodeFunctionData('createOrder', [account, params(o)])
const SMALL = { size: usd(1_000n), amount: usdc(100n) }
const DECREASE = { orderType: 4, size: usd(100_000n), amount: 0n }

const depositParams = (
  o: Partial<{ receiver: string; market: string; callback: string }> = {}
) => ({
  addresses: {
    receiver: o.receiver ?? AVATAR,
    callbackContract: o.callback ?? ZeroAddress,
    uiFeeReceiver: GMX_UI_FEE_RECEIVER,
    market: o.market ?? GM_ETH,
    initialLongToken: WETH,
    initialShortToken: USDC,
    longTokenSwapPath: [],
    shortTokenSwapPath: [],
  },
  minMarketTokens: 0n,
  shouldUnwrapNativeToken: false,
  executionFee: FEE,
  callbackGasLimit: 0n,
  dataList: [],
})
const withdrawalParams = (
  o: Partial<{ receiver: string; market: string }> = {}
) => ({
  addresses: {
    receiver: o.receiver ?? AVATAR,
    callbackContract: ZeroAddress,
    uiFeeReceiver: GMX_UI_FEE_RECEIVER,
    market: o.market ?? GM_ETH,
    longTokenSwapPath: [],
    shortTokenSwapPath: [],
  },
  minLongTokenAmount: 0n,
  minShortTokenAmount: 0n,
  shouldUnwrapNativeToken: false,
  executionFee: FEE,
  callbackGasLimit: 0n,
  dataList: [],
})
const glvDepositParams = (
  o: Partial<{ glv: string; isMarketTokenDeposit: boolean }> = {}
) => ({
  addresses: {
    glv: o.glv ?? GLV_ETH,
    market: o.glv === GLV_BTC ? GM_BTC : GM_ETH,
    receiver: AVATAR,
    callbackContract: ZeroAddress,
    uiFeeReceiver: GMX_UI_FEE_RECEIVER,
    initialLongToken: WETH,
    initialShortToken: USDC,
    longTokenSwapPath: [],
    shortTokenSwapPath: [],
  },
  minGlvTokens: 0n,
  executionFee: FEE,
  callbackGasLimit: 0n,
  shouldUnwrapNativeToken: false,
  isMarketTokenDeposit: o.isMarketTokenDeposit ?? false,
  dataList: [],
})
const glvWithdrawalParams = (receiver: string = AVATAR) => ({
  addresses: {
    receiver,
    callbackContract: ZeroAddress,
    uiFeeReceiver: GMX_UI_FEE_RECEIVER,
    market: GM_ETH,
    glv: GLV_ETH,
    longTokenSwapPath: [],
    shortTokenSwapPath: [],
  },
  minLongTokenAmount: 0n,
  minShortTokenAmount: 0n,
  shouldUnwrapNativeToken: false,
  executionFee: FEE,
  callbackGasLimit: 0n,
  dataList: [],
})

const call = (
  label: string,
  role: string,
  to: string,
  data: string,
  allowed: boolean,
  value?: bigint
): Case => ({ label, role, to: to as `0x${string}`, data, allowed, value })
const fee = (role: string, vault: string, router: string = A.exchangeRouter) =>
  call(
    `fee to the ${vault === A.orderVault ? 'OrderVault' : vault === A.glvVault ? 'GlvVault' : vault === A.depositVault ? 'DepositVault' : 'WithdrawalVault'}`,
    role,
    router,
    er.encodeFunctionData('sendWnt', [vault, FEE]),
    true,
    FEE
  )

const balanceSlot = (holder: string, index: number) =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, index])
  )
const word = (value: bigint) => zeroPadValue(toBeHex(value), 32)

const T = 'gmx_trader'
const O = 'gmx_own_subaccount'
const L = 'gmx_lp'
const K = 'gmx_keys'
const G = 'gmx_guardian'
const C = 'gmx_claims'

describe.skipIf(!simulationEnabled)('gmx presets on Arbitrum state', () => {
  it(
    'allow the trading, liquidity and claim flows and block everything else',
    async () => {
      const { block, failedSetup, cases } = await simulate({
        rpc: RPC[42161],
        roles: {
          [O]: [
            gmx.ownSubaccount({
              chain: 42161,
              expiresBefore: new Date('2028-01-01T00:00:00Z'),
              maxActions: 100_000n,
            }),
          ],
          [T]: [
            gmx.trade({
              chain: 42161,
              markets: [GM_ETH, GM_BTC],
              collateral: [
                {
                  token: USDC,
                  allowance: 'gmx_usdc',
                  maxApproval: usdc(250_000n),
                },
                { token: WETH, allowance: 'gmx_weth' },
              ],
              maxOrderSizeUsd: 250_000,
              sizeAllowance: 'gmx_size',
              maxExecutionFee: parseEther('0.01'),
              feeAllowance: 'gmx_fees',
            }),
          ],
          [L]: [
            gmx.deposit({
              chain: 42161,
              markets: [GM_ETH],
              glvs: [{ token: GLV_ETH, markets: [GM_ETH] }],
              tokens: [{ token: USDC, allowance: 'gmx_usdc_lp' }],
              maxExecutionFee: parseEther('0.01'),
              feeAllowance: 'gmx_fees',
            }),
            gmx.withdraw({
              chain: 42161,
              markets: [{ token: GM_ETH, allowance: 'gmx_gm' }],
              glvs: [
                { token: GLV_ETH, allowance: 'gmx_glv', markets: [GM_ETH] },
              ],
              maxExecutionFee: parseEther('0.01'),
              feeAllowance: 'gmx_fees',
            }),
          ],
          [K]: [
            gmx.tradingKeys({
              chain: 42161,
              keys: [KEY],
              expiresBefore: new Date('2027-01-01T00:00:00Z'),
              maxActions: 500n,
              maxTopUp: parseEther('0.002'),
            }),
          ],
          [G]: [gmx.revoke({ chain: 42161, tokens: [USDC, WETH] })],
          [C]: [gmx.claim({ chain: 42161 })],
        },
        allowances: [
          { key: 'gmx_usdc', balance: usdc(500_000n), period: DAY },
          { key: 'gmx_weth', balance: parseEther('200'), period: DAY },
          // 600k left today: two orders of 250k pass, a third does not
          {
            key: 'gmx_size',
            balance: usd(600_000n),
            refill: usd(2_000_000n),
            period: DAY,
          },
          { key: 'gmx_fees', balance: parseEther('0.2'), period: DAY },
          { key: 'gmx_usdc_lp', balance: usdc(1_000_000n), period: DAY },
          { key: 'gmx_gm', balance: parseEther('500000'), period: DAY },
          { key: 'gmx_glv', balance: parseEther('500000'), period: DAY },
        ],
        stateOverrides: {
          // FiatTokenV2_2 (slot 9), aeWETH (slot 51), GM and GLV tokens (slot 0)
          [USDC]: {
            stateDiff: { [balanceSlot(AVATAR, 9)]: word(usdc(5_000_000n)) },
          },
          [WETH]: {
            stateDiff: { [balanceSlot(AVATAR, 51)]: word(parseEther('100')) },
          },
          [GM_ETH]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(parseEther('10000')) },
          },
          [GLV_ETH]: {
            stateDiff: { [balanceSlot(AVATAR, 0)]: word(parseEther('1000')) },
          },
        },
        cases: [
          // The avatar as its own subaccount
          call(
            'register the avatar as its own subaccount',
            O,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [AVATAR]),
            true
          ),
          call(
            'expiry 2027-06-30',
            O,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountExpiresAt', [
              AVATAR,
              ORDER_ACTION,
              at('2027-06-30'),
            ]),
            true
          ),
          call(
            '10,000 actions',
            O,
            A.subaccountRouter,
            sub.encodeFunctionData('setMaxAllowedSubaccountActionCount', [
              AVATAR,
              ORDER_ACTION,
              10_000n,
            ]),
            true
          ),
          call(
            'expiry past the cap',
            O,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountExpiresAt', [
              AVATAR,
              ORDER_ACTION,
              at('2028-06-30'),
            ]),
            false
          ),
          call(
            'register a stranger',
            O,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [STRANGER]),
            false
          ),

          // Trading
          call(
            'approve 250k USDC to the Router',
            T,
            USDC,
            erc20.encodeFunctionData('approve', [A.router, usdc(250_000n)]),
            true
          ),
          call(
            'approve WETH to the Router',
            T,
            WETH,
            erc20.encodeFunctionData('approve', [A.router, parseEther('10')]),
            true
          ),
          fee(T, A.orderVault),
          call(
            'open long ETH/USD 250k USD, 10k USDC',
            T,
            A.subaccountRouter,
            order(),
            true
          ),
          fee(T, A.orderVault),
          call(
            'limit long ETH/USD 250k USD, 2 WETH',
            T,
            A.subaccountRouter,
            order({ orderType: 3, collateral: WETH, amount: parseEther('2') }),
            true
          ),
          fee(T, A.orderVault),
          call(
            'close 100k USD of ETH/USD',
            T,
            A.subaccountRouter,
            order(DECREASE),
            true
          ),
          call(
            'approve unlimited USDC',
            T,
            USDC,
            erc20.encodeFunctionData('approve', [A.router, 2n ** 256n - 1n]),
            false
          ),
          call(
            'approve USDC to a stranger',
            T,
            USDC,
            erc20.encodeFunctionData('approve', [STRANGER, 1n]),
            false
          ),
          call(
            'order for another account',
            T,
            A.subaccountRouter,
            order(SMALL, STRANGER),
            false
          ),
          call(
            'receiver = stranger',
            T,
            A.subaccountRouter,
            order({ ...SMALL, receiver: STRANGER }),
            false
          ),
          call(
            'cancellationReceiver = stranger',
            T,
            A.subaccountRouter,
            order({ ...SMALL, cancellationReceiver: STRANGER }),
            false
          ),
          call(
            'callback contract',
            T,
            A.subaccountRouter,
            order({ ...SMALL, callbackContract: STRANGER }),
            false
          ),
          call(
            'uiFeeReceiver = stranger',
            T,
            A.subaccountRouter,
            order({ ...SMALL, uiFeeReceiver: STRANGER }),
            false
          ),
          call(
            'unlisted market',
            T,
            A.subaccountRouter,
            order({ ...SMALL, market: GM_SOL }),
            false
          ),
          call(
            'swap through an unlisted market',
            T,
            A.subaccountRouter,
            order({ ...SMALL, swapPath: [GM_SOL] }),
            false
          ),
          call(
            'swap order',
            T,
            A.subaccountRouter,
            order({ ...SMALL, orderType: 0, market: ZeroAddress, size: 0n }),
            false
          ),
          call(
            'referral code',
            T,
            A.subaccountRouter,
            order({ ...SMALL, referralCode: keccak256('0x01') }),
            false
          ),
          call(
            'size above the per-order cap',
            T,
            A.subaccountRouter,
            order({ ...SMALL, size: usd(300_000n) }),
            false
          ),
          call(
            'size beyond the daily allowance',
            T,
            A.subaccountRouter,
            order({ ...SMALL, size: usd(250_000n) }),
            false
          ),
          call(
            'collateral beyond the daily allowance',
            T,
            A.subaccountRouter,
            order({ ...SMALL, amount: usdc(600_000n) }),
            false
          ),
          call(
            'fee above the cap',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('sendWnt', [
              A.orderVault,
              parseEther('0.02'),
            ]),
            false,
            parseEther('0.02')
          ),
          call(
            'value beyond the daily fee allowance',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('sendWnt', [
              A.orderVault,
              parseEther('0.01'),
            ]),
            false,
            parseEther('0.3')
          ),
          call(
            'ExchangeRouter.multicall',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('multicall', [
              [er.encodeFunctionData('sendWnt', [A.orderVault, FEE])],
            ]),
            false,
            FEE
          ),
          call(
            'collateral sent alone',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('sendTokens', [
              USDC,
              A.orderVault,
              usdc(100n),
            ]),
            false
          ),
          call(
            'ExchangeRouter.createOrder',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('createOrder', [params(SMALL)]),
            false
          ),
          call(
            'createTwapOrder',
            T,
            A.exchangeRouter,
            er.encodeFunctionData('createTwapOrder', [
              params(SMALL),
              4n,
              3600n,
            ]),
            false
          ),
          call(
            'updateOrder',
            T,
            A.subaccountRouter,
            sub.encodeFunctionData('updateOrder', [
              ZeroHash,
              usd(1_000_000n),
              0n,
              0n,
              0n,
              0n,
              false,
            ]),
            false
          ),

          // Liquidity
          call(
            'approve USDC to the Router',
            L,
            USDC,
            erc20.encodeFunctionData('approve', [A.router, usdc(250_000n)]),
            true
          ),
          call(
            'approve GM ETH/USD to the Router',
            L,
            GM_ETH,
            erc20.encodeFunctionData('approve', [A.router, 2n ** 256n - 1n]),
            true
          ),
          call(
            'approve GLV [WETH-USDC] to the Router',
            L,
            GLV_ETH,
            erc20.encodeFunctionData('approve', [A.router, 2n ** 256n - 1n]),
            true
          ),
          fee(L, A.depositVault),
          call(
            'send 50k USDC to the DepositVault',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('sendTokens', [
              USDC,
              A.depositVault,
              usdc(50_000n),
            ]),
            true
          ),
          call(
            'deposit into GM ETH/USD',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createDeposit', [depositParams()]),
            true
          ),
          fee(L, A.withdrawalVault),
          call(
            'send 1,000 GM to the WithdrawalVault',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('sendTokens', [
              GM_ETH,
              A.withdrawalVault,
              parseEther('1000'),
            ]),
            true
          ),
          call(
            'withdraw from GM ETH/USD',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createWithdrawal', [withdrawalParams()]),
            true
          ),
          fee(L, A.glvVault, A.glvRouter),
          call(
            'send 50k USDC to the GlvVault',
            L,
            A.glvRouter,
            glv.encodeFunctionData('sendTokens', [
              USDC,
              A.glvVault,
              usdc(50_000n),
            ]),
            true
          ),
          call(
            'deposit into GLV [WETH-USDC]',
            L,
            A.glvRouter,
            glv.encodeFunctionData('createGlvDeposit', [glvDepositParams()]),
            true
          ),
          fee(L, A.glvVault, A.glvRouter),
          call(
            'send 100 GLV to the GlvVault',
            L,
            A.glvRouter,
            glv.encodeFunctionData('sendTokens', [
              GLV_ETH,
              A.glvVault,
              parseEther('100'),
            ]),
            true
          ),
          call(
            'withdraw from GLV [WETH-USDC]',
            L,
            A.glvRouter,
            glv.encodeFunctionData('createGlvWithdrawal', [
              glvWithdrawalParams(),
            ]),
            true
          ),
          call(
            'deposit with receiver = stranger',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createDeposit', [
              depositParams({ receiver: STRANGER }),
            ]),
            false
          ),
          call(
            'deposit into an unlisted market',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createDeposit', [
              depositParams({ market: GM_BTC }),
            ]),
            false
          ),
          call(
            'deposit with a callback',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createDeposit', [
              depositParams({ callback: STRANGER }),
            ]),
            false
          ),
          call(
            'withdrawal with receiver = stranger',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createWithdrawal', [
              withdrawalParams({ receiver: STRANGER }),
            ]),
            false
          ),
          call(
            'withdrawal from an unlisted market',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('createWithdrawal', [
              withdrawalParams({ market: GM_BTC }),
            ]),
            false
          ),
          call(
            'GLV deposit of market tokens',
            L,
            A.glvRouter,
            glv.encodeFunctionData('createGlvDeposit', [
              glvDepositParams({ isMarketTokenDeposit: true }),
            ]),
            false
          ),
          call(
            'deposit into an unlisted GLV',
            L,
            A.glvRouter,
            glv.encodeFunctionData('createGlvDeposit', [
              glvDepositParams({ glv: GLV_BTC }),
            ]),
            false
          ),
          call(
            'GLV withdrawal with receiver = stranger',
            L,
            A.glvRouter,
            glv.encodeFunctionData('createGlvWithdrawal', [
              glvWithdrawalParams(STRANGER),
            ]),
            false
          ),
          call(
            'USDC to the OrderVault',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('sendTokens', [
              USDC,
              A.orderVault,
              usdc(100n),
            ]),
            false
          ),
          call(
            'USDC beyond the daily allowance',
            L,
            A.exchangeRouter,
            er.encodeFunctionData('sendTokens', [
              USDC,
              A.depositVault,
              usdc(2_000_000n),
            ]),
            false
          ),

          // Trading keys
          call(
            'add the listed key',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [KEY]),
            true
          ),
          call(
            'key expires 2026-12-01',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountExpiresAt', [
              KEY,
              ORDER_ACTION,
              at('2026-12-01'),
            ]),
            true
          ),
          call(
            'key may take 100 actions',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setMaxAllowedSubaccountActionCount', [
              KEY,
              ORDER_ACTION,
              100n,
            ]),
            true
          ),
          call(
            'key top-up 0.001 WETH',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountAutoTopUpAmount', [
              KEY,
              parseEther('0.001'),
            ]),
            true
          ),
          call(
            'unlisted key',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [OTHER_KEY]),
            false
          ),
          call(
            'key expiry past the cap',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountExpiresAt', [
              KEY,
              ORDER_ACTION,
              at('2027-06-01'),
            ]),
            false
          ),
          call(
            'key actions above the cap',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setMaxAllowedSubaccountActionCount', [
              KEY,
              ORDER_ACTION,
              501n,
            ]),
            false
          ),
          call(
            'key limit for another action type',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountExpiresAt', [
              KEY,
              keccak256('0x02'),
              at('2026-12-01'),
            ]),
            false
          ),
          call(
            'key top-up above the cap',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setSubaccountAutoTopUpAmount', [
              KEY,
              parseEther('0.01'),
            ]),
            false
          ),
          call(
            'integration id',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('setIntegrationId', [
              KEY,
              keccak256('0x03'),
            ]),
            false
          ),
          call(
            'keys role registers the avatar',
            K,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [AVATAR]),
            false
          ),

          // Revoke
          call(
            'remove the key',
            G,
            A.subaccountRouter,
            sub.encodeFunctionData('removeSubaccount', [KEY]),
            true
          ),
          call(
            'remove the avatar as subaccount',
            G,
            A.subaccountRouter,
            sub.encodeFunctionData('removeSubaccount', [AVATAR]),
            true
          ),
          fee(T, A.orderVault),
          call(
            'order after the avatar is removed (GMX refuses)',
            T,
            A.subaccountRouter,
            order(SMALL),
            false
          ),
          call(
            'set the USDC approval to 0',
            G,
            USDC,
            erc20.encodeFunctionData('approve', [A.router, 0n]),
            true
          ),
          call(
            'guardian approves 1 USDC',
            G,
            USDC,
            erc20.encodeFunctionData('approve', [A.router, 1n]),
            false
          ),
          call(
            'guardian adds a subaccount',
            G,
            A.subaccountRouter,
            sub.encodeFunctionData('addSubaccount', [KEY]),
            false
          ),

          // Claims
          call(
            'claim funding fees to the avatar',
            C,
            A.exchangeRouter,
            er.encodeFunctionData('claimFundingFees', [
              [GM_ETH],
              [USDC],
              AVATAR,
            ]),
            true
          ),
          call(
            'claim funding fees to a stranger',
            C,
            A.exchangeRouter,
            er.encodeFunctionData('claimFundingFees', [
              [GM_ETH],
              [USDC],
              STRANGER,
            ]),
            false
          ),
          call(
            'claim a distribution to a stranger',
            C,
            A.claimHandler,
            claims.encodeFunctionData('acceptTermsAndClaim', [
              [
                {
                  token: USDC,
                  distributionId: 1n,
                  termsSignature: '0x',
                  acceptedTerms: '',
                },
              ],
              STRANGER,
            ]),
            false
          ),
          call(
            'claim affiliate rewards',
            C,
            A.exchangeRouter,
            er.encodeFunctionData('claimAffiliateRewards', [
              [GM_ETH],
              [USDC],
              AVATAR,
            ]),
            false
          ),
        ],
      })

      console.log(`Arbitrum block ${block}`)
      for (const c of cases) {
        console.log(
          `${c.passed ? 'ok  ' : 'FAIL'} ${c.allowed ? 'allowed' : 'blocked'}  ${c.role.padEnd(18)} ${c.label.padEnd(44)} ${c.detail}`
        )
      }
      expect(failedSetup).toEqual([])
      expect(cases.filter((c) => !c.passed)).toEqual([])
    },
    { timeout: 120_000 }
  )

  it.each(Object.keys(GMX).map(Number) as GmxChain[])(
    'the addresses for chain %i are GMX’s current ones',
    async (chain) => {
      const provider = new JsonRpcProvider(RPC[chain])
      const gmxOn = GMX[chain]
      const read = (address: string, fn: string) =>
        new Contract(
          address,
          [`function ${fn}() view returns (address)`],
          provider
        ).getFunction(fn)() as Promise<string>
      const roleStore = new Contract(
        gmxOn.roleStore,
        ['function hasRole(address,bytes32) view returns (bool)'],
        provider
      )
      const role = (name: string) =>
        keccak256(AbiCoder.defaultAbiCoder().encode(['string'], [name]))

      for (const router of [
        gmxOn.exchangeRouter,
        gmxOn.subaccountRouter,
        gmxOn.glvRouter,
      ]) {
        expect(await roleStore.hasRole(router, role('ROUTER_PLUGIN'))).toBe(
          true
        )
      }
      expect(
        await roleStore.hasRole(gmxOn.claimHandler, role('CONTROLLER'))
      ).toBe(true)
      expect(await read(gmxOn.exchangeRouter, 'router')).toBe(gmxOn.router)
      expect(await read(gmxOn.exchangeRouter, 'roleStore')).toBe(
        gmxOn.roleStore
      )
      expect(await read(gmxOn.subaccountRouter, 'orderVault')).toBe(
        gmxOn.orderVault
      )
      expect(
        await read(
          await read(gmxOn.exchangeRouter, 'depositHandler'),
          'depositVault'
        )
      ).toBe(gmxOn.depositVault)
      expect(
        await read(
          await read(gmxOn.exchangeRouter, 'withdrawalHandler'),
          'withdrawalVault'
        )
      ).toBe(gmxOn.withdrawalVault)
      expect(
        await read(await read(gmxOn.glvRouter, 'glvDepositHandler'), 'glvVault')
      ).toBe(gmxOn.glvVault)
    },
    { timeout: 60_000 }
  )
})
