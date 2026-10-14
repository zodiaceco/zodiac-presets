import { c, type Scoping } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import type { BigNumberish } from 'ethers'
import { at, type Address } from '../kit'
import { list, NATIVE, oneOf } from '../utils'

// Liquidity positions on Uniswap v3, managed through its
// NonfungiblePositionManager (verified source on Sourcify), which mints each
// position as an NFT.
//
// What keeps the avatar's funds in place:
// - Tokens are only ever approved to the position manager, which pulls them
//   from `msg.sender` (the avatar) for the position being minted or increased.
// - `mint` sends the position NFT to the avatar, and only for the given tokens
//   and fee tiers. The position manager rejects a pair unless
//   token0 < token1, so either token may be any of `tokens`.
// - `increaseLiquidity` adds to any position, whoever owns it, so it's pinned to
//   positions the avatar owns.
// - `decreaseLiquidity` and `collect` only work on positions the avatar owns
//   (or was approved for), so their `tokenId` is left open, and `collect` pays
//   out to the avatar.
//
// Native ETH: like DeFi Kit, these presets don't allow sending ETH along, so
// positions hold WETH and none of the position manager's ETH helpers
// (`refundETH`, `unwrapWETH9`, `sweepToken`) are needed.

/**
 * NonfungiblePositionManager on every chain both Uniswap v3 and Zodiac
 * support, by chain id. Uniswap keeps the canonical list in
 * `@uniswap/sdk-core` (`CHAIN_TO_ADDRESSES_MAP[chainId]
 * .nonfungiblePositionManagerAddress`); a test checks this one against it.
 */
export const POSITION_MANAGER = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Ethereum
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Optimism
  56: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', // BNB Chain
  // Not in `@uniswap/sdk-core`: the governance-approved Gnosis deployment
  // (factory 0xe32F7dD7e3f098D518ff19A22d5f028e076489B1), which DeFi Kit
  // supports too.
  100: '0xAE8fbE656a77519a7490054274910129c9244FA3', // Gnosis
  130: '0x943e6e07a7E8E791dAFC44083e54041D743C46E9', // Unichain
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Polygon
  480: '0xec12a9F9a09f50550686363766Cc153D03c27b5e', // World Chain
  4326: '0xCDc86e98184e96436F733a8Bf31BD4F0214E6D7d', // MegaETH
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', // Base
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', // Arbitrum
  42220: '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A', // Celo
  43114: '0x655C406EBFa14EE2006250925e54ec43AD184f8B', // Avalanche
  57073: '0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8', // Ink
  59144: '0x4615C383F85D0a2BbED973d83ccecf5CB7121463', // Linea
  84532: '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2', // Base Sepolia
  11155111: '0x1238536071E1c677A632429e3655c799b22cDA52', // Sepolia
} as const satisfies Record<number, Address>

export type UniswapChain = keyof typeof POSITION_MANAGER

/** Uniswap v3's fee tiers, each with its own pools. */
export type UniswapFeeTier = keyof typeof FEES

const FEES = {
  '0.01%': 100,
  '0.05%': 500,
  '0.3%': 3000,
  '1%': 10000,
} as const

type Tokens = readonly [Address, Address, ...Address[]]

/** Positions the avatar holds, by their NFT's token id. */
type Positions = readonly [bigint, ...bigint[]]

export type UniswapParams = {
  /**
   * Defaults to "Provide WETH and USDC liquidity on Uniswap v3 (0.05%)" or
   * "Remove WETH and USDC liquidity from Uniswap v3 (0.05%)", with
   * `positions` "… Uniswap v3 position #123".
   */
  label?: string
  chain: UniswapChain
} & (
  | {
      /**
       * Positions can be opened in any pair of these, and the avatar's
       * positions topped up with them. WETH, not native ETH.
       */
      tokens: Tokens
      /** The fee tiers new positions can be opened in. */
      fees: readonly [UniswapFeeTier, ...UniswapFeeTier[]]
      positions?: never
    }
  | {
      /**
       * Manage only these positions, opening none: the avatar must hold them.
       */
      positions: Positions
      /** The tokens these positions are in, for the approvals they need. */
      tokens: Tokens
      fees?: never
    }
)

/**
 * Provide liquidity on Uniswap v3: open positions in pairs of `tokens` at the
 * given fee tiers, or top up the avatar's positions (just `positions`, if
 * given).
 */
const deposit = async (params: UniswapParams) => {
  const { chain, tokens, fees, positions } = params
  const positionManager = POSITION_MANAGER[chain]
  const manager = at('uniswap_v3_position_manager', positionManager)

  if (tokens.includes(NATIVE)) {
    throw new Error(
      'Uniswap v3 positions hold WETH, not native ETH: pass the WETH address instead of NATIVE.'
    )
  }

  return custom({
    label: params.label ?? `Provide ${describe(params, 'on', 'to')}`,
    permissions: [
      ...tokens.map((token) => at('erc20', token).approve(positionManager)),

      ...(fees
        ? [
            manager.mint({
              token0: oneOf(tokens),
              token1: oneOf(tokens),
              fee: oneOf(fees.map((fee) => FEES[fee])),
              recipient: c.avatar,
              // The price range (`tickLower`, `tickUpper`), the amounts and the
              // deadline only shape the position the avatar gets.
            }),
          ]
        : []),

      manager.increaseLiquidity({
        // Pinned to the avatar's positions even when they're listed: one the
        // avatar has since given away isn't its own to top up any more.
        // (DeFi Kit only checks ownership when no positions are listed.)
        tokenId: positions
          ? c.and<[Scoping<BigNumberish>, Scoping<BigNumberish>], BigNumberish>(
              oneOf<BigNumberish>(positions),
              c.avatarIsOwnerOfErc721
            )
          : c.avatarIsOwnerOfErc721,
        // The amounts and the deadline only shape what the avatar adds.
      }),
    ],
  })
}

/**
 * Remove liquidity from Uniswap v3 and collect the fees, paying out to the
 * avatar. Without `positions`, this covers every position the avatar holds,
 * whichever its tokens: `tokens` and `fees` only name it.
 */
const withdraw = async (params: UniswapParams) => {
  const { chain, positions } = params
  const manager = at('uniswap_v3_position_manager', POSITION_MANAGER[chain])

  return custom({
    label: params.label ?? `Remove ${describe(params, 'from', 'from')}`,
    permissions: [
      // The position manager only lets the position's owner (or whoever it
      // approved) decrease or collect, so any `tokenId` is the avatar's own.
      // The liquidity, minimum amounts and deadline only shape what's taken
      // out, which stays in the position until collected.
      manager.decreaseLiquidity(
        positions ? { tokenId: oneOf(positions) } : undefined
      ),
      manager.collect({
        tokenId: positions ? oneOf(positions) : undefined,
        recipient: c.avatar,
      }),
    ],
  })
}

/**
 * "WETH and USDC liquidity on Uniswap v3 (0.05%, 0.3%)", or with `positions`
 * "WETH and USDC liquidity to Uniswap v3 positions #1 and #2".
 */
const describe = (
  { tokens, fees, positions }: UniswapParams,
  pools: string,
  position: string
) => {
  const liquidity = `${list(tokens.map(symbol))} liquidity`

  return positions
    ? `${liquidity} ${position} Uniswap v3 ${
        positions.length === 1 ? 'position' : 'positions'
      } ${list(positions.map((id) => `#${id}`))}`
    : `${liquidity} ${pools} Uniswap v3 (${fees.join(', ')})`
}

const symbol = (token: Address) => SYMBOLS[token.toLowerCase()] ?? token

/** Symbols of the usual tokens, by lowercase address, for labels. */
const SYMBOLS: Record<string, string> = Object.fromEntries(
  Object.entries({
    // Ethereum
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
    '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
    '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0': 'wstETH',
    // Ethereum and Base
    '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf': 'cbBTC',
    // Gnosis
    '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d': 'WXDAI',
    '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1': 'WETH',
    '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83': 'USDC',
    '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0': 'USDC.e',
    '0x4ECaBa5870353805a9F068101A40E0f32ed605C6': 'USDT',
    '0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252': 'WBTC',
    '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb': 'GNO',
    '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6': 'wstETH',
    // Arbitrum
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': 'WETH',
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 'USDC',
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': 'USDC.e',
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': 'USDT',
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 'WBTC',
    '0x912CE59144191C1204E64559FE8253a0e49E6548': 'ARB',
    // Arbitrum and Optimism
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1': 'DAI',
    // The OP Stack's WETH (Optimism, Base, Unichain, World Chain, Ink, …)
    '0x4200000000000000000000000000000000000006': 'WETH',
    // Optimism
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': 'USDC',
    '0x7F5c764cBc14f9669B88837ca1490cCa17c31607': 'USDC.e',
    '0x4200000000000000000000000000000000000042': 'OP',
    // Base
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC',
  }).map(([address, symbol]) => [address.toLowerCase(), symbol])
)

export const uniswap = { deposit, withdraw }
