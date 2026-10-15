import { describe, expect, it } from 'bun:test'
import { getAddress } from 'ethers'
import {
  processPermissions,
  targetIntegrity,
  type Permission,
} from 'zodiac-roles-sdk'
import { gmx, GMX, GMX_UI_FEE_RECEIVER } from '.'

const A = GMX[42161]
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
const GM_ETH = '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336'
const GM_BTC = '0x47c031236e19d024b42f8AE6780E44A573170703'
const GLV_ETH = '0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9'
const KEY = '0x0000000000000000000000000000000005ab0001'

const SELECTORS = {
  approve: '0x095ea7b3',
  sendWnt: '0x7d39aaf1',
  sendTokens: '0xe6d66ac8',
  subaccountCreateOrder: '0x69b605c5',
  exchangeCreateOrder: '0xf59c48eb',
  multicall: '0xac9650d8',
  cancelOrder: '0x7489ec23',
  createDeposit: '0xc82aa41b',
  createWithdrawal: '0xe78dc235',
  createGlvDeposit: '0xdfa05241',
  createGlvWithdrawal: '0x7c6fa43b',
  addSubaccount: '0x3914f217',
  setSubaccountExpiresAt: '0x78a61fa2',
  setMaxAllowedSubaccountActionCount: '0x3e46b365',
  setSubaccountAutoTopUpAmount: '0x79a358a2',
  removeSubaccount: '0x712182eb',
  claimFundingFees: '0xc41b1ab3',
  acceptTermsAndClaim: '0x2ab0cc33',
}

const PASS = 0
const OR = 2
const MATCHES = 5
const ARRAY_EVERY = 7
const EQUAL_TO_AVATAR = 15
const EQUAL_TO = 16
const LESS_THAN = 18
const WITHIN_ALLOWANCE = 28
const ETHER_WITHIN_ALLOWANCE = 29

const word = (value: string | bigint) =>
  `0x${(typeof value === 'bigint' ? value.toString(16) : value.slice(2))
    .padStart(64, '0')
    .toLowerCase()}`

const find = (permissions: any[], target: string, selector: string) =>
  permissions.find(
    (p) => p.targetAddress === target.toLowerCase() && p.selector === selector
  )

const compiles = (permissions: any[]) =>
  targetIntegrity(processPermissions(permissions as Permission[]).targets)

describe('GMX', () => {
  it('covers Arbitrum, Avalanche and MegaETH with checksummed addresses', () => {
    expect(Object.keys(GMX)).toEqual(['4326', '42161', '43114'])
    for (const contracts of Object.values(GMX)) {
      for (const address of Object.values(contracts)) {
        expect(getAddress(address)).toBe(address)
      }
    }
  })
})

describe('gmx.trade', () => {
  const trade = () =>
    gmx.trade({
      chain: 42161,
      markets: [GM_ETH, GM_BTC],
      collateral: [
        {
          token: USDC,
          allowance: 'gmx_usdc',
          maxApproval: 250_000n * 10n ** 6n,
        },
        { token: WETH },
      ],
      maxOrderSizeUsd: 250_000,
      sizeAllowance: 'gmx_size',
      maxExecutionFee: 10n ** 16n,
      feeAllowance: 'gmx_fees',
    }) as { label: string; permissions: any[] }

  it('labels itself', () => {
    expect(trade().label).toBe('Open and close GMX positions')
  })

  it('approves the collateral to the Router only, capped where asked', () => {
    const { permissions } = trade()
    const usdc = find(permissions, USDC, SELECTORS.approve)
    expect(usdc.condition.children[0]).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(A.router),
    })
    expect(usdc.condition.children[1]).toMatchObject({
      operator: LESS_THAN,
      compValue: word(250_000n * 10n ** 6n + 1n),
    })
    const weth = find(permissions, WETH, SELECTORS.approve)
    expect(weth.condition.children[0].compValue).toBe(word(A.router))
  })

  it('sends the fee to the OrderVault only, within an ETH allowance', () => {
    const fee = find(trade().permissions, A.exchangeRouter, SELECTORS.sendWnt)
    expect(fee.send).toBe(true)
    const [vault, amount, ether] = fee.condition.children
    expect(vault).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(A.orderVault),
    })
    expect(amount).toMatchObject({
      operator: LESS_THAN,
      compValue: word(10n ** 16n + 1n),
    })
    expect(ether.operator).toBe(ETHER_WITHIN_ALLOWANCE)
  })

  it('creates orders for the avatar through the SubaccountRouter', () => {
    const create = find(
      trade().permissions,
      A.subaccountRouter,
      SELECTORS.subaccountCreateOrder
    )
    const [account, params] = create.condition.children
    expect(account.operator).toBe(EQUAL_TO_AVATAR)
    // An increase per collateral token, and a decrease
    expect(params.operator).toBe(OR)
    expect(params.children).toHaveLength(3)

    const [usdcIncrease, wethIncrease, decrease] = params.children
    const [addresses, numbers, orderType] = usdcIncrease.children
    const [
      receiver,
      cancellationReceiver,
      callback,
      uiFeeReceiver,
      market,
      collateral,
      swapPath,
    ] = addresses.children
    expect(receiver.operator).toBe(EQUAL_TO_AVATAR)
    expect(cancellationReceiver.operator).toBe(OR)
    expect(cancellationReceiver.children.map((c: any) => c.operator)).toEqual([
      EQUAL_TO_AVATAR,
      EQUAL_TO,
    ])
    expect(callback).toMatchObject({ operator: EQUAL_TO, compValue: word(0n) })
    expect(uiFeeReceiver.children.map((c: any) => c.compValue)).toEqual([
      word(0n),
      word(GMX_UI_FEE_RECEIVER),
    ])
    expect(market.operator).toBe(OR)
    expect(collateral).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(USDC),
    })
    expect(swapPath.operator).toBe(ARRAY_EVERY)

    const [size, amount] = numbers.children
    expect(size.children.map((c: any) => c.operator)).toEqual([
      LESS_THAN,
      WITHIN_ALLOWANCE,
    ])
    expect(amount.operator).toBe(WITHIN_ALLOWANCE)
    expect(orderType.children.map((c: any) => c.compValue)).toEqual(
      [2n, 3n, 8n].map(word)
    )

    // Without an allowance, the WETH amount is left open
    expect(wethIncrease.children[1].children[1].operator).toBe(PASS)
    // A decrease pulls nothing; its size is open
    expect(decrease.children[1].children[0].operator).toBe(PASS)
    expect(decrease.children[2].children.map((c: any) => c.compValue)).toEqual(
      [4n, 5n, 6n].map(word)
    )
  })

  it('allows neither the multicall nor the ExchangeRouter order', () => {
    const { permissions } = trade()
    expect(
      find(permissions, A.exchangeRouter, SELECTORS.multicall)
    ).toBeUndefined()
    expect(
      find(permissions, A.exchangeRouter, SELECTORS.exchangeCreateOrder)
    ).toBeUndefined()
    expect(
      find(permissions, A.exchangeRouter, SELECTORS.sendTokens)
    ).toBeUndefined()
  })

  it('compiles', () => {
    expect(() => compiles(trade().permissions)).not.toThrow()
  })
})

describe('gmx.ownSubaccount', () => {
  const own = () =>
    gmx.ownSubaccount({
      chain: 42161,
      expiresBefore: new Date('2028-01-01T00:00:00Z'),
      maxActions: 100_000n,
    }) as { permissions: any[] }

  it('registers the avatar only, with capped expiry and actions', () => {
    const { permissions } = own()
    const add = find(permissions, A.subaccountRouter, SELECTORS.addSubaccount)
    expect(add.condition.children[0].operator).toBe(EQUAL_TO_AVATAR)
    const expiry = find(
      permissions,
      A.subaccountRouter,
      SELECTORS.setSubaccountExpiresAt
    )
    expect(expiry.condition.children.map((c: any) => c.operator)).toEqual([
      EQUAL_TO_AVATAR,
      EQUAL_TO,
      LESS_THAN,
    ])
    expect(expiry.condition.children[2].compValue).toBe(word(1830297600n + 1n))
  })

  it('compiles', () => {
    expect(() => compiles(own().permissions)).not.toThrow()
  })
})

describe('gmx.deposit', () => {
  const deposit = () =>
    gmx.deposit({
      chain: 42161,
      markets: [GM_ETH],
      glvs: [{ token: GLV_ETH, markets: [GM_ETH] }],
      tokens: [{ token: USDC, allowance: 'gmx_usdc_lp' }],
      maxExecutionFee: 10n ** 16n,
      feeAllowance: 'gmx_fees',
    }) as { label: string; permissions: any[] }

  it('sends tokens to the deposit vaults only, within an allowance', () => {
    const { permissions } = deposit()
    for (const [router, vault] of [
      [A.exchangeRouter, A.depositVault],
      [A.glvRouter, A.glvVault],
    ]) {
      const transfer = find(permissions, router, SELECTORS.sendTokens)
      const [token, receiver, amount] = transfer.condition.children
      expect(token.compValue).toBe(word(USDC))
      expect(receiver.compValue).toBe(word(vault))
      expect(amount.operator).toBe(WITHIN_ALLOWANCE)
    }
  })

  it('mints to the avatar, in listed pools, without swaps', () => {
    const { permissions } = deposit()
    const gm = find(permissions, A.exchangeRouter, SELECTORS.createDeposit)
    const [receiver, callback, , market, , , longSwaps, shortSwaps] =
      gm.condition.children[0].children[0].children
    expect(receiver.operator).toBe(EQUAL_TO_AVATAR)
    expect(callback.compValue).toBe(word(0n))
    expect(market).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(GM_ETH),
    })
    for (const swaps of [longSwaps, shortSwaps]) {
      expect(swaps.operator).toBe(EQUAL_TO)
    }

    const glv = find(permissions, A.glvRouter, SELECTORS.createGlvDeposit)
    const [addresses, , , , , isMarketTokenDeposit] =
      glv.condition.children[0].children
    expect(addresses.children[0].compValue).toBe(word(GLV_ETH))
    expect(isMarketTokenDeposit).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(0n),
    })
  })

  it('needs pools', () => {
    expect(() =>
      gmx.deposit({
        chain: 42161,
        tokens: [{ token: USDC, allowance: 'a' }],
        maxExecutionFee: 1n,
        feeAllowance: 'f',
      })
    ).toThrow('markets or GLVs')
  })

  it('compiles', () => {
    expect(() => compiles(deposit().permissions)).not.toThrow()
  })
})

describe('gmx.withdraw', () => {
  const withdraw = () =>
    gmx.withdraw({
      chain: 42161,
      markets: [{ token: GM_ETH, allowance: 'gmx_gm' }],
      glvs: [{ token: GLV_ETH, allowance: 'gmx_glv', markets: [GM_ETH] }],
      maxExecutionFee: 10n ** 16n,
      feeAllowance: 'gmx_fees',
    }) as { permissions: any[] }

  it('sends pool tokens to the withdrawal vaults only, within an allowance', () => {
    const { permissions } = withdraw()
    const gm = find(permissions, A.exchangeRouter, SELECTORS.sendTokens)
    expect(gm.condition.children[0].compValue).toBe(word(GM_ETH))
    expect(gm.condition.children[1].compValue).toBe(word(A.withdrawalVault))
    expect(gm.condition.children[2].operator).toBe(WITHIN_ALLOWANCE)
    const glv = find(permissions, A.glvRouter, SELECTORS.sendTokens)
    expect(glv.condition.children[1].compValue).toBe(word(A.glvVault))
  })

  it('pays out to the avatar', () => {
    const { permissions } = withdraw()
    for (const [router, selector] of [
      [A.exchangeRouter, SELECTORS.createWithdrawal],
      [A.glvRouter, SELECTORS.createGlvWithdrawal],
    ]) {
      const request = find(permissions, router, selector)
      expect(
        request.condition.children[0].children[0].children[0].operator
      ).toBe(EQUAL_TO_AVATAR)
    }
  })

  it('compiles', () => {
    expect(() => compiles(withdraw().permissions)).not.toThrow()
  })
})

describe('gmx.tradingKeys', () => {
  const keys = () =>
    gmx.tradingKeys({
      chain: 42161,
      keys: [KEY],
      expiresBefore: new Date('2027-01-01T00:00:00Z'),
      maxActions: 500n,
      maxTopUp: 2n * 10n ** 15n,
    }) as { permissions: any[] }

  it('registers listed keys with capped limits', () => {
    const { permissions } = keys()
    const add = find(permissions, A.subaccountRouter, SELECTORS.addSubaccount)
    expect(add.condition.children[0]).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(KEY),
    })
    const topUp = find(
      permissions,
      A.subaccountRouter,
      SELECTORS.setSubaccountAutoTopUpAmount
    )
    expect(topUp.condition.children[1]).toMatchObject({
      operator: LESS_THAN,
      compValue: word(2n * 10n ** 15n + 1n),
    })
  })

  it('compiles', () => {
    expect(() => compiles(keys().permissions)).not.toThrow()
  })
})

describe('gmx.revoke', () => {
  it('removes any subaccount and sets approvals to 0', () => {
    const { permissions } = gmx.revoke({
      chain: 42161,
      tokens: [USDC],
    }) as { permissions: any[] }
    const remove = find(
      permissions,
      A.subaccountRouter,
      SELECTORS.removeSubaccount
    )
    expect(remove.condition).toBeUndefined()
    const approve = find(permissions, USDC, SELECTORS.approve)
    expect(approve.condition.children[1]).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(0n),
    })
  })
})

describe('gmx.claim', () => {
  it('pays every claim to the avatar', () => {
    const { permissions } = gmx.claim({ chain: 42161 }) as {
      permissions: any[]
    }
    const funding = find(
      permissions,
      A.exchangeRouter,
      SELECTORS.claimFundingFees
    )
    expect(funding.condition.children[2].operator).toBe(EQUAL_TO_AVATAR)
    const distributions = find(
      permissions,
      A.claimHandler,
      SELECTORS.acceptTermsAndClaim
    )
    expect(distributions.condition.children[1].operator).toBe(EQUAL_TO_AVATAR)
    expect(() => compiles(permissions)).not.toThrow()
  })
})
