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
//   avatar's spot balance (sub-account zero), USDC (token 0), to USDC's system
//   address, which HyperCore pays out to the sender's own HyperEVM balance.
// - No other action is allowed. Trading keys sign orders off chain, so the
//   avatar needs no order actions, and spot sends, vault transfers and staking
//   would move funds to other accounts.
// - `builderFee` pins the builder and the rate; it is a preset of its own, so
//   no role gets it by taking the others.

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

export type HyperliquidBuilderFeeParams = HyperliquidParams & {
  /** The builder whose fee the avatar approves. */
  builder: Address
  /**
   * The highest fee the builder may charge, as Hyperliquid writes it:
   * `'0.05%'`. At most three decimals and at most 1%.
   */
  maxFeeRate: `${number}%`
}

const ACTION = {
  usdClassTransfer: 7, // (uint64 ntl, bool toPerp)
  addApiWallet: 9, // (address wallet, string name)
  approveBuilderFee: 12, // (uint64 maxFeeRate, address builder)
  sendAsset: 13, // (address destination, address subAccount, uint32 sourceDex, uint32 destinationDex, uint64 token, uint64 wei)
} as const

const PERP_DEX = 0
const SPOT_DEX = 0xffffffff
const USDC_TOKEN = 0n
/** HyperCore pays USDC sent here out to the sender's HyperEVM balance. */
const USDC_SYSTEM_ADDRESS: Address =
  '0x2000000000000000000000000000000000000000'

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
 * Deposit USDC into the avatar's Hyperliquid account, move it between spot and
 * perp, and withdraw it from spot to the avatar on HyperEVM.
 */
const funds = async ({ label, chain }: HyperliquidParams) => {
  const { usdc, coreDepositWallet } = resolve(chain)
  const wallet = at('hyperliquid_core_deposit_wallet', coreDepositWallet)
  const dex = oneOf([PERP_DEX, SPOT_DEX])

  return custom({
    label: label ?? 'Deposit, move and withdraw USDC on Hyperliquid',
    permissions: [
      at('erc20', usdc).approve(coreDepositWallet),
      wallet.depositFor(c.avatar, undefined, dex),
      wallet.deposit(undefined, dex),
      at('hyperliquid_core_writer', CORE_WRITER).sendRawAction(
        c.or<[Payload, Payload], BytesLike>(
          isAction(ACTION.usdClassTransfer),
          startsWith(
            payload(
              ACTION.sendAsset,
              ['address', 'address', 'uint32', 'uint32', 'uint64'],
              [USDC_SYSTEM_ADDRESS, ZERO, SPOT_DEX, SPOT_DEX, USDC_TOKEN]
            )
          )
        )
      ),
    ],
  })
}

/**
 * Approve one builder's fee, up to one rate, so that an app that routes orders
 * through that builder can trade for the avatar.
 */
const builderFee = async ({
  label,
  chain,
  builder,
  maxFeeRate,
}: HyperliquidBuilderFeeParams) => {
  resolve(chain)
  const rate = parseFeeRate(maxFeeRate)
  if (BigInt(builder) === 0n) {
    throw new Error('Pass the address of the builder.')
  }

  return custom({
    label:
      label ??
      `Approve builder fees of up to ${maxFeeRate} for ${getAddress(builder)} on Hyperliquid`,
    permissions: [
      at('hyperliquid_core_writer', CORE_WRITER).sendRawAction(
        startsWith(
          payload(
            ACTION.approveBuilderFee,
            ['uint64', 'address'],
            [rate, builder]
          )
        )
      ),
    ],
  })
}

type Payload = ConditionFunction<BytesLike>

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

/** "0.05%" as CoreWriter counts it, in tenths of a basis point: 50. */
const parseFeeRate = (rate: string) => {
  const match = /^(\d+)(?:\.(\d{1,3}))?%$/.exec(rate)
  if (match == null) {
    throw new Error(
      `Write the fee rate as a percentage with at most three decimals, like '0.05%', not '${rate}'.`
    )
  }

  const tenthsOfBasisPoints =
    BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'))
  if (tenthsOfBasisPoints === 0n || tenthsOfBasisPoints > 1000n) {
    throw new Error(
      `Hyperliquid builder fees are above 0% and at most 1%, not ${rate}.`
    )
  }
  return tenthsOfBasisPoints
}

export const hyperliquid = { tradingKeys, funds, builderFee }
