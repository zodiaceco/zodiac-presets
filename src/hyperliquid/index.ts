import { c, type ConditionFunction } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { AbiCoder, getAddress, type BytesLike } from 'ethers'
import { at, type Address } from '../kit'
import { oneOf, ZERO } from '../utils'

// Hyperliquid (experimental): the avatar's HyperCore account, run from
// HyperEVM. A Safe cannot sign Hyperliquid's user actions, so it takes them
// through the CoreWriter system contract, whose only function takes one
// `bytes` payload: version byte 0x01, a 3-byte action id, then the action's
// ABI-encoded fields.
//
// Roles cannot decode that payload as a function call, so the presets pin
// byte ranges of it with Bitmask conditions, at most 15 bytes each. They never
// decode it as Calldata: the roles SDK sorts the branches of an `Or`, and a
// mix of Calldata and Bitmask branches comes out in an order the Roles mod
// rejects. A role that combines several of these presets gets one `Or` over
// CoreWriter's `sendRawAction`, so every preset has to stay on Bitmask.
//
// What keeps the avatar's funds in place:
// - Trading keys (Hyperliquid's API wallets) trade the avatar's HyperCore
//   account but Hyperliquid lets them neither withdraw nor transfer from it.
//   `tradingKeys` leaves the key and its name open: naming a key replaces the
//   key that had that name before, and the zero address removes one. A key can
//   still lose money by trading, so whoever holds this preset picks who trades.
// - USDC is only ever approved to Circle's CoreDepositWallet, for any amount:
//   `deposit` and `depositFor` pull from `msg.sender`, here the avatar. The
//   wallet is an upgradeable proxy, so the approval trusts Circle as far as
//   holding USDC does.
// - `depositFor` credits the avatar, `deposit` credits `msg.sender` (the
//   avatar), and both only into its perp or spot balance.
// - `usdClassTransfer` (action 7) moves USDC between the avatar's own perp and
//   spot balances. It has no destination field, so only the header is pinned.
// - `sendAsset` (action 13) is pinned in everything but the amount: from the
//   avatar's spot balance (sub-account zero), one of the listed tokens (its
//   spot token index), to that token's system address, which HyperCore pays
//   out to the sender's own HyperEVM balance.
// - `funds` takes a list of tokens, USDC alone by default. Besides USDC:
//   - HYPE is HyperEVM's native coin. It reaches the avatar's spot balance as
//     value sent to HYPE's system address, which credits `msg.sender`, the
//     avatar, whatever the calldata. Roles reads empty calldata as selector
//     `0x00000000`, so only that "function" may carry value there.
//   - Every other token is an ERC-20 linked to its spot token. Its `transfer`
//     is pinned to the token's system address, which HyperCore credits to the
//     sender's spot balance; only the amount is open.
// - `staking` moves HYPE between the avatar's spot and staking balances
//   (actions 4 and 5) and delegates it (action 3). Staked and delegated HYPE
//   stays the avatar's: a delegation only says which validator the avatar's
//   stake backs, and undelegating returns it to the avatar's staking balance
//   after Hyperliquid's one-day lockup. Staking to spot goes through
//   Hyperliquid's seven-day unstaking queue. The amounts are open, and so is
//   the validator unless the preset lists some. What is left to choose well is
//   the validator: it takes a commission on rewards, and Hyperliquid reserves
//   slashing for provably malicious behaviour, though it implements no
//   automatic slashing today
//   (https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/staking).
// - No other action is allowed. Trading keys sign orders off chain, so the
//   avatar needs no order actions, and spot sends and vault transfers would
//   move funds to other accounts. Builder fees (action 12) are not allowed
//   either.

/** CoreWriter, the same on every HyperEVM chain. */
export const CORE_WRITER: Address = '0x3333333333333333333333333333333333333333'

/** USDC and Circle's CoreDepositWallet, by chain id. */
export const HYPERLIQUID = {
  999: {
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    coreDepositWallet: '0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24',
  },
} as const satisfies Record<
  number,
  { usdc: Address; coreDepositWallet: Address }
>

/** The chains both Hyperliquid and Zodiac are deployed on, by chain id. */
export type HyperliquidChain = keyof typeof HYPERLIQUID

export type HyperliquidParams = {
  /** Defaults to what the preset allows: "Add and remove Hyperliquid trading keys". */
  label?: string
  chain: HyperliquidChain
}

/**
 * Spot tokens `funds` can move between the avatar's HyperEVM and HyperCore
 * balances, by chain id: the spot token index, and for ERC-20s the linked
 * HyperEVM contract. From Hyperliquid's `spotMeta` (`tokens[].index`,
 * `evmContract.address`), read 2026-11-17. USDC goes through Circle's
 * CoreDepositWallet instead (`HYPERLIQUID`), HYPE is the native coin.
 */
export const HYPERLIQUID_TOKENS = {
  999: {
    USDC: { index: 0 },
    HYPE: { index: 150 },
    UBTC: { index: 197, evm: '0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463' },
    UETH: { index: 221, evm: '0xBe6727B535545C67d5cAa73dEa54865B92CF7907' },
    USOL: { index: 254, evm: '0x068f321Fa8Fb9f0D135f290Ef6a3e2813e1c8A29' },
    USDT0: { index: 268, evm: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb' },
  },
} as const satisfies Record<
  HyperliquidChain,
  Record<string, { index: number; evm?: Address }>
>

export type HyperliquidToken =
  keyof (typeof HYPERLIQUID_TOKENS)[HyperliquidChain]

export type HyperliquidFundsParams = HyperliquidParams & {
  /** The tokens that may move. Defaults to USDC. */
  tokens?: readonly HyperliquidToken[]
}

export type HyperliquidStakingParams = HyperliquidParams & {
  /** The validators the avatar may delegate to and undelegate from. Any validator when left out. */
  validators?: readonly Address[]
}

const ACTION = {
  tokenDelegate: 3, // (address validator, uint64 wei, bool isUndelegate)
  stakingDeposit: 4, // (uint64 wei)
  stakingWithdraw: 5, // (uint64 wei)
  usdClassTransfer: 7, // (uint64 ntl, bool toPerp)
  addApiWallet: 9, // (address wallet, string name)
  sendAsset: 13, // (address destination, address subAccount, uint32 sourceDex, uint32 destinationDex, uint64 token, uint64 wei)
} as const

const PERP_DEX = 0
const SPOT_DEX = 0xffffffff
/** HYPE's system address: value sent here credits the sender's spot HYPE. */
export const HYPE_SYSTEM_ADDRESS: Address =
  '0x2222222222222222222222222222222222222222'
/** What Roles reads as the selector of a call with empty calldata. */
const NO_CALLDATA = '0x00000000'

/**
 * Where HyperCore pays a spot token out to the sender on HyperEVM, and where
 * an ERC-20 transfer credits the sender's spot balance: 0x20, then the token
 * index big-endian. HYPE has its own.
 */
export const systemAddress = (
  token: HyperliquidToken,
  index: number
): Address =>
  token === 'HYPE'
    ? HYPE_SYSTEM_ADDRESS
    : (getAddress(`0x20${index.toString(16).padStart(38, '0')}`) as Address)

/**
 * Add, replace and remove the avatar's Hyperliquid trading keys.
 */
const tradingKeys = async ({ label, chain }: HyperliquidParams) => {
  resolve(chain)

  return custom({
    label: label ?? 'Add and remove Hyperliquid trading keys',
    permissions: [
      at('hyperliquid_core_writer', CORE_WRITER).sendRawAction(
        isAction(ACTION.addApiWallet)
      ),
    ],
  })
}

/**
 * Deposit the listed tokens (USDC by default) into the avatar's Hyperliquid
 * account and withdraw them from spot to the avatar on HyperEVM. With USDC,
 * also move it between spot and perp.
 */
const funds = async ({
  label,
  chain,
  tokens = ['USDC'],
}: HyperliquidFundsParams) => {
  const { usdc, coreDepositWallet } = resolve(chain)
  const listed = resolveTokens(chain, tokens)
  const wallet = at('hyperliquid_core_deposit_wallet', coreDepositWallet)
  const dex = oneOf([PERP_DEX, SPOT_DEX])

  const deposits = listed.flatMap(({ token, index, evm }) => {
    if (token === 'USDC') {
      return [
        at('erc20', usdc).approve(coreDepositWallet),
        wallet.depositFor(c.avatar, undefined, dex),
        wallet.deposit(undefined, dex),
      ]
    }
    if (token === 'HYPE') {
      return [
        {
          targetAddress: HYPE_SYSTEM_ADDRESS.toLowerCase() as `0x${string}`,
          selector: NO_CALLDATA,
          send: true,
        } as const,
      ]
    }
    return [at('erc20', evm!).transfer(systemAddress(token, index))]
  })

  const payloads: Payload[] = [
    ...(listed.some(({ token }) => token === 'USDC')
      ? [isAction(ACTION.usdClassTransfer)]
      : []),
    ...listed.map(({ token, index }) =>
      startsWith(
        payload(
          ACTION.sendAsset,
          ['address', 'address', 'uint32', 'uint32', 'uint64'],
          [systemAddress(token, index), ZERO, SPOT_DEX, SPOT_DEX, BigInt(index)]
        )
      )
    ),
  ]

  return custom({
    label:
      label ?? `Deposit, move and withdraw ${listOf(tokens)} on Hyperliquid`,
    permissions: [
      ...deposits,
      at('hyperliquid_core_writer', CORE_WRITER).sendRawAction(anyOf(payloads)),
    ],
  })
}

/**
 * Move HYPE between the avatar's spot and staking balances, and delegate and
 * undelegate it, to the listed validators or, without a list, to any.
 */
const staking = async ({
  label,
  chain,
  validators,
}: HyperliquidStakingParams) => {
  resolve(chain)
  const pinned = resolveValidators(validators)

  const delegations =
    pinned == null
      ? [isAction(ACTION.tokenDelegate)]
      : pinned.map((validator) =>
          startsWith(payload(ACTION.tokenDelegate, ['address'], [validator]))
        )

  return custom({
    label:
      label ??
      (pinned == null
        ? 'Stake HYPE on Hyperliquid'
        : `Stake HYPE with ${pinned.length === 1 ? '1 validator' : `${pinned.length} validators`} on Hyperliquid`),
    permissions: [
      at('hyperliquid_core_writer', CORE_WRITER).sendRawAction(
        anyOf([
          isAction(ACTION.stakingDeposit),
          isAction(ACTION.stakingWithdraw),
          ...delegations,
        ])
      ),
    ],
  })
}

type Payload = ConditionFunction<BytesLike>

const resolveValidators = (validators: readonly Address[] | undefined) => {
  if (validators == null) {
    return null
  }
  if (validators.length === 0) {
    throw new Error('List at least one validator, or leave the list out.')
  }
  return Array.from(
    new Set(validators.map((validator) => getAddress(validator)))
  )
}

const resolveTokens = (
  chain: HyperliquidChain,
  tokens: readonly HyperliquidToken[]
) => {
  if (tokens.length === 0) {
    throw new Error('List at least one token.')
  }
  const known: Record<string, { index: number; evm?: Address }> =
    HYPERLIQUID_TOKENS[chain]
  return Array.from(new Set(tokens)).map((token) => {
    const entry = known[token]
    if (entry == null) {
      throw new Error(`Unknown Hyperliquid token ${token} on chain ${chain}.`)
    }
    return { token, ...entry }
  })
}

/** One condition, or an `Or` over several: `c.or` takes at least two. */
const anyOf = (payloads: Payload[]): Payload => {
  const [first, second, ...rest] = payloads
  return second == null
    ? first!
    : c.or<[Payload, Payload, ...Payload[]], BytesLike>(first!, second, ...rest)
}

/** "USDC", "USDC and HYPE", "USDC, HYPE and UBTC". */
const listOf = (tokens: readonly string[]) => {
  const unique = Array.from(new Set(tokens))
  return unique.length <= 1
    ? unique.join('')
    : `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}

const resolve = (chain: HyperliquidChain) => {
  const addresses = HYPERLIQUID[chain]
  if (addresses == null) {
    throw new Error(`Hyperliquid is not on chain ${chain}.`)
  }
  return addresses
}

const header = (action: number) => `0x01${action.toString(16).padStart(6, '0')}`

/** The CoreWriter payload for `action` with these fields. */
const payload = (action: number, types: string[], values: unknown[]) =>
  `${header(action)}${AbiCoder.defaultAbiCoder().encode(types, values).slice(2)}`

/** The payload is this action, with any fields. */
const isAction = (action: number) =>
  c.bitmask({ shift: 0, mask: '0xffffffff', value: header(action) })

/**
 * The payload starts with these bytes. One Bitmask compares at most 15 bytes,
 * so a longer prefix is a run of them; the last one stops where the prefix
 * does, so the fields after it stay open. A shorter payload fails the
 * Bitmasks that reach past its end.
 */
const startsWith = (prefix: string): Payload => {
  const length = (prefix.length - 2) / 2
  const windows: Payload[] = []
  for (let shift = 0; shift < length; shift += 15) {
    const size = Math.min(15, length - shift)
    windows.push(
      c.bitmask({
        shift,
        mask: `0x${'ff'.repeat(size)}`,
        value: `0x${prefix.slice(2 + shift * 2, 2 + (shift + size) * 2)}`,
      })
    )
  }

  const [first, second, ...rest] = windows
  return second == null
    ? first!
    : c.and<[Payload, Payload, ...Payload[]], BytesLike>(
        first!,
        second,
        ...rest
      )
}

export const hyperliquid = { tradingKeys, funds, staking }
