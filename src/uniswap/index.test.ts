import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CHAIN_TO_ADDRESSES_MAP } from '@uniswap/sdk-core'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { allow as arb1 } from 'defi-kit/arb1'
import { allow as base } from 'defi-kit/base'
import { allow as eth } from 'defi-kit/eth'
import { allow as gno } from 'defi-kit/gno'
import { allow as oeth } from 'defi-kit/oeth'
import { Interface } from 'ethers'
import { Operator } from 'zodiac-roles-sdk'
import positionManagerAbi from '../../abis/any/uniswap_v3_position_manager.json'
import { expectSamePermissions } from '../test/defiKit'
import { NATIVE } from '../utils'
import { POSITION_MANAGER, uniswap, type UniswapParams } from '.'

type Address = `0x${string}`

const WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
const WBTC = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f'
const MANAGER = POSITION_MANAGER[42161].toLowerCase()

// The contract `c.avatarIsOwnerOfErc721` asks whether the avatar owns the NFT.
const AVATAR_IS_OWNER_OF_ERC721 = '0x91b1bd7bcc5e623d5ce76b0152253499a9c819d1'

const SELECTORS = {
  approve: '0x095ea7b3',
  mint: '0x88316456',
  increaseLiquidity: '0x219f5d17',
  decreaseLiquidity: '0x0c49ccbe',
  collect: '0xfc6f7865',
}

type Permission = { targetAddress: string; selector: string; condition: any }

const word = (value: string | number | bigint) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`

const calls = (permissions: Permission[]) =>
  permissions.map(({ targetAddress, selector }) => [targetAddress, selector])

const find = (permissions: Permission[], target: string, selector: string) =>
  permissions.find((p) => p.targetAddress === target && p.selector === selector)

/** The conditions on a struct's fields, the function's only parameter. */
const fields = (permission: Permission | undefined) =>
  permission!.condition.children[0].children

const pools = {
  label: 'Liquidity',
  chain: 42161,
  tokens: [WETH, USDC, WBTC],
  fees: ['0.05%', '0.3%'],
} as const satisfies UniswapParams

const positions = {
  label: 'Liquidity',
  chain: 42161,
  positions: [1n, 2n],
  tokens: [WETH, USDC, WBTC],
} as const satisfies UniswapParams

const deposit = async (params: UniswapParams = pools) =>
  (await uniswap.deposit(params)).permissions as Permission[]

const withdraw = async (params: UniswapParams = pools) =>
  (await uniswap.withdraw(params)).permissions as Permission[]

const both = async (params: UniswapParams) => [
  ...(await deposit(params)),
  ...(await withdraw(params)),
]

describe('uniswap.deposit', () => {
  it('allows approving, opening positions and topping them up', async () => {
    expect(calls(await deposit())).toEqual([
      [WETH, SELECTORS.approve],
      [USDC, SELECTORS.approve],
      [WBTC, SELECTORS.approve],
      [MANAGER, SELECTORS.mint],
      [MANAGER, SELECTORS.increaseLiquidity],
    ])
  })

  it('lets the tokens be approved to the position manager only', async () => {
    for (const token of [WETH, USDC, WBTC]) {
      const approve = find(await deposit(), token, SELECTORS.approve)

      expect(approve?.condition.children[0].compValue).toBe(word(MANAGER))
    }
  })

  it('opens positions in pairs of the tokens, at the fee tiers, for the avatar', async () => {
    const [token0, token1, fee, ...rest] = fields(
      find(await deposit(), MANAGER, SELECTORS.mint)
    )
    const recipient = rest[6]

    for (const token of [token0, token1]) {
      expect(token.operator).toBe(Operator.Or)
      expect(token.children.map((c: any) => c.compValue)).toEqual([
        word(WETH),
        word(USDC),
        word(WBTC),
      ])
    }
    expect(fee.children.map((c: any) => c.compValue)).toEqual([
      word(500),
      word(3000),
    ])
    expect(recipient.operator).toBe(Operator.EqualToAvatar)
  })

  it('maps every fee tier to its pool fee', async () => {
    const [, , fee] = fields(
      find(
        await deposit({ ...pools, fees: ['0.01%', '0.05%', '0.3%', '1%'] }),
        MANAGER,
        SELECTORS.mint
      )
    )

    expect(fee.children.map((c: any) => c.compValue)).toEqual(
      [100, 500, 3000, 10000].map(word)
    )
  })

  it('only tops up positions the avatar owns', async () => {
    const [tokenId] = fields(
      find(await deposit(), MANAGER, SELECTORS.increaseLiquidity)
    )

    expect(tokenId.operator).toBe(Operator.Custom)
    expect(tokenId.compValue.slice(0, 42)).toBe(AVATAR_IS_OWNER_OF_ERC721)
  })

  it('sends no ETH along', async () => {
    for (const permission of await deposit()) {
      expect((permission as { send?: boolean }).send).toBeFalsy()
    }
  })

  it('takes WETH, not native ETH', async () => {
    await expect(
      uniswap.deposit({ ...pools, tokens: [NATIVE, USDC] })
    ).rejects.toThrow('pass the WETH address instead of NATIVE')
  })

  it('opens no positions when given positions', async () => {
    expect(calls(await deposit(positions))).toEqual([
      [WETH, SELECTORS.approve],
      [USDC, SELECTORS.approve],
      [WBTC, SELECTORS.approve],
      [MANAGER, SELECTORS.increaseLiquidity],
    ])
  })

  it('only tops up the given positions, while the avatar owns them', async () => {
    const [tokenId] = fields(
      find(await deposit(positions), MANAGER, SELECTORS.increaseLiquidity)
    )
    const [ids, owned] = tokenId.children

    expect(tokenId.operator).toBe(Operator.And)
    expect(ids.children.map((c: any) => c.compValue)).toEqual([
      word(1),
      word(2),
    ])
    expect(owned.operator).toBe(Operator.Custom)
  })
})

describe('uniswap.withdraw', () => {
  it('allows removing liquidity and collecting it', async () => {
    expect(calls(await withdraw())).toEqual([
      [MANAGER, SELECTORS.decreaseLiquidity],
      [MANAGER, SELECTORS.collect],
    ])
  })

  it('collects to the avatar', async () => {
    const [tokenId, recipient] = fields(
      find(await withdraw(), MANAGER, SELECTORS.collect)
    )

    expect(tokenId.operator).toBe(Operator.Pass)
    expect(recipient.operator).toBe(Operator.EqualToAvatar)
  })

  it('leaves decreasing open, as only the owner can', async () => {
    expect(
      find(await withdraw(), MANAGER, SELECTORS.decreaseLiquidity)?.condition
    ).toBeUndefined()
  })

  it('only touches the given positions', async () => {
    const permissions = await withdraw(positions)

    for (const selector of [SELECTORS.decreaseLiquidity, SELECTORS.collect]) {
      const [tokenId] = fields(find(permissions, MANAGER, selector))

      expect(tokenId.children.map((c: any) => c.compValue)).toEqual([
        word(1),
        word(2),
      ])
    }
  })

  it('uses the position manager of the chain', async () => {
    for (const { targetAddress } of await withdraw({ ...pools, chain: 8453 })) {
      expect(targetAddress).toBe(POSITION_MANAGER[8453].toLowerCase())
    }
  })
})

describe('DeFi Kit', () => {
  // A representative token set for each chain DeFi Kit covers. DeFi Kit gets
  // them by address too, as its symbols are ambiguous (on Optimism, "USDC" is
  // the bridged USDC.e).
  const chains = [
    {
      chain: 1,
      kit: eth,
      tokens: [
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      ],
    },
    {
      chain: 10,
      kit: oeth,
      tokens: [
        '0x4200000000000000000000000000000000000006', // WETH
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
        '0x4200000000000000000000000000000000000042', // OP
      ],
    },
    {
      chain: 100,
      kit: gno,
      tokens: [
        '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // WXDAI
        '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1', // WETH
        '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb', // GNO
      ],
    },
    {
      chain: 42161,
      kit: arb1,
      tokens: [WETH, USDC, WBTC],
    },
  ] as const

  const fees = ['0.05%', '0.3%'] as const

  for (const { chain, kit, tokens } of chains) {
    it(`grants the same as DeFi Kit on chain ${chain}`, async () => {
      expectSamePermissions(
        await both({
          chain,
          tokens,
          fees,
        }),
        await kit.uniswap_v3.deposit({
          tokens: [...tokens] as any,
          fees: [...fees],
        })
      )
    })
  }

  // Deliberate deviation: DeFi Kit's Base preset points at Ethereum's position
  // manager address, which on Base is an unrelated contract, so its approvals
  // go to the wrong spender and its calls can't work. Ours uses Base's own
  // position manager and is otherwise the same.
  it("uses Base's own position manager, unlike DeFi Kit", async () => {
    const tokens = [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // cbBTC
    ] as const
    const theirs = (await base.uniswap_v3.deposit({
      tokens: [...tokens] as any,
      fees: [...fees],
    })) as Permission[]
    const ours = await both({
      chain: 8453,
      tokens,
      fees,
    })
    const right = POSITION_MANAGER[8453].toLowerCase().slice(2)
    const wrong = POSITION_MANAGER[1].toLowerCase().slice(2)

    expect(JSON.stringify(ours)).toContain(right)
    expect(JSON.stringify(ours)).not.toContain(wrong)

    // Swapped back, ours is what DeFi Kit grants.
    expectSamePermissions(
      JSON.parse(JSON.stringify(ours).replaceAll(right, wrong)),
      theirs
    )
  })

  describe('with positions', () => {
    // DeFi Kit looks up the tokens of the positions it's given on chain, on
    // a local node while testing (Arbitrum's on port 8546). This one knows
    // positions 1 (WETH/USDC) and 2 (WETH/WBTC).
    const positionManager = new Interface(positionManagerAbi)
    const POSITIONS: Record<string, [Address, Address]> = {
      '1': [WETH, USDC],
      '2': [WETH, WBTC],
    }

    let node: ReturnType<typeof Bun.serve>

    beforeAll(() => {
      const answer = ({ id, method, params }: any) => {
        if (method === 'eth_chainId')
          return { jsonrpc: '2.0', id, result: '0xa4b1' }
        if (method === 'eth_call') {
          const [tokenId] = positionManager.decodeFunctionData(
            'positions',
            params[0].data
          )
          const [token0, token1] = POSITIONS[String(tokenId)]!
          const result = positionManager.encodeFunctionResult('positions', [
            0,
            NATIVE,
            token0,
            token1,
            500,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ])
          return { jsonrpc: '2.0', id, result }
        }
        return { jsonrpc: '2.0', id, error: { code: -32601, message: method } }
      }

      node = Bun.serve({
        port: 8546,
        fetch: async (request) => {
          const body = await request.json()
          return Response.json(
            Array.isArray(body) ? body.map(answer) : answer(body)
          )
        },
      })
    })

    afterAll(() => node.stop(true))

    // Deliberate deviation: given positions, DeFi Kit lets the role top up
    // any of them, even one the avatar has since given away, pouring the
    // avatar's tokens into someone else's position. Ours still checks that
    // the avatar owns it.
    it('grants the same as DeFi Kit, but only tops up positions the avatar owns', async () => {
      const theirs = (await arb1.uniswap_v3.deposit({
        targets: ['1', '2'],
      })) as Permission[]
      const ours = await both(positions)

      const increase = (permissions: Permission[]) =>
        find(permissions, MANAGER, SELECTORS.increaseLiquidity)!
      const rest = (permissions: Permission[]) =>
        permissions.filter((p) => p !== increase(permissions))

      expectSamePermissions(rest(ours), rest(theirs))

      const [theirTokenId] = fields(increase(theirs))
      const [ourTokenId] = fields(increase(ours))

      expect(ourTokenId.operator).toBe(Operator.And)
      expect(ourTokenId.children[0]).toEqual(theirTokenId)
      expect(ourTokenId.children[1].operator).toBe(Operator.Custom)
    })
  })
})

describe('labels', () => {
  it('keeps a label it is given', async () => {
    expect((await uniswap.deposit(pools)).label).toBe('Liquidity')
  })

  it('names the tokens and fee tiers', async () => {
    const { label: _, ...params } = pools

    expect((await uniswap.deposit(params)).label).toBe(
      'Provide WETH, USDC and WBTC liquidity on Uniswap v3 (0.05%, 0.3%)'
    )
    expect((await uniswap.withdraw(params)).label).toBe(
      'Remove WETH, USDC and WBTC liquidity from Uniswap v3 (0.05%, 0.3%)'
    )
  })

  it('names the positions', async () => {
    const { label: _, ...params } = positions

    expect((await uniswap.deposit(params)).label).toBe(
      'Provide WETH, USDC and WBTC liquidity to Uniswap v3 positions #1 and #2'
    )
    expect((await uniswap.withdraw({ ...params, positions: [7n] })).label).toBe(
      'Remove WETH, USDC and WBTC liquidity from Uniswap v3 position #7'
    )
  })

  it('falls back to the address of a token it does not know', async () => {
    const unknown = '0x1111111111111111111111111111111111111111'
    const entry = await uniswap.deposit({
      chain: 42161,
      tokens: [unknown, USDC],
      fees: ['1%'],
    })

    expect(entry.label).toBe(
      `Provide ${unknown} and USDC liquidity on Uniswap v3 (1%)`
    )
  })
})

describe('POSITION_MANAGER', () => {
  const zodiacChains = new Set<number>(Object.values(CHAIN_IDS))
  const uniswapChains = Object.entries(CHAIN_TO_ADDRESSES_MAP)
    .map(([chain, addresses]) => ({
      chain: Number(chain),
      address: addresses.nonfungiblePositionManagerAddress?.toLowerCase(),
    }))
    .filter(({ chain, address }) => address != null && zodiacChains.has(chain))

  const lowercase = (map: Record<number, string>) =>
    Object.fromEntries(
      Object.entries(map).map(([chain, address]) => [
        chain,
        address.toLowerCase(),
      ])
    )

  it("lists Uniswap's address on every chain Zodiac supports", () => {
    // Gnosis isn't in `@uniswap/sdk-core`; see `POSITION_MANAGER`.
    const { 100: _, ...ours } = POSITION_MANAGER

    expect(
      Object.fromEntries(uniswapChains.map((u) => [u.chain, u.address]))
    ).toEqual(lowercase(ours))
  })

  it('is only on chains Zodiac supports', () => {
    for (const chain of Object.keys(POSITION_MANAGER)) {
      expect(zodiacChains.has(Number(chain))).toBe(true)
    }
  })
})
