import { describe, expect, it } from 'bun:test'
import { AbiCoder, Interface, keccak256, toBeHex, zeroPadValue } from 'ethers'
import { CORE_WRITER, HYPERLIQUID, hyperliquid } from '.'
import type { Address } from '../kit'
import {
  AVATAR,
  simulateByCall,
  simulationEnabled,
  STRANGER,
  type Case,
} from '../test/simulateByCall'

// The Hyperliquid presets against HyperEVM state: trading keys, deposits,
// moves, withdrawals and the builder fee go through the Roles mod and execute
// against USDC, the CoreDepositWallet and CoreWriter; everything that would
// hand funds to another account, and every other action, stops at the Roles
// mod. HyperCore processes CoreWriter actions after the block, so this checks
// the HyperEVM side only. Run with `bun test:sim`.

const RPC = process.env.RPC_999 ?? 'https://rpc.hyperliquid.xyz/evm'
const { usdc: USDC, coreDepositWallet: WALLET } = HYPERLIQUID[999]
const KEY = '0x00000000000000000000000000000000000a6e47'
const BUILDER = '0x0000000000000000000000000000000000b0170e'
const USDC_SYSTEM_ADDRESS = '0x2000000000000000000000000000000000000000'
const ZERO = '0x0000000000000000000000000000000000000000'
const PERP = 0
const SPOT = 0xffffffff
const TEN_USDC = 10n * 10n ** 6n

const abi = AbiCoder.defaultAbiCoder()
const erc20 = new Interface([
  'function approve(address,uint256)',
  'function transfer(address,uint256)',
])
const wallet = new Interface([
  'function deposit(uint256 amount, uint32 destinationDex)',
  'function depositFor(address recipient, uint256 amount, uint32 destinationDex)',
])
const coreWriter = new Interface(['function sendRawAction(bytes data)'])

const raw = (payload: string) =>
  coreWriter.encodeFunctionData('sendRawAction', [payload])
const action = (id: number, types: string[], values: unknown[], version = 1) =>
  raw(
    `0x${version.toString(16).padStart(2, '0')}${id.toString(16).padStart(6, '0')}${abi.encode(types, values).slice(2)}`
  )

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
  [STRANGER, true, TEN_USDC]
)
const spotSend = (destination: string) =>
  action(6, ['address', 'uint64', 'uint64'], [destination, 0n, 100_000_000n])

const approve = (spender: string) =>
  erc20.encodeFunctionData('approve', [spender, 100n * TEN_USDC])
const depositFor = (recipient: string, dex: number) =>
  wallet.encodeFunctionData('depositFor', [recipient, TEN_USDC, dex])
const deposit = (dex: number) =>
  wallet.encodeFunctionData('deposit', [TEN_USDC, dex])

const usdcBalance = (holder: string) =>
  keccak256(abi.encode(['address', 'uint256'], [holder, 9])) // FiatToken v2.2

type Call = { to: Address; data: string; operation?: 0 | 1 }
const onCoreWriter = (data: string): Call => ({ to: CORE_WRITER, data })
const onUsdc = (data: string): Call => ({ to: USDC, data })
const onWallet = (data: string): Call => ({ to: WALLET, data })

const allow = (role: string, label: string, call: Call): Case => ({
  label,
  role,
  ...call,
  allowed: true,
})
const block = (role: string, label: string, call: Call): Case => ({
  label,
  role,
  ...call,
  allowed: false,
})

describe.skipIf(!simulationEnabled)('hyperliquid presets on HyperEVM', () => {
  it(
    'allow trading keys and USDC within the account, block everything else',
    async () => {
      const builderFee = hyperliquid.builderFee({
        chain: 999,
        builder: BUILDER,
        maxFeeRate: '0.05%',
      })
      const {
        block: blockNumber,
        failedSetup,
        cases,
      } = await simulateByCall({
        rpc: RPC,
        roles: {
          hl_keys: [await hyperliquid.tradingKeys({ chain: 999 })],
          hl_funds: [await hyperliquid.funds({ chain: 999 })],
          hl_builder: [await builderFee],
          hl_all: [
            await hyperliquid.tradingKeys({ chain: 999 }),
            await hyperliquid.funds({ chain: 999 }),
            await builderFee,
          ],
        },
        stateOverrides: {
          [USDC]: {
            stateDiff: {
              [usdcBalance(AVATAR)]: zeroPadValue(toBeHex(100n * TEN_USDC), 32),
            },
          },
        },
        cases: [
          // Trading keys
          allow(
            'hl_keys',
            'add the unnamed key',
            onCoreWriter(addApiWallet(KEY, ''))
          ),
          allow(
            'hl_keys',
            'add a named key with expiry',
            onCoreWriter(addApiWallet(KEY, 'desk valid_until 1800000000000'))
          ),
          allow(
            'hl_keys',
            'remove the unnamed key',
            onCoreWriter(addApiWallet(ZERO, ''))
          ),
          block(
            'hl_keys',
            'usdClassTransfer',
            onCoreWriter(usdClassTransfer(TEN_USDC, false))
          ),
          block(
            'hl_keys',
            'sendAsset to HyperEVM',
            onCoreWriter(toEvm(TEN_USDC))
          ),
          block('hl_keys', 'limit order (action 1)', onCoreWriter(limitOrder)),
          block(
            'hl_keys',
            'spotSend to a stranger',
            onCoreWriter(spotSend(STRANGER))
          ),
          block('hl_keys', 'approve USDC', onUsdc(approve(WALLET))),
          block('hl_keys', 'add a key by delegatecall', {
            ...onCoreWriter(addApiWallet(KEY, '')),
            operation: 1,
          }),

          // Funds
          allow(
            'hl_funds',
            'approve USDC to the CoreDepositWallet',
            onUsdc(approve(WALLET))
          ),
          allow(
            'hl_funds',
            'depositFor(avatar, perp)',
            onWallet(depositFor(AVATAR, PERP))
          ),
          allow(
            'hl_funds',
            'depositFor(avatar, spot)',
            onWallet(depositFor(AVATAR, SPOT))
          ),
          allow('hl_funds', 'deposit(perp)', onWallet(deposit(PERP))),
          allow('hl_funds', 'deposit(spot)', onWallet(deposit(SPOT))),
          allow(
            'hl_funds',
            'usdClassTransfer to spot',
            onCoreWriter(usdClassTransfer(TEN_USDC, false))
          ),
          allow(
            'hl_funds',
            'usdClassTransfer to perp',
            onCoreWriter(usdClassTransfer(TEN_USDC, true))
          ),
          allow(
            'hl_funds',
            'sendAsset spot to HyperEVM',
            onCoreWriter(toEvm(123_456_789n))
          ),
          block(
            'hl_funds',
            'approve USDC to a stranger',
            onUsdc(approve(STRANGER))
          ),
          block(
            'hl_funds',
            'transfer USDC to a stranger',
            onUsdc(erc20.encodeFunctionData('transfer', [STRANGER, TEN_USDC]))
          ),
          block(
            'hl_funds',
            'depositFor(stranger)',
            onWallet(depositFor(STRANGER, PERP))
          ),
          block(
            'hl_funds',
            'depositFor(avatar, dex 1)',
            onWallet(depositFor(AVATAR, 1))
          ),
          block('hl_funds', 'deposit(dex 1)', onWallet(deposit(1))),
          block(
            'hl_funds',
            'sendAsset to a stranger',
            onCoreWriter(sendAsset(STRANGER, ZERO, SPOT, SPOT, 0n, TEN_USDC))
          ),
          block(
            'hl_funds',
            'sendAsset from a sub-account',
            onCoreWriter(
              sendAsset(USDC_SYSTEM_ADDRESS, STRANGER, SPOT, SPOT, 0n, TEN_USDC)
            )
          ),
          block(
            'hl_funds',
            'sendAsset from perp',
            onCoreWriter(
              sendAsset(USDC_SYSTEM_ADDRESS, ZERO, PERP, SPOT, 0n, TEN_USDC)
            )
          ),
          block(
            'hl_funds',
            'sendAsset to perp',
            onCoreWriter(
              sendAsset(USDC_SYSTEM_ADDRESS, ZERO, SPOT, PERP, 0n, TEN_USDC)
            )
          ),
          block(
            'hl_funds',
            'sendAsset of token 1',
            onCoreWriter(
              sendAsset(USDC_SYSTEM_ADDRESS, ZERO, SPOT, SPOT, 1n, TEN_USDC)
            )
          ),
          block(
            'hl_funds',
            'sendAsset cut short',
            onCoreWriter(raw(`0x0100000d${'00'.repeat(64)}`))
          ),
          block(
            'hl_funds',
            'usdClassTransfer, version 2',
            onCoreWriter(action(7, ['uint64', 'bool'], [TEN_USDC, false], 2))
          ),
          block('hl_funds', 'usdClassTransfer by delegatecall', {
            ...onCoreWriter(usdClassTransfer(TEN_USDC, false)),
            operation: 1,
          }),
          block(
            'hl_funds',
            'spotSend to the system address',
            onCoreWriter(spotSend(USDC_SYSTEM_ADDRESS))
          ),
          block(
            'hl_funds',
            'spotSend to a stranger',
            onCoreWriter(spotSend(STRANGER))
          ),
          block(
            'hl_funds',
            'vaultTransfer (action 2)',
            onCoreWriter(vaultTransfer)
          ),
          block('hl_funds', 'add a key', onCoreWriter(addApiWallet(KEY, ''))),
          block(
            'hl_funds',
            'approve a builder fee',
            onCoreWriter(approveBuilderFee(50n, BUILDER))
          ),
          block('hl_funds', 'limit order (action 1)', onCoreWriter(limitOrder)),

          // Builder fee
          allow(
            'hl_builder',
            'approve 0.05% for the builder',
            onCoreWriter(approveBuilderFee(50n, BUILDER))
          ),
          block(
            'hl_builder',
            'approve 0.051% for the builder',
            onCoreWriter(approveBuilderFee(51n, BUILDER))
          ),
          block(
            'hl_builder',
            'approve 0.05% for a stranger',
            onCoreWriter(approveBuilderFee(50n, STRANGER))
          ),
          block('hl_builder', 'add a key', onCoreWriter(addApiWallet(KEY, ''))),

          // All three in one role: one Or over CoreWriter
          allow('hl_all', 'add a key', onCoreWriter(addApiWallet(KEY, 'desk'))),
          allow(
            'hl_all',
            'usdClassTransfer',
            onCoreWriter(usdClassTransfer(TEN_USDC, true))
          ),
          allow(
            'hl_all',
            'sendAsset spot to HyperEVM',
            onCoreWriter(toEvm(TEN_USDC))
          ),
          allow(
            'hl_all',
            'approve the builder fee',
            onCoreWriter(approveBuilderFee(50n, BUILDER))
          ),
          block(
            'hl_all',
            'sendAsset to a stranger',
            onCoreWriter(sendAsset(STRANGER, ZERO, SPOT, SPOT, 0n, TEN_USDC))
          ),
          block(
            'hl_all',
            'approve a fee for a stranger',
            onCoreWriter(approveBuilderFee(50n, STRANGER))
          ),
          block(
            'hl_all',
            'spotSend to a stranger',
            onCoreWriter(spotSend(STRANGER))
          ),
          block(
            'hl_all',
            'vaultTransfer (action 2)',
            onCoreWriter(vaultTransfer)
          ),
          block(
            'hl_all',
            'action 99',
            onCoreWriter(
              action(99, ['address', 'uint64'], [STRANGER, TEN_USDC])
            )
          ),

          // Nobody holds this role
          block('hl_nobody', 'add a key', onCoreWriter(addApiWallet(KEY, ''))),
        ],
      })

      console.log(`HyperEVM block ${blockNumber}`)
      for (const c of cases) {
        console.log(
          `${c.passed ? 'ok  ' : 'FAIL'} ${c.allowed ? 'allowed' : 'blocked'}  ${c.role.padEnd(10)} ${c.label.padEnd(40)} ${c.detail}`
        )
      }
      expect(failedSetup).toEqual([])
      expect(cases.filter((c) => !c.passed)).toEqual([])
    },
    { timeout: 120_000 }
  )
})
