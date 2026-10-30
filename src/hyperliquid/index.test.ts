import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { AbiCoder } from 'ethers'
import { processPermissions, type Permission } from 'zodiac-roles-sdk'
import { CORE_WRITER, HYPERLIQUID, hyperliquid } from '.'

const { usdc: USDC, coreDepositWallet: CORE_DEPOSIT_WALLET } = HYPERLIQUID[999]
const usdc = USDC.toLowerCase()
const wallet = CORE_DEPOSIT_WALLET.toLowerCase()

const SELECTORS = {
  approve: '0x095ea7b3',
  deposit: '0x2b2dfd2c',
  depositFor: '0xc23c545a',
  sendRawAction: '0x17938e13',
}

// Condition operators, from zodiac-roles-sdk
const PASS = 0
const AND = 1
const OR = 2
const ARRAY_SOME = 6
const EQUAL_TO_AVATAR = 15
const EQUAL_TO = 16
const BITMASK = 21

const PERP = 0
const SPOT = 0xffffffff
const USDC_SYSTEM_ADDRESS = '0x2000000000000000000000000000000000000000'
const ZERO = '0x0000000000000000000000000000000000000000'
const STRANGER = '0x0000000000000000000000000000000000000bad'
const KEY = '0x00000000000000000000000000000000000a6e47'
const BUILDER = '0x1924b8561eeF20e70Ede628A296175D358BE80e5'

type PresetPermission = {
  targetAddress: string
  selector: string
  condition: any
  send?: boolean
  delegatecall?: boolean
}

const abi = AbiCoder.defaultAbiCoder()

/** A CoreWriter payload: version, 3-byte action id, ABI-encoded fields. */
const action = (id: number, types: string[], values: unknown[], version = 1) =>
  `0x${version.toString(16).padStart(2, '0')}${id.toString(16).padStart(6, '0')}${abi.encode(types, values).slice(2)}`

const addApiWallet = (key: string, name: string) =>
  action(9, ['address', 'string'], [key, name])
const usdClassTransfer = (ntl: bigint, toPerp: boolean) =>
  action(7, ['uint64', 'bool'], [ntl, toPerp])
const sendAsset = (
  destination: string,
  subAccount: string,
  sourceDex: number,
  destinationDex: number,
  token: bigint,
  amount: bigint
) =>
  action(
    13,
    ['address', 'address', 'uint32', 'uint32', 'uint64', 'uint64'],
    [destination, subAccount, sourceDex, destinationDex, token, amount]
  )
const toEvm = (amount: bigint) =>
  sendAsset(USDC_SYSTEM_ADDRESS, ZERO, SPOT, SPOT, 0n, amount)
const approveBuilderFee = (rate: bigint, builder: string) =>
  action(12, ['uint64', 'address'], [rate, builder])
const limitOrder = action(
  1,
  ['uint32', 'bool', 'uint64', 'uint64', 'bool', 'uint8', 'uint128'],
  [0, true, 6_000_000_000_000n, 100_000n, false, 3, 0n]
)
const vaultTransfer = action(
  2,
  ['address', 'bool', 'uint64'],
  [STRANGER, true, 1_000_000n]
)
const spotSend = (destination: string) =>
  action(6, ['address', 'uint64', 'uint64'], [destination, 0n, 100_000_000n])

/**
 * Whether `condition` lets the bytes in `data` through, the way the Roles mod
 * evaluates And, Or and Bitmask. A Bitmask that starts past the end fails
 * (BitmaskOverflow); bytes it reaches past the end count as zero.
 */
const passes = (condition: any, data: string): boolean => {
  switch (condition.operator) {
    case AND:
      return condition.children.every((child: any) => passes(child, data))
    case OR:
      return condition.children.some((child: any) => passes(child, data))
    case BITMASK: {
      const bytes = Buffer.from(data.slice(2), 'hex')
      const compValue = Buffer.from(condition.compValue.slice(2), 'hex')
      const shift = compValue.readUInt16BE(0)
      if (shift >= bytes.length) return false

      const mask = compValue.subarray(2, 17)
      const value = compValue.subarray(17, 32)
      return mask.every(
        (byte, i) => ((bytes[shift + i] ?? 0) & byte) === value[i]
      )
    }
    default:
      throw new Error(`No evaluation for operator ${condition.operator}`)
  }
}

/** The condition on CoreWriter's `data` parameter. */
const payloadCondition = (permissions: PresetPermission[]) =>
  find(permissions, CORE_WRITER, SELECTORS.sendRawAction)?.condition.children[0]

const calls = (permissions: PresetPermission[]) =>
  permissions.map(({ targetAddress, selector }) => [targetAddress, selector])

const find = (
  permissions: PresetPermission[],
  target: string,
  selector: string
) =>
  permissions.find((p) => p.targetAddress === target && p.selector === selector)

const operators = (permission: PresetPermission | undefined) =>
  permission?.condition.children.map((c: any) => c.operator)

const allOperators = (condition: any): number[] =>
  condition == null
    ? []
    : [condition.operator, ...(condition.children ?? []).flatMap(allOperators)]

const tradingKeys = async () =>
  (await hyperliquid.tradingKeys({ chain: 999 }))
    .permissions as PresetPermission[]

const funds = async () =>
  (await hyperliquid.funds({ chain: 999 })).permissions as PresetPermission[]

const builderFee = async (maxFeeRate: `${number}%` = '0.05%') =>
  (await hyperliquid.builderFee({ chain: 999, builder: BUILDER, maxFeeRate }))
    .permissions as PresetPermission[]

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

describe('hyperliquid.tradingKeys', () => {
  it('only calls CoreWriter', async () => {
    expect(calls(await tradingKeys())).toEqual([
      [CORE_WRITER, SELECTORS.sendRawAction],
    ])
  })

  it('pins the version byte and action 9, leaving the key and name open', async () => {
    const condition = payloadCondition(await tradingKeys())

    expect(condition).toMatchObject({
      operator: BITMASK,
      compValue: `0x0000ffffffff${'00'.repeat(11)}01000009${'00'.repeat(11)}`,
    })
  })

  it('lets keys be added, named, replaced and removed', async () => {
    const condition = payloadCondition(await tradingKeys())

    for (const payload of [
      addApiWallet(KEY, ''),
      addApiWallet(KEY, 'desk valid_until 1800000000000'),
      addApiWallet(STRANGER, 'desk'),
      addApiWallet(ZERO, ''),
    ]) {
      expect(passes(condition, payload)).toBe(true)
    }
  })

  it('refuses every other action', async () => {
    const condition = payloadCondition(await tradingKeys())

    for (const payload of [
      usdClassTransfer(1_000_000n, false),
      toEvm(1_000_000n),
      approveBuilderFee(50n, BUILDER),
      limitOrder,
      vaultTransfer,
      spotSend(STRANGER),
      action(9, ['address', 'string'], [KEY, ''], 2),
      '0x',
    ]) {
      expect(passes(condition, payload)).toBe(false)
    }
  })
})

describe('hyperliquid.funds', () => {
  it('approves USDC, deposits into HyperCore and calls CoreWriter', async () => {
    expect(calls(await funds())).toEqual([
      [usdc, SELECTORS.approve],
      [wallet, SELECTORS.depositFor],
      [wallet, SELECTORS.deposit],
      [CORE_WRITER, SELECTORS.sendRawAction],
    ])
  })

  it("lets USDC be approved to Circle's CoreDepositWallet only", async () => {
    const approve = find(await funds(), usdc, SELECTORS.approve)

    expect(approve?.condition.children[0]).toMatchObject({
      operator: EQUAL_TO,
      compValue: `0x${wallet.slice(2).padStart(64, '0')}`,
    })
  })

  it('deposits for the avatar only, into its perp or spot balance', async () => {
    const permissions = await funds()
    const depositFor = find(permissions, wallet, SELECTORS.depositFor)
    const deposit = find(permissions, wallet, SELECTORS.deposit)

    expect(operators(depositFor)).toEqual([EQUAL_TO_AVATAR, PASS, OR])
    expect(operators(deposit)).toEqual([PASS, OR])
    for (const permission of [depositFor, deposit]) {
      const dex = permission?.condition.children.at(-1)
      expect(
        dex.children.map((c: any) => [c.operator, BigInt(c.compValue)])
      ).toEqual([
        [EQUAL_TO, BigInt(PERP)],
        [EQUAL_TO, BigInt(SPOT)],
      ])
    }
  })

  it('moves USDC between spot and perp, either way, any amount', async () => {
    const condition = payloadCondition(await funds())

    expect(passes(condition, usdClassTransfer(1n, true))).toBe(true)
    expect(passes(condition, usdClassTransfer(10n ** 12n, false))).toBe(true)
  })

  it("withdraws USDC from spot to the avatar's HyperEVM balance, any amount", async () => {
    const condition = payloadCondition(await funds())

    expect(passes(condition, toEvm(1n))).toBe(true)
    expect(passes(condition, toEvm(123_456_789n))).toBe(true)
    expect(passes(condition, toEvm(2n ** 64n - 1n))).toBe(true)
  })

  it('refuses sendAsset anywhere else, or of anything else', async () => {
    const condition = payloadCondition(await funds())

    for (const payload of [
      sendAsset(STRANGER, ZERO, SPOT, SPOT, 0n, 1_000_000n),
      sendAsset(USDC_SYSTEM_ADDRESS, STRANGER, SPOT, SPOT, 0n, 1_000_000n),
      sendAsset(USDC_SYSTEM_ADDRESS, ZERO, PERP, SPOT, 0n, 1_000_000n),
      sendAsset(USDC_SYSTEM_ADDRESS, ZERO, SPOT, PERP, 0n, 1_000_000n),
      sendAsset(USDC_SYSTEM_ADDRESS, ZERO, SPOT, SPOT, 1n, 1_000_000n),
      // Another token's system address
      sendAsset(
        '0x2000000000000000000000000000000000000001',
        ZERO,
        SPOT,
        SPOT,
        0n,
        1_000_000n
      ),
    ]) {
      expect(passes(condition, payload)).toBe(false)
    }
  })

  it('refuses every action that is not a move or a withdrawal', async () => {
    const condition = payloadCondition(await funds())

    for (const payload of [
      addApiWallet(KEY, ''),
      approveBuilderFee(50n, BUILDER),
      limitOrder,
      vaultTransfer,
      spotSend(USDC_SYSTEM_ADDRESS),
      spotSend(STRANGER),
      action(7, ['uint64', 'bool'], [1_000_000n, false], 2),
      // A sendAsset cut short after its header
      `0x0100000d${'00'.repeat(64)}`,
      '0x',
    ]) {
      expect(passes(condition, payload)).toBe(false)
    }
  })
})

describe('hyperliquid.builderFee', () => {
  it('only calls CoreWriter', async () => {
    expect(calls(await builderFee())).toEqual([
      [CORE_WRITER, SELECTORS.sendRawAction],
    ])
  })

  it('approves the given builder at the given rate', async () => {
    const condition = payloadCondition(await builderFee('0.05%'))

    expect(passes(condition, approveBuilderFee(50n, BUILDER))).toBe(true)
    expect(
      passes(condition, approveBuilderFee(50n, BUILDER.toLowerCase()))
    ).toBe(true)
  })

  it('reads the rate in tenths of a basis point', async () => {
    expect(
      passes(
        payloadCondition(await builderFee('0.001%')),
        approveBuilderFee(1n, BUILDER)
      )
    ).toBe(true)
    expect(
      passes(
        payloadCondition(await builderFee('1%')),
        approveBuilderFee(1000n, BUILDER)
      )
    ).toBe(true)
  })

  it('refuses another builder, another rate and other actions', async () => {
    const condition = payloadCondition(await builderFee('0.05%'))

    for (const payload of [
      approveBuilderFee(50n, STRANGER),
      approveBuilderFee(51n, BUILDER),
      approveBuilderFee(100n, BUILDER),
      approveBuilderFee(49n, BUILDER),
      addApiWallet(KEY, ''),
      toEvm(1_000_000n),
    ]) {
      expect(passes(condition, payload)).toBe(false)
    }
  })

  it('throws for rates Hyperliquid would not take', async () => {
    for (const rate of [
      '0%',
      '1.001%',
      '2%',
      '0.0005%',
      '5',
      'abc%',
    ] as const) {
      await expect(builderFee(rate as `${number}%`)).rejects.toThrow()
    }
  })

  it('throws without a builder', async () => {
    await expect(
      hyperliquid.builderFee({ chain: 999, builder: ZERO, maxFeeRate: '0.05%' })
    ).rejects.toThrow('Pass the address of the builder.')
  })
})

describe('all presets in one role', () => {
  const permissions = async () =>
    [
      ...(await tradingKeys()),
      ...(await funds()),
      ...(await builderFee()),
    ] as unknown as Permission[]

  it('merge into one condition on CoreWriter that still refuses other actions', async () => {
    const { targets } = processPermissions(await permissions())
    const coreWriter = targets.find((t) => t.address === CORE_WRITER)
    const [fn] = coreWriter!.functions
    const condition = fn!.condition!.children![0]

    for (const payload of [
      addApiWallet(KEY, ''),
      usdClassTransfer(1_000_000n, true),
      toEvm(1_000_000n),
      approveBuilderFee(50n, BUILDER),
    ]) {
      expect(passes(condition, payload)).toBe(true)
    }
    for (const payload of [
      sendAsset(STRANGER, ZERO, SPOT, SPOT, 0n, 1_000_000n),
      approveBuilderFee(50n, STRANGER),
      spotSend(STRANGER),
      vaultTransfer,
      limitOrder,
    ]) {
      expect(passes(condition, payload)).toBe(false)
    }
  })

  it('use Bitmask, never Calldata or ArraySome, and send no value or delegatecalls', async () => {
    const all = (await permissions()) as unknown as PresetPermission[]
    const operatorsUsed = new Set(all.flatMap((p) => allOperators(p.condition)))

    expect(operatorsUsed.has(ARRAY_SOME)).toBe(false)
    expect(
      allOperators(payloadCondition(all)).every((op) =>
        [AND, OR, BITMASK].includes(op)
      )
    ).toBe(true)
    expect(all.every((p) => !p.send && !p.delegatecall)).toBe(true)
  })
})

describe('labels', () => {
  it('keeps a label it is given', async () => {
    const entry = await hyperliquid.funds({
      label: 'Fund the desk',
      chain: 999,
    })

    expect(entry.label).toBe('Fund the desk')
  })

  it('names what each preset does', async () => {
    expect((await hyperliquid.tradingKeys({ chain: 999 })).label).toBe(
      'Add and remove Hyperliquid trading keys'
    )
    expect((await hyperliquid.funds({ chain: 999 })).label).toBe(
      'Deposit, move and withdraw USDC on Hyperliquid'
    )
  })

  it('names the builder and the rate', async () => {
    const entry = await hyperliquid.builderFee({
      chain: 999,
      builder: BUILDER.toLowerCase() as `0x${string}`,
      maxFeeRate: '0.05%',
    })

    expect(entry.label).toBe(
      `Approve builder fees of up to 0.05% for ${BUILDER} on Hyperliquid`
    )
  })
})

describe('chains', () => {
  it('only lists chains Zodiac supports', () => {
    const zodiacChains = new Set<number>(Object.values(CHAIN_IDS))

    for (const chain of Object.keys(HYPERLIQUID)) {
      expect(zodiacChains.has(Number(chain))).toBe(true)
    }
  })

  it('throws for a chain without Hyperliquid', async () => {
    await expect(
      hyperliquid.funds({ chain: 1 as unknown as 999 })
    ).rejects.toThrow('Hyperliquid is not on chain 1.')
  })
})
