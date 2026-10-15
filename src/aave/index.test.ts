import { describe, expect, it } from 'bun:test'
import * as addressBook from '@bgd-labs/aave-address-book'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { allow as arb1 } from 'defi-kit/arb1'
import { allow as base } from 'defi-kit/base'
import { allow as eth } from 'defi-kit/eth'
import { allow as gno } from 'defi-kit/gno'
import { allow as oeth } from 'defi-kit/oeth'
import { aave, AAVE_V3, type AaveChain, type AaveParams } from '.'
import type { Address } from '../kit'
import { expectSamePermissions } from '../test/defiKit'
import { NATIVE } from '../utils'
import type { AaveMarket } from './markets'

const SELECTORS = {
  approve: '0x095ea7b3',
  supply: '0x617ba037',
  withdraw: '0x69328dec',
  withdrawCompact: '0x8e19899e',
  setUserUseReserveAsCollateral: '0x5a3b74b9',
  borrow: '0xa415bcad',
  repay: '0x573ade81',
  repayCompact: '0x563dd613',
  depositETH: '0x474cf53d',
  withdrawETH: '0x80500d20',
  borrowETH: '0xe74f7b85',
  repayETH: '0xbcc3c255',
  approveDelegation: '0xc04a8a10',
  claimRewards: '0x236300dc',
}

const EQUAL_TO_AVATAR = 15

type Permission = {
  targetAddress: string
  selector: string
  condition?: any
  send?: boolean
}

const word = (address: string) =>
  `0x${address.slice(2).padStart(64, '0').toLowerCase()}`

const marketOf = (chain: AaveChain, market = 'Core') =>
  (AAVE_V3[chain] as Record<string, AaveMarket>)[market]!

/** A reserve's underlying token, by its symbol in our map. */
const token = (chain: AaveChain, symbol: string, market?: string) => {
  const reserve = marketOf(chain, market).reserves.find(([s]) => s === symbol)
  if (reserve == null) throw new Error(`No ${symbol} on ${chain} ${market}`)
  return reserve[1]
}

const calls = (permissions: Permission[]) =>
  permissions.map(({ targetAddress, selector }) => [targetAddress, selector])

const find = (permissions: Permission[], target: string, selector: string) =>
  permissions.find(
    (p) =>
      p.targetAddress.toLowerCase() === target.toLowerCase() &&
      p.selector === selector
  )

const permissionsOf = async (
  action: (typeof aave)[keyof typeof aave],
  params: Omit<AaveParams, 'label'>
) =>
  (await action({ label: 'Test', ...params } as AaveParams))
    .permissions as Permission[]

// Permissions come out with lowercase addresses
const lower = (address: Address) => address.toLowerCase() as Address

const ARB_POOL = lower(AAVE_V3[42161].Core.pool)
const ARB_GATEWAY = lower(AAVE_V3[42161].Core.gateway.address)
const ARB_USDC = lower(token(42161, 'USDC'))
const ARB_WBTC = lower(token(42161, 'WBTC'))
const ARB_WETH = lower(token(42161, 'WETH'))

describe('aave.deposit', () => {
  it('approves and supplies each token, and lets it be used as collateral', async () => {
    expect(
      calls(
        await permissionsOf(aave.deposit, { chain: 42161, tokens: [ARB_USDC] })
      )
    ).toEqual([
      [ARB_USDC, SELECTORS.approve],
      [ARB_POOL, SELECTORS.supply],
      [ARB_POOL, SELECTORS.setUserUseReserveAsCollateral],
    ])
  })

  it('approves the token to the pool only', async () => {
    const approve = find(
      await permissionsOf(aave.deposit, { chain: 42161, tokens: [ARB_USDC] }),
      ARB_USDC,
      SELECTORS.approve
    )

    expect(approve?.condition.children[0].compValue).toBe(word(ARB_POOL))
  })

  it('supplies the token on behalf of the avatar', async () => {
    const { condition } = find(
      await permissionsOf(aave.deposit, { chain: 42161, tokens: [ARB_USDC] }),
      ARB_POOL,
      SELECTORS.supply
    )!

    expect(condition.children[0].compValue).toBe(word(ARB_USDC))
    expect(condition.children[2].operator).toBe(EQUAL_TO_AVATAR)
  })

  it('supplies the native token through the gateway, for the avatar', async () => {
    const permissions = await permissionsOf(aave.deposit, {
      chain: 42161,
      tokens: [NATIVE],
    })

    expect(calls(permissions)).toEqual([
      [ARB_GATEWAY, SELECTORS.depositETH],
      [ARB_POOL, SELECTORS.setUserUseReserveAsCollateral],
    ])

    const depositETH = find(permissions, ARB_GATEWAY, SELECTORS.depositETH)!
    expect(depositETH.send).toBe(true)
    expect(depositETH.condition.children[0].compValue).toBe(word(ARB_POOL))
    expect(depositETH.condition.children[1].operator).toBe(EQUAL_TO_AVATAR)

    const collateral = find(
      permissions,
      ARB_POOL,
      SELECTORS.setUserUseReserveAsCollateral
    )!
    expect(collateral.condition.children[0].compValue).toBe(word(ARB_WETH))
  })
})

describe('aave.withdraw', () => {
  it('withdraws to the avatar, with the compact L2Pool call for the same reserve', async () => {
    const permissions = await permissionsOf(aave.withdraw, {
      chain: 42161,
      tokens: [ARB_WBTC],
    })

    expect(calls(permissions)).toEqual([
      [ARB_POOL, SELECTORS.withdraw],
      [ARB_POOL, SELECTORS.withdrawCompact],
      [
        AAVE_V3[42161].Core.rewardsController.toLowerCase(),
        SELECTORS.claimRewards,
      ],
    ])

    const withdraw = find(permissions, ARB_POOL, SELECTORS.withdraw)!
    expect(withdraw.condition.children[0].compValue).toBe(word(ARB_WBTC))
    expect(withdraw.condition.children[2].operator).toBe(EQUAL_TO_AVATAR)

    // WBTC is reserve 3 on Arbitrum: the last two bytes must be 0x0003. The
    // bitmask packs shift (30), mask and value, each left-aligned in 15 bytes.
    const compact = find(permissions, ARB_POOL, SELECTORS.withdrawCompact)!
    expect(compact.condition.children[0].compValue).toBe(
      `0x001effff${'0'.repeat(26)}0003${'0'.repeat(26)}`
    )
  })

  it('has no compact call where the pool is not an L2Pool', async () => {
    const permissions = await permissionsOf(aave.withdraw, {
      chain: 1,
      tokens: [token(1, 'USDC')],
    })

    expect(
      permissions.some((p) => p.selector === SELECTORS.withdrawCompact)
    ).toBe(false)
  })

  it('withdraws the native token through the gateway, to the avatar', async () => {
    const permissions = await permissionsOf(aave.withdraw, {
      chain: 42161,
      tokens: [NATIVE],
    })
    const { aToken } = AAVE_V3[42161].Core.gateway

    const approve = find(permissions, aToken, SELECTORS.approve)!
    expect(approve.condition.children[0].compValue).toBe(word(ARB_GATEWAY))

    const withdrawETH = find(permissions, ARB_GATEWAY, SELECTORS.withdrawETH)!
    expect(withdrawETH.condition.children[0].compValue).toBe(word(ARB_POOL))
    expect(withdrawETH.condition.children[2].operator).toBe(EQUAL_TO_AVATAR)
  })

  it('claims rewards to the avatar', async () => {
    const claim = find(
      await permissionsOf(aave.withdraw, { chain: 42161, tokens: [ARB_USDC] }),
      AAVE_V3[42161].Core.rewardsController,
      SELECTORS.claimRewards
    )!

    expect(claim.condition.children[2].operator).toBe(EQUAL_TO_AVATAR)
  })
})

describe('aave.borrow', () => {
  it('borrows for the avatar and repays its debt', async () => {
    const permissions = await permissionsOf(aave.borrow, {
      chain: 42161,
      tokens: [ARB_USDC],
    })

    expect(calls(permissions)).toEqual([
      [ARB_USDC, SELECTORS.approve],
      [ARB_POOL, SELECTORS.borrow],
      [ARB_POOL, SELECTORS.repay],
      [ARB_POOL, SELECTORS.repayCompact],
    ])
    expect(
      find(permissions, ARB_USDC, SELECTORS.approve)!.condition.children[0]
        .compValue
    ).toBe(word(ARB_POOL))
    expect(
      find(permissions, ARB_POOL, SELECTORS.borrow)!.condition.children[4]
        .operator
    ).toBe(EQUAL_TO_AVATAR)
    expect(
      find(permissions, ARB_POOL, SELECTORS.repay)!.condition.children[3]
        .operator
    ).toBe(EQUAL_TO_AVATAR)
  })

  it('delegates credit to the gateway only, for the native token', async () => {
    const permissions = await permissionsOf(aave.borrow, {
      chain: 42161,
      tokens: [NATIVE],
    })
    const { variableDebtToken } = AAVE_V3[42161].Core.gateway

    expect(
      find(permissions, variableDebtToken, SELECTORS.approveDelegation)!
        .condition.children[0].compValue
    ).toBe(word(ARB_GATEWAY))

    const repayETH = find(permissions, ARB_GATEWAY, SELECTORS.repayETH)!
    expect(repayETH.send).toBe(true)
    expect(repayETH.condition.children[2].operator).toBe(EQUAL_TO_AVATAR)
    expect(find(permissions, ARB_GATEWAY, SELECTORS.borrowETH)).toBeDefined()
  })
})

describe('labels', () => {
  it('keeps a label it is given', async () => {
    const entry = await aave.deposit({
      label: 'Park USDC',
      chain: 42161,
      tokens: [ARB_USDC],
    })

    expect(entry.label).toBe('Park USDC')
  })

  it('names the tokens in the order given', async () => {
    const tokens = [ARB_USDC, ARB_WETH, NATIVE] as const

    expect((await aave.deposit({ chain: 42161, tokens })).label).toBe(
      'Deposit USDC, WETH and ETH into Aave v3'
    )
    expect((await aave.withdraw({ chain: 42161, tokens })).label).toBe(
      'Withdraw USDC, WETH and ETH from Aave v3'
    )
    expect(
      (await aave.borrow({ chain: 42161, tokens: [ARB_USDC] })).label
    ).toBe('Borrow USDC from Aave v3')
  })

  it('tells bridged from native USDC', async () => {
    const entry = await aave.deposit({
      chain: 42161,
      tokens: [token(42161, 'USDC.e')],
    })

    expect(entry.label).toBe('Deposit USDC.e into Aave v3')
  })

  it("names the market and the chain's native token", async () => {
    expect(
      (await aave.deposit({ chain: 1, market: 'Prime', tokens: [NATIVE] }))
        .label
    ).toBe('Deposit ETH into Aave v3 Prime')
    expect(
      (await aave.deposit({ chain: 1, tokens: [token(1, 'USDC')] })).label
    ).toBe('Deposit USDC into Aave v3 Core')
    expect((await aave.deposit({ chain: 100, tokens: [NATIVE] })).label).toBe(
      'Deposit XDAI into Aave v3'
    )
  })
})

describe('errors', () => {
  it('rejects a token that is not a reserve of the market', async () => {
    // USDC on Arbitrum is no reserve of Ethereum's markets
    await expect(
      aave.deposit({ chain: 1, market: 'Prime', tokens: [ARB_USDC] })
    ).rejects.toThrow(
      `${ARB_USDC} is not a reserve of the Aave v3 Prime market on chain 1.`
    )
  })

  it('rejects the native token where the market has no gateway', async () => {
    // EtherFi doesn't list WETH; Celo's native token is an ERC-20 already.
    await expect(
      aave.deposit({ chain: 1, market: 'EtherFi', tokens: [NATIVE] })
    ).rejects.toThrow('takes no native token')
    await expect(
      aave.withdraw({ chain: 42220, tokens: [NATIVE] })
    ).rejects.toThrow('takes no native token')
  })

  it('rejects an unknown market', async () => {
    await expect(
      aave.deposit({
        chain: 1,
        market: 'Horizon' as 'Core',
        tokens: [token(1, 'USDC')],
      })
    ).rejects.toThrow('There is no Aave v3 Horizon market on chain 1.')
  })
})

// DeFi Kit's `aave_v3.deposit` is our `deposit` and `withdraw` together, its
// `aave_v3.borrow` our `borrow`.
//
// Deliberate deviations, which each case lists and the test asserts DeFi Kit
// lacks:
// - `claimRewards` on every market, where DeFi Kit only has it on Ethereum.
// - The compact `withdraw(bytes32)` and `repay(bytes32)` on every L2Pool,
//   where DeFi Kit only has them on Arbitrum and Optimism. Base's pool is an
//   L2Pool too.
describe('DeFi Kit parity', () => {
  type Case = {
    chain: AaveChain
    market?: 'Core' | 'Prime' | 'EtherFi'
    kit: any
    /** Reserve symbols in our map; DeFi Kit gets their addresses. */
    symbols: string[]
    /** DeFi Kit's name for the native token, where it supports it. */
    native?: string
    claimRewards?: 'deviation'
    compactCalls?: 'deviation'
  }

  const CASES: Case[] = [
    {
      chain: 1,
      market: 'Core',
      kit: eth,
      symbols: ['WETH', 'USDC', 'wstETH', 'USDT', 'GHO', 'BTC.b'],
      native: 'ETH',
    },
    {
      chain: 1,
      market: 'Prime',
      kit: eth,
      symbols: ['WETH', 'wstETH', 'GHO', 'USDC'],
      native: 'ETH',
    },
    {
      chain: 1,
      market: 'EtherFi',
      kit: eth,
      symbols: ['weETH', 'USDC', 'PYUSD', 'FRAX'],
    },
    {
      chain: 10,
      kit: oeth,
      symbols: ['WETH', 'USDC', 'USDC.e', 'wstETH', 'OP'],
      native: 'ETH',
      claimRewards: 'deviation',
    },
    {
      chain: 100,
      kit: gno,
      symbols: ['WXDAI', 'GNO', 'USDC', 'sDAI', 'EURe'],
      native: 'XDAI',
      claimRewards: 'deviation',
    },
    {
      chain: 8453,
      kit: base,
      symbols: ['WETH', 'USDC', 'cbBTC', 'wstETH'],
      native: 'ETH',
      claimRewards: 'deviation',
      compactCalls: 'deviation',
    },
    {
      // What the client constellation uses, plus the reserve with the highest
      // id, to check DeFi Kit and we number reserves alike.
      chain: 42161,
      kit: arb1,
      symbols: ['WETH', 'USDC', 'WBTC', 'USDC.e', 'ARB', 'tBTC'],
      native: 'ETH',
      claimRewards: 'deviation',
    },
  ]

  const deviations = ({ chain, market, ...c }: Case) => {
    const { pool, rewardsController } = marketOf(chain, market)

    return [
      ...(c.claimRewards
        ? [{ target: rewardsController, selector: SELECTORS.claimRewards }]
        : []),
      ...(c.compactCalls
        ? [
            { target: pool, selector: SELECTORS.withdrawCompact },
            { target: pool, selector: SELECTORS.repayCompact },
          ]
        : []),
    ]
  }

  const isDeviation = (c: Case) => (p: Permission) =>
    deviations(c).some(
      ({ target, selector }) =>
        p.targetAddress.toLowerCase() === target.toLowerCase() &&
        p.selector === selector
    )

  for (const c of CASES) {
    const name = `chain ${c.chain}${c.market ? ` ${c.market}` : ''}`
    const tokens = c.symbols.map((s) => token(c.chain, s, c.market)) as [
      Address,
      ...Address[],
    ]
    const params = {
      chain: c.chain,
      market: c.chain === 1 ? c.market : undefined,
      tokens: c.native ? [...tokens, NATIVE] : tokens,
    } as AaveParams
    const targets = c.native ? [...tokens, c.native] : tokens

    const compare = (ours: Permission[], theirs: Permission[]) => {
      const deviating = isDeviation(c)

      expectSamePermissions(
        ours.filter((p) => !deviating(p)),
        theirs
      )
      expect(theirs.filter(deviating)).toEqual([])
      return ours.filter(deviating)
    }

    it(`deposit and withdraw grant what DeFi Kit's deposit does on ${name}`, async () => {
      const ours = [
        ...(await permissionsOf(aave.deposit, params)),
        ...(await permissionsOf(aave.withdraw, params)),
      ]
      const theirs = await c.kit.aave_v3.deposit({ market: c.market, targets })

      const extra = compare(ours, theirs)
      expect(extra.some((p) => p.selector === SELECTORS.claimRewards)).toBe(
        c.claimRewards != null
      )
      expect(extra.some((p) => p.selector === SELECTORS.withdrawCompact)).toBe(
        c.compactCalls != null
      )
    })

    it(`borrow grants what DeFi Kit's borrow does on ${name}`, async () => {
      const ours = await permissionsOf(aave.borrow, params)
      const theirs = await c.kit.aave_v3.borrow({ market: c.market, targets })

      const extra = compare(ours, theirs)
      expect(extra.some((p) => p.selector === SELECTORS.repayCompact)).toBe(
        c.compactCalls != null
      )
    })
  }

  it('rejects ETH on EtherFi, as DeFi Kit does', async () => {
    await expect(
      eth.aave_v3.deposit({ market: 'EtherFi', targets: ['ETH'] })
    ).rejects.toThrow()
    await expect(
      aave.deposit({ chain: 1, market: 'EtherFi', tokens: [NATIVE] })
    ).rejects.toThrow()
  })
})

describe('AAVE_V3', () => {
  // Markets in the registry we leave out (see `markets.ts`)
  const LEFT_OUT = ['AaveV3EthereumHorizon', 'AaveV3InkWhitelabel']
  const TESTNETS = [CHAIN_IDS.sep, CHAIN_IDS.basesep] as number[]
  const NAMES: Record<string, string> = {
    AaveV3EthereumLido: 'Prime',
    AaveV3EthereumEtherFi: 'EtherFi',
  }

  // Reserves listed on chain after the registry's latest release, appended to
  // the markets by hand. Checked on chain when added.
  const NEWER_THAN_REGISTRY: Record<string, number> = {
    AaveV3Ethereum: 4,
    AaveV3MegaEth: 2,
    AaveV3Plasma: 4,
  }

  // Pools whose bytecode has the L2Pool functions. The registry only lists an
  // L2_ENCODER for some of them (not Linea's).
  const L2_POOLS = [10, 4326, 5000, 8453, 42161, 59144, 534352]

  const zodiacChains = new Set<number>(Object.values(CHAIN_IDS))
  const registry = Object.entries(addressBook)
    .filter(
      ([name, value]) =>
        /^AaveV3[A-Z]/.test(name) &&
        typeof value === 'object' &&
        'POOL' in value &&
        zodiacChains.has((value as any).CHAIN_ID) &&
        !TESTNETS.includes((value as any).CHAIN_ID) &&
        !LEFT_OUT.includes(name)
    )
    .map(([name, value]) => ({ name, book: value as any }))

  it('has every market of the registry on the chains Zodiac supports', () => {
    const ours = Object.entries(AAVE_V3).flatMap(([chain, markets]) =>
      Object.keys(markets).map((market) => `${chain} ${market}`)
    )

    expect(ours.sort()).toEqual(
      registry
        .map(({ name, book }) => `${book.CHAIN_ID} ${NAMES[name] ?? 'Core'}`)
        .sort()
    )
  })

  for (const { name, book } of registry) {
    describe(name, () => {
      const market = marketOf(book.CHAIN_ID, NAMES[name])
      const assets = Object.values(book.ASSETS as Record<string, any>).sort(
        (a, b) => a.id - b.id
      )

      it('has the pool, rewards controller and gateway of the registry', () => {
        expect(market.pool).toBe(book.POOL)
        expect(market.rewardsController).toBe(
          book.DEFAULT_INCENTIVES_CONTROLLER
        )
        expect(market.l2Pool).toBe(L2_POOLS.includes(book.CHAIN_ID))
        if (book.L2_ENCODER) expect(market.l2Pool).toBe(true)

        if (market.gateway) {
          const wrapped = assets.find(
            (a) => a.UNDERLYING === market.gateway!.wrapped
          )
          expect(market.gateway.address).toBe(book.WETH_GATEWAY)
          expect(wrapped?.A_TOKEN).toBe(market.gateway.aToken)
          expect(wrapped?.V_TOKEN).toBe(market.gateway.variableDebtToken)
        }
      })

      it("has the registry's reserves, by id", () => {
        // Reserve ids run from 0 without gaps, so a reserve's id is its index
        expect(assets.map((a) => a.id)).toEqual(assets.map((_, i) => i))
        expect(
          market.reserves.slice(0, assets.length).map(([, address]) => address)
        ).toEqual(assets.map((a) => a.UNDERLYING))
        expect(market.reserves.length - assets.length).toBe(
          NEWER_THAN_REGISTRY[name] ?? 0
        )
      })
    })
  }

  it('names reserves uniquely within a market', () => {
    for (const markets of Object.values(AAVE_V3)) {
      for (const { reserves } of Object.values(markets) as AaveMarket[]) {
        const symbols = reserves.map(([symbol]) => symbol)
        expect(new Set(symbols).size).toBe(symbols.length)
      }
    }
  })
})
