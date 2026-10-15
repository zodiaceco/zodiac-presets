import { afterEach, describe, expect, it } from 'bun:test'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import {
  processPermissions,
  targetIntegrity,
  type Permission,
} from 'zodiac-roles-sdk'
import { NATIVE } from '../utils'
import { PENDLE, pendle, pendleMarkets, type PendleMarket } from '.'

const ROUTER = PENDLE[1].router.toLowerCase()
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3' as const
const SUSDE = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

const SUSDE_NOV: PendleMarket = {
  market: '0x47ad2Cd1DD15739A7a035b9d3B7828d916FEF77E',
  pt: '0xB195B618EA52b77CB2a58846F452f59f8dFa9390',
  yt: '0x89E6e5f7c3A60e7D6347F054051A29a272F4cE44',
  sy: '0xBF98480425A29197e5d99D003017f63a1e595D02',
  name: 'sUSDe',
  // Far in the future, so no test depends on today's date
  expiry: new Date('2099-11-26T00:00:00Z'),
}
const SUSDE_AUG: PendleMarket = {
  market: '0x177768caf9D0e036725A51D3f60d7E20F2D4D194',
  pt: '0x5A19fa369F2895dCD8d2cEE62E4Ceae58eF92BBb',
  yt: '0x45A699A11A4a17fe0931EF3ceA4BFc3235e659F2',
  sy: '0xBF98480425A29197e5d99D003017f63a1e595D02',
}
const MARKETS = [SUSDE_NOV, SUSDE_AUG] as const

const SELECTORS = {
  approve: '0x095ea7b3',
  swapExactTokenForPt: '0xc81f847a',
  swapExactPtForToken: '0x594a88cc',
  redeemPyToToken: '0x47f1de22',
  addLiquiditySingleToken: '0x12599ac6',
  removeLiquiditySingleToken: '0x60da0860',
  swapExactTokenForYt: '0xed48907e',
  swapExactYtForToken: '0x05eb5327',
  redeemDueInterestAndRewards: '0xf7e375e8',
  exitPostExpToToken: '0xf06a07a0',
}

// Condition operators, from zodiac-roles-sdk
const PASS = 0
const OR = 2
const MATCHES = 5
const ARRAY_SOME = 6
const ARRAY_EVERY = 7
const EQUAL_TO_AVATAR = 15
const EQUAL_TO = 16
const WITHIN_ALLOWANCE = 28

const word = (value: string | number) =>
  `0x${(typeof value === 'number' ? value.toString(16) : value.slice(2))
    .padStart(64, '0')
    .toLowerCase()}`

type Node = { operator: number; compValue?: string; children?: Node[] }

type Entry = {
  targetAddress: string
  selector: string
  condition: Node
  send?: boolean
}

const permissionsOf = (preset: { permissions: unknown }) =>
  preset.permissions as Entry[]

const find = (
  preset: { permissions: unknown },
  target: string,
  selector: string
) =>
  permissionsOf(preset).find(
    (p) =>
      p.targetAddress.toLowerCase() === target.toLowerCase() &&
      p.selector === selector
  )!

const calls = (preset: { permissions: unknown }) =>
  permissionsOf(preset).map((p) => [p.targetAddress.toLowerCase(), p.selector])

/** The branches of an `oneOf` over a tuple: the Or's children, or the node. */
const branches = (node: Node) =>
  node.operator === OR ? node.children! : [node]

/** `{ field: node }` for a Matches node over a struct with these fields. */
const fields = (node: Node, names: string[]) =>
  Object.fromEntries(names.map((name, i) => [name, node.children![i]!]))

const INPUT = ['tokenIn', 'netTokenIn', 'tokenMintSy', 'pendleSwap', 'swapData']
const OUTPUT = [
  'tokenOut',
  'minTokenOut',
  'tokenRedeemSy',
  'pendleSwap',
  'swapData',
]
const LIMIT = [
  'limitRouter',
  'epsSkipMarket',
  'normalFills',
  'flashFills',
  'optData',
]

const operatorsIn = (node: Node): number[] => [
  node.operator,
  ...(node.children ?? []).flatMap(operatorsIn),
]

const compiles = (preset: { permissions: unknown }) =>
  targetIntegrity(
    processPermissions(preset.permissions as Permission[]).targets
  )

const buyPt = () =>
  pendle.buyPt({
    chain: 1,
    markets: MARKETS,
    tokens: [{ token: WETH, allowance: 'pendle_weth' }, { token: USDE }],
  })

describe('pendle.buyPt', () => {
  it('approves the tokens to the router and buys PT', () => {
    expect(calls(buyPt())).toEqual([
      [WETH.toLowerCase(), SELECTORS.approve],
      [USDE.toLowerCase(), SELECTORS.approve],
      [ROUTER, SELECTORS.swapExactTokenForPt],
    ])
    for (const token of [WETH, USDE]) {
      expect(
        find(buyPt(), token, SELECTORS.approve).condition.children![0]
      ).toMatchObject({
        operator: EQUAL_TO,
        compValue: word(PENDLE[1].router),
      })
    }
  })

  it('pins the receiver to the avatar and the market to the listed ones', () => {
    const [receiver, market] = find(
      buyPt(),
      ROUTER,
      SELECTORS.swapExactTokenForPt
    ).condition.children!
    expect(receiver!.operator).toBe(EQUAL_TO_AVATAR)
    expect(market!.operator).toBe(OR)
    expect(market!.children!.map((c) => c.compValue)).toEqual([
      word(SUSDE_NOV.market),
      word(SUSDE_AUG.market),
    ])
  })

  it('allows one route per token, and an unwrap route for WETH', () => {
    const input = find(buyPt(), ROUTER, SELECTORS.swapExactTokenForPt).condition
      .children![4]!
    const routes = branches(input).map((branch) => {
      const f = fields(branch, INPUT)
      return {
        tokenIn: f.tokenIn!.compValue,
        tokenMintSy: f.tokenMintSy!.compValue,
        pendleSwap: f.pendleSwap!.compValue,
        swapType: f.swapData!.children![0]!.compValue,
        netTokenIn: f.netTokenIn!.operator,
      }
    })

    expect(routes).toEqual([
      {
        tokenIn: word(WETH),
        tokenMintSy: word(WETH),
        pendleSwap: word(NATIVE),
        swapType: word(0),
        netTokenIn: WITHIN_ALLOWANCE,
      },
      {
        tokenIn: word(WETH),
        tokenMintSy: word(NATIVE),
        pendleSwap: word(NATIVE),
        swapType: word(3),
        netTokenIn: WITHIN_ALLOWANCE,
      },
      {
        tokenIn: word(USDE),
        tokenMintSy: word(USDE),
        pendleSwap: word(NATIVE),
        swapType: word(0),
        netTokenIn: PASS,
      },
    ])
  })

  it('refuses limit-order fills', () => {
    const limit = fields(
      find(buyPt(), ROUTER, SELECTORS.swapExactTokenForPt).condition
        .children![5]!,
      LIMIT
    )
    expect(limit.limitRouter).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(NATIVE),
    })
    // An empty list: its length word, zero
    for (const fills of [limit.normalFills!, limit.flashFills!]) {
      expect(fills).toMatchObject({ operator: EQUAL_TO })
      expect(BigInt(fills.compValue!.slice(-64))).toBe(0n)
    }
  })

  it('labels itself after the markets', () => {
    expect(buyPt().label).toBe(
      `Buy Pendle PT (sUSDe 26 Nov 2099, ${SUSDE_AUG.market})`
    )
  })

  it('needs a market', () => {
    expect(() =>
      pendle.buyPt({ chain: 1, markets: [], tokens: [{ token: USDE }] })
    ).toThrow('needs at least one value')
  })

  it('refuses the native token', () => {
    expect(() =>
      pendle.buyPt({ chain: 1, markets: MARKETS, tokens: [{ token: NATIVE }] })
    ).toThrow('pay with the wrapped native token')
  })

  it('refuses a token no SY takes, when the markets carry their SY tokens', () => {
    const known = { ...SUSDE_NOV, tokensMintSy: [USDE, SUSDE] }
    expect(() =>
      pendle.buyPt({ chain: 1, markets: [known], tokens: [{ token: USDC }] })
    ).toThrow(`No SY of these Pendle markets takes ${USDC}`)
    expect(() =>
      pendle.buyPt({ chain: 1, markets: [known], tokens: [{ token: USDE }] })
    ).not.toThrow()
  })

  it('takes WETH for an SY that takes the native token', () => {
    const stEth = { ...SUSDE_NOV, tokensMintSy: [NATIVE] }
    expect(() =>
      pendle.buyPt({ chain: 1, markets: [stEth], tokens: [{ token: WETH }] })
    ).not.toThrow()
  })
})

describe('pendle.sellPt, redeem, removeLiquidity, sellYt', () => {
  const presets = [
    [
      'sellPt',
      SELECTORS.swapExactPtForToken,
      (m: PendleMarket) => m.pt,
      'market',
    ],
    ['redeem', SELECTORS.redeemPyToToken, (m: PendleMarket) => m.pt, 'yt'],
    [
      'removeLiquidity',
      SELECTORS.removeLiquiditySingleToken,
      (m: PendleMarket) => m.market,
      'market',
    ],
    [
      'sellYt',
      SELECTORS.swapExactYtForToken,
      (m: PendleMarket) => m.yt,
      'market',
    ],
  ] as const

  for (const [name, selector, approved, listed] of presets) {
    const preset = () =>
      pendle[name]({ chain: 1, markets: MARKETS, tokens: [SUSDE, USDE] })

    it(`${name}: approves what it spends to the router, pays the avatar`, () => {
      expect(calls(preset())).toEqual([
        ...MARKETS.map((m) => [approved(m).toLowerCase(), SELECTORS.approve]),
        [ROUTER, selector],
      ])
      const [receiver, target] = find(preset(), ROUTER, selector).condition
        .children!
      expect(receiver!.operator).toBe(EQUAL_TO_AVATAR)
      expect(target!.children!.map((c) => c.compValue)).toEqual(
        MARKETS.map((m) => word(m[listed]))
      )
    })

    it(`${name}: pays out the listed tokens directly, with no aggregator`, () => {
      const output = find(preset(), ROUTER, selector).condition.children![3]!
      const routes = branches(output).map((branch) => {
        const f = fields(branch, OUTPUT)
        return [
          f.tokenOut!.compValue,
          f.tokenRedeemSy!.compValue,
          f.pendleSwap!.compValue,
          f.swapData!.children![0]!.compValue,
          f.minTokenOut!.operator,
        ]
      })
      expect(routes).toEqual(
        [SUSDE, USDE].map((token) => [
          word(token),
          word(token),
          word(NATIVE),
          word(0),
          PASS,
        ])
      )
    })
  }

  it('refuses a token no SY pays out, when the markets carry their SY tokens', () => {
    const known = { ...SUSDE_NOV, tokensRedeemSy: [SUSDE] }
    expect(() =>
      pendle.sellPt({ chain: 1, markets: [known], tokens: [USDE] })
    ).toThrow(`No SY of these Pendle markets pays out ${USDE}`)
  })
})

describe('pendle.addLiquidity and buyYt', () => {
  for (const [name, selector] of [
    ['addLiquidity', SELECTORS.addLiquiditySingleToken],
    ['buyYt', SELECTORS.swapExactTokenForYt],
  ] as const) {
    it(`${name}: pins the receiver, the markets, the routes and no fills`, () => {
      const preset = pendle[name]({
        chain: 1,
        markets: MARKETS,
        tokens: [{ token: USDE, allowance: 'pendle_usde' }],
      })
      const [receiver, market, , , input, limit] = find(
        preset,
        ROUTER,
        selector
      ).condition.children!
      expect(receiver!.operator).toBe(EQUAL_TO_AVATAR)
      expect(market!.operator).toBe(OR)
      expect(fields(input!, INPUT).netTokenIn!.operator).toBe(WITHIN_ALLOWANCE)
      expect(fields(limit!, LIMIT).normalFills!.operator).toBe(EQUAL_TO)
    })
  }
})

describe('pendle.redeem after the expiry', () => {
  const EXPIRED = { ...SUSDE_AUG, expiry: new Date('2026-08-13T00:00:00Z') }

  it('adds the exit route for markets that have expired, and only for those', () => {
    const preset = pendle.redeem({
      chain: 1,
      markets: [SUSDE_NOV, EXPIRED],
      tokens: [SUSDE],
    })
    expect(calls(preset).at(-1)).toEqual([ROUTER, SELECTORS.exitPostExpToToken])

    const [receiver, market, netPtIn, netLpIn, output] = find(
      preset,
      ROUTER,
      SELECTORS.exitPostExpToToken
    ).condition.children!
    expect(receiver!.operator).toBe(EQUAL_TO_AVATAR)
    // Before its expiry the exit strands PT in the YT contract, so the live
    // market is not allowed
    expect(market).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(EXPIRED.market),
    })
    expect([netPtIn!.operator, netLpIn!.operator]).toEqual([PASS, PASS])
    expect(fields(output!, OUTPUT)).toMatchObject({
      tokenOut: { compValue: word(SUSDE) },
      tokenRedeemSy: { compValue: word(SUSDE) },
      pendleSwap: { compValue: word(NATIVE) },
    })
  })

  it('leaves the exit route out without an expired market', () => {
    for (const markets of [[SUSDE_NOV], [SUSDE_AUG]]) {
      const preset = pendle.redeem({ chain: 1, markets, tokens: [SUSDE] })
      expect(calls(preset).map(([, selector]) => selector)).not.toContain(
        SELECTORS.exitPostExpToToken
      )
    }
  })
})

describe('pendle.claim', () => {
  it('claims for the avatar from the listed SYs, YTs and markets only', () => {
    const preset = pendle.claim({ chain: 1, markets: MARKETS })
    const [user, sys, yts, markets] = find(
      preset,
      ROUTER,
      SELECTORS.redeemDueInterestAndRewards
    ).condition.children!

    expect(user!.operator).toBe(EQUAL_TO_AVATAR)
    // Both markets share one SY
    expect(sys).toMatchObject({
      operator: ARRAY_EVERY,
      children: [{ operator: EQUAL_TO, compValue: word(SUSDE_NOV.sy) }],
    })
    for (const [list, listed] of [
      [yts!, MARKETS.map((m) => m.yt)],
      [markets!, MARKETS.map((m) => m.market)],
    ] as const) {
      expect(list.operator).toBe(ARRAY_EVERY)
      expect(list.children![0]!.children!.map((c) => c.compValue)).toEqual(
        listed.map(word)
      )
    }
  })
})

describe('every Pendle preset', () => {
  const all = [
    buyPt(),
    pendle.sellPt({ chain: 1, markets: MARKETS, tokens: [SUSDE] }),
    pendle.redeem({ chain: 1, markets: MARKETS, tokens: [SUSDE] }),
    pendle.redeem({
      chain: 1,
      markets: [{ ...SUSDE_AUG, expiry: new Date('2026-08-13T00:00:00Z') }],
      tokens: [SUSDE],
    }),
    pendle.addLiquidity({
      chain: 1,
      markets: MARKETS,
      tokens: [{ token: USDE }],
    }),
    pendle.removeLiquidity({ chain: 1, markets: MARKETS, tokens: [SUSDE] }),
    pendle.buyYt({ chain: 1, markets: MARKETS, tokens: [{ token: USDE }] }),
    pendle.sellYt({ chain: 1, markets: MARKETS, tokens: [SUSDE] }),
    pendle.claim({ chain: 1, markets: MARKETS }),
  ]

  it('passes the Roles integrity check', () => {
    for (const preset of all) expect(() => compiles(preset)).not.toThrow()
  })

  it('uses no ArraySome, which the Zodiac app does not accept', () => {
    for (const preset of all) {
      for (const permission of permissionsOf(preset)) {
        expect(operatorsIn(permission.condition)).not.toContain(ARRAY_SOME)
      }
    }
  })

  it('never lets value through', () => {
    for (const preset of all) {
      for (const permission of permissionsOf(preset)) {
        expect(permission.send).toBeFalsy()
      }
    }
  })

  it('pins a Matches over every router struct it allows', () => {
    const [, , , , input, limit] = find(
      all[0]!,
      ROUTER,
      SELECTORS.swapExactTokenForPt
    ).condition.children!
    expect(branches(input!).every((b) => b.operator === MATCHES)).toBe(true)
    expect(limit!.operator).toBe(MATCHES)
  })
})

describe('PENDLE', () => {
  it('lists only chains Zodiac supports, with the router at its usual address', () => {
    const zodiac = new Set<number>(Object.values(CHAIN_IDS))
    for (const [chain, { router }] of Object.entries(PENDLE)) {
      expect(zodiac.has(Number(chain))).toBe(true)
      expect(router).toBe('0x888888888889758F76e7103c6CbF23ABbF58F946')
    }
  })
})

describe('pendleMarkets', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const api = (answers: Record<string, unknown>) => {
    const asked: string[] = []
    globalThis.fetch = (async (url: string) => {
      const path = url.replace('https://api-v2.pendle.finance/core', '')
      asked.push(path)
      const answer = answers[path]
      return answer == null
        ? new Response('not found', { status: 404 })
        : Response.json(answer)
    }) as unknown as typeof fetch
    return asked
  }

  const apiMarket = (m: PendleMarket, name: string, expiry: string) => ({
    name,
    expiry,
    address: m.market.toLowerCase(),
    pt: `1-${m.pt.toLowerCase()}`,
    yt: `1-${m.yt.toLowerCase()}`,
    sy: `1-${m.sy.toLowerCase()}`,
  })
  const tokens = {
    tokensMintSy: [USDE.toLowerCase(), SUSDE.toLowerCase()],
    tokensRedeemSy: [SUSDE.toLowerCase()],
  }
  const answers = {
    '/v1/1/markets/active': {
      markets: [apiMarket(SUSDE_NOV, 'sUSDe', '2099-11-26T00:00:00.000Z')],
    },
    '/v1/1/markets/inactive': {
      markets: [apiMarket(SUSDE_AUG, 'sUSDe', '2026-08-13T00:00:00.000Z')],
    },
    [`/v1/sdk/1/markets/${SUSDE_NOV.market.toLowerCase()}/tokens`]: tokens,
    [`/v1/sdk/1/markets/${SUSDE_AUG.market.toLowerCase()}/tokens`]: tokens,
  }

  it('finds active markets by name, with checksummed addresses and SY tokens', async () => {
    api(answers)
    expect(await pendleMarkets({ chain: 1, names: ['susde'] })).toEqual([
      {
        ...SUSDE_NOV,
        tokensMintSy: [USDE, SUSDE],
        tokensRedeemSy: [SUSDE],
      },
    ])
  })

  it('finds an expired market by address', async () => {
    const asked = api(answers)
    const [market] = await pendleMarkets({
      chain: 1,
      addresses: [SUSDE_AUG.market],
    })
    expect(market?.market).toBe(SUSDE_AUG.market)
    expect(market?.expiry).toEqual(new Date('2026-08-13T00:00:00Z'))
    expect(asked).toContain('/v1/1/markets/inactive')
  })

  it('throws for an address the API does not know', async () => {
    api(answers)
    await expect(
      pendleMarkets({ chain: 1, addresses: [USDC] })
    ).rejects.toThrow(`Pendle's API knows no market ${USDC.toLowerCase()}`)
  })

  it('feeds the presets, which then check the tokens', async () => {
    api(answers)
    const markets = await pendleMarkets({ chain: 1, names: ['sUSDe'] })
    expect(() =>
      pendle.buyPt({
        chain: 1,
        markets,
        tokens: [{ token: USDC }],
      })
    ).toThrow('No SY of these Pendle markets takes')
  })
})
