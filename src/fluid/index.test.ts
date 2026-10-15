import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { allow as arb1 } from 'defi-kit/arb1'
import { allow as base } from 'defi-kit/base'
import { allow as eth } from 'defi-kit/eth'
import { expectSamePermissions } from '../test/defiKit'
import { NATIVE } from '../utils'
import { F_TOKENS, fluid, type FluidChain } from '.'

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
const WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
const F_USDC = '0x1a996cb54bb95462040408c06122d45d6cdb6096'
const F_WETH = '0x45df0656f8adf017590009d2f1898eeca4f0a205'

const SELECTORS = {
  approve: '0x095ea7b3',
  deposit: '0x6e553f65',
  withdraw: '0xb460af94',
  redeem: '0xba087652',
  depositNative: '0x33bb7f91',
  withdrawNative: '0x2126e91e',
  redeemNative: '0x3badef91',
}

// Condition operators, from zodiac-roles-sdk
const EQUAL_TO_AVATAR = 15
const EQUAL_TO = 16
const PASS = 0

type Permission = {
  targetAddress: string
  selector: string
  condition: any
  send?: boolean
}

const word = (address: string) =>
  `0x${address.slice(2).padStart(64, '0').toLowerCase()}`

const calls = (permissions: Permission[]) =>
  permissions.map(({ targetAddress, selector }) => [targetAddress, selector])

const find = (permissions: Permission[], target: string, selector: string) =>
  permissions.find((p) => p.targetAddress === target && p.selector === selector)

const operators = (permission: Permission | undefined) =>
  permission?.condition.children.map((c: any) => c.operator)

const deposit = async (tokens: `0x${string}`[], chain: FluidChain = 42161) =>
  (await fluid.deposit({ label: 'Deposit', chain, tokens }))
    .permissions as Permission[]

const withdraw = async (tokens: `0x${string}`[], chain: FluidChain = 42161) =>
  (await fluid.withdraw({ label: 'Withdraw', chain, tokens }))
    .permissions as Permission[]

// Nothing here may go to the network.
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('No network in tests')
  }) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = realFetch
})

describe('against DeFi Kit', () => {
  const defiKit = {
    1: eth.fluid.deposit,
    8453: base.fluid.deposit,
    42161: arb1.fluid.deposit,
  } as const

  const both = async (chain: FluidChain, tokens: `0x${string}`[]) => [
    ...(await deposit(tokens, chain)),
    ...(await withdraw(tokens, chain)),
  ]

  for (const [chain, theirs] of Object.entries(defiKit)) {
    const fTokens = F_TOKENS[Number(chain) as keyof typeof defiKit]

    it(`grants what fluid.deposit does on chain ${chain}, for every fToken and ETH`, async () => {
      expectSamePermissions(
        await both(Number(chain) as FluidChain, [
          ...fTokens.map((f) => f.asset),
          NATIVE,
        ]),
        await theirs({
          targets: [...fTokens.map((f) => f.symbol), 'ETH'] as any,
        })
      )
    })
  }

  it("grants what the client's Arbitrum constellation has today", async () => {
    expectSamePermissions(
      await both(42161, [NATIVE, WETH, USDC]),
      await arb1.fluid.deposit({ targets: ['ETH', 'WETH', 'USDC'] })
    )
  })

  it('splits the permissions between deposit and withdraw without overlap', async () => {
    const tokens: `0x${string}`[] = [NATIVE, WETH, USDC]
    const depositCalls = calls(await deposit(tokens)).map(String)
    const withdrawCalls = calls(await withdraw(tokens)).map(String)

    expect(depositCalls.filter((c) => withdrawCalls.includes(c))).toEqual([])
  })
})

describe('fluid.deposit', () => {
  it('approves the token to its fToken and deposits into it', async () => {
    expect(calls(await deposit([USDC]))).toEqual([
      [USDC, SELECTORS.approve],
      [F_USDC, SELECTORS.deposit],
    ])
  })

  it('lets the token be approved to its fToken only', async () => {
    const approve = find(await deposit([USDC]), USDC, SELECTORS.approve)

    expect(approve?.condition.children[0]).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(F_USDC),
    })
  })

  it('pins the receiver to the avatar', async () => {
    expect(
      operators(find(await deposit([USDC]), F_USDC, SELECTORS.deposit))
    ).toEqual([PASS, EQUAL_TO_AVATAR])
  })

  it('deposits the native token into the fToken over its wrapper, sending it along', async () => {
    const permissions = await deposit([NATIVE])
    const depositNative = find(permissions, F_WETH, SELECTORS.depositNative)

    expect(calls(permissions)).toEqual([[F_WETH, SELECTORS.depositNative]])
    expect(depositNative?.send).toBe(true)
    expect(operators(depositNative)).toEqual([EQUAL_TO_AVATAR])
  })

  it('sends no value along with ERC-20 deposits', async () => {
    const permissions = await deposit([USDC, WETH])

    expect(permissions.every((p) => !p.send)).toBe(true)
  })

  it('treats the wrapped token as an ERC-20, separately from the native one', async () => {
    expect(calls(await deposit([WETH, NATIVE]))).toEqual([
      [WETH, SELECTORS.approve],
      [F_WETH, SELECTORS.deposit],
      [F_WETH, SELECTORS.depositNative],
    ])
  })

  it("uses each chain's native-underlying fToken", async () => {
    const polygon = F_TOKENS[137].find((f) => f.symbol === 'WPOL')!.fToken
    const bnb = F_TOKENS[56].find((f) => f.symbol === 'WBNB')!.fToken

    expect(calls(await deposit([NATIVE], 137))).toEqual([
      [polygon.toLowerCase(), SELECTORS.depositNative],
    ])
    expect(calls(await deposit([NATIVE], 56))).toEqual([
      [bnb.toLowerCase(), SELECTORS.depositNative],
    ])
  })
})

describe('fluid.withdraw', () => {
  it('withdraws or redeems from the fToken, without any approval', async () => {
    expect(calls(await withdraw([USDC]))).toEqual([
      [F_USDC, SELECTORS.withdraw],
      [F_USDC, SELECTORS.redeem],
    ])
  })

  it('pins the receiver and the owner to the avatar', async () => {
    const permissions = await withdraw([USDC])

    for (const selector of [SELECTORS.withdraw, SELECTORS.redeem]) {
      expect(operators(find(permissions, F_USDC, selector))).toEqual([
        PASS,
        EQUAL_TO_AVATAR,
        EQUAL_TO_AVATAR,
      ])
    }
  })

  it('withdraws the native token, receiver and owner pinned to the avatar', async () => {
    const permissions = await withdraw([NATIVE])

    expect(calls(permissions)).toEqual([
      [F_WETH, SELECTORS.withdrawNative],
      [F_WETH, SELECTORS.redeemNative],
    ])
    for (const permission of permissions) {
      expect(operators(permission)).toEqual([
        PASS,
        EQUAL_TO_AVATAR,
        EQUAL_TO_AVATAR,
      ])
      expect(permission.send).toBeFalsy()
    }
  })
})

describe('tokens', () => {
  it('matches token addresses whatever their case, once each', async () => {
    expect(
      calls(await deposit([USDC, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831']))
    ).toEqual(calls(await deposit([USDC])))
  })

  it('throws for a token without an fToken on the chain', async () => {
    const unknown = '0x1111111111111111111111111111111111111111'

    await expect(deposit([USDC, unknown])).rejects.toThrow(
      `Fluid has no fToken for ${unknown} on chain 42161.`
    )
    // USDC on Arbitrum is not USDC on Base
    await expect(withdraw([USDC], 8453)).rejects.toThrow(
      `Fluid has no fToken for ${USDC} on chain 8453.`
    )
  })

  it('throws for the native token where no fToken takes it', async () => {
    await expect(deposit([NATIVE], 9745)).rejects.toThrow(
      'Fluid has no fToken for the native token on chain 9745.'
    )
  })

  it('throws without tokens', async () => {
    await expect(deposit([])).rejects.toThrow('Pass at least one token.')
  })
})

describe('labels', () => {
  it('keeps a label it is given', async () => {
    const entry = await fluid.deposit({
      label: 'Park USDC',
      chain: 42161,
      tokens: [USDC],
    })

    expect(entry.label).toBe('Park USDC')
  })

  it('names the tokens, in the order given', async () => {
    const entry = await fluid.deposit({
      chain: 42161,
      tokens: [USDC, WETH, NATIVE],
    })

    expect(entry.label).toBe('Deposit USDC, WETH and ETH into Fluid')
  })

  it('names one token on withdrawal', async () => {
    const entry = await fluid.withdraw({ chain: 42161, tokens: [NATIVE] })

    expect(entry.label).toBe('Withdraw ETH from Fluid')
  })

  it("names the chain's native token", async () => {
    const entry = await fluid.deposit({ chain: 137, tokens: [NATIVE] })

    expect(entry.label).toBe('Deposit POL into Fluid')
  })
})

describe('F_TOKENS', () => {
  const zodiacChains = new Set<number>(Object.values(CHAIN_IDS))

  it('only lists chains Zodiac supports', () => {
    for (const chain of Object.keys(F_TOKENS)) {
      expect(zodiacChains.has(Number(chain))).toBe(true)
    }
  })

  it('has at most one native-underlying fToken per chain, and unique tokens', () => {
    for (const fTokens of Object.values(F_TOKENS)) {
      expect(fTokens.filter((f) => 'native' in f).length).toBeLessThan(2)
      expect(new Set(fTokens.map((f) => f.asset)).size).toBe(fTokens.length)
    }
  })
})
