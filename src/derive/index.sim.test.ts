import { describe, expect, it } from 'bun:test'
import {
  AbiCoder,
  Interface,
  keccak256,
  parseEther,
  toBeHex,
  zeroPadValue,
} from 'ethers'
import { derive, DERIVE, DERIVE_ASSETS, DERIVE_SCOPES } from '.'
import { AVATAR, simulate, simulationEnabled, STRANGER } from '../test/simulate'

// The Derive presets against Ethereum mainnet state: deposits, a session key,
// a withdrawal and a revoke go through and reach Derive's queue; everything
// that would hand funds or rights to someone else stops at the Roles mod.
// Run with `bun test:sim`.

const RPC = process.env.RPC_1 ?? 'https://ethereum-rpc.publicnode.com'
const ACTION_MANAGER = DERIVE[1]
const { USDC, ETH } = DERIVE_ASSETS[1]
const OWN = [900001n, 900002n] as const
const KEY = '0x0000000000000000000000000000005e55100001'
const OTHER_KEY = '0x0000000000000000000000000000005e55100002'
// A key the Derive app made in the browser
const BROWSER_KEY = '0x0000000000000000000000000000005e55100003'
const MILLION_USDC = 1_000_000n * 10n ** 6n

const am = new Interface([
  'function deposit(address,uint256,uint64,address)',
  'function depositToNewSubaccount(address,uint256,uint32,address)',
  'function submit(uint64,bytes)',
  'function withdraw((uint64,address,uint128,address,uint128,bool)) payable',
])
const erc20 = new Interface(['function approve(address,uint256)'])
const abi = AbiCoder.defaultAbiCoder()
const keyData = (
  key: string,
  expiry: bigint,
  scopes: readonly number[],
  subaccounts: readonly bigint[]
) =>
  abi.encode(
    ['address', 'uint256', 'uint256[]', 'uint256[]'],
    [key, expiry, scopes, subaccounts]
  )
const setKey = (...args: Parameters<typeof keyData>) =>
  am.encodeFunctionData('submit', [51, keyData(...args)])
const withdrawTo = (recipient: string, subaccount: bigint = OWN[0], fee = 0n) =>
  am.encodeFunctionData('withdraw', [
    [subaccount, USDC.label, fee, recipient, 5_000n * 10n ** 6n, false],
  ])

const balanceSlot = (holder: string, index: number) =>
  keccak256(abi.encode(['address', 'uint256'], [holder, index]))
const word = (value: bigint) => zeroPadValue(toBeHex(value), 32)

const ONE_WEEK = 7n * 24n * 60n * 60n
const EXPIRY = BigInt(Date.UTC(2027, 0, 1) / 1000) - 1n

describe.skipIf(!simulationEnabled)('derive presets on mainnet state', () => {
  it(
    'allow the account flows and block everything else',
    async () => {
      const { block, failedSetup, cases } = await simulate({
        rpc: RPC,
        roles: {
          derive_treasury: [
            derive.deposit({
              chain: 1,
              tokens: [
                {
                  asset: 'USDC',
                  minimum: 10n * 10n ** 6n,
                  allowance: 'derive_usdc',
                },
                { asset: 'ETH', minimum: 43n * 10n ** 14n },
              ],
              newSubaccounts: { managers: [1, 5] },
              subaccounts: OWN,
            }),
            derive.withdraw({
              chain: 1,
              assets: ['USDC', 'ETH'],
              subaccounts: OWN,
              maxFeeUsd: 50,
            }),
          ],
          derive_desk: [
            derive.sessionKeys({
              chain: 1,
              keys: [KEY],
              scopes: DERIVE_SCOPES.optionsDesk,
              subaccounts: OWN,
              expiresBefore: new Date('2027-01-01T00:00:00Z'),
            }),
          ],
          derive_single: [
            derive.sessionKeys({
              chain: 1,
              keys: [KEY],
              scopes: DERIVE_SCOPES.fullDesk,
              subaccounts: [OWN[0]],
              expiresBefore: new Date('2027-01-01T00:00:00Z'),
            }),
          ],
          derive_topups: [
            derive.deposit({
              chain: 1,
              tokens: [{ asset: 'USDC', minimum: 10n * 10n ** 6n }],
              subaccounts: OWN,
            }),
          ],
          // Once per subaccount, so no key spans both or transfers
          derive_separate: OWN.map((subaccount) =>
            derive.sessionKeys({
              chain: 1,
              keys: [KEY],
              scopes: DERIVE_SCOPES.optionsDesk,
              subaccounts: [subaccount],
            })
          ),
          derive_app: [
            derive.sessionKeys({
              chain: 1,
              scopes: DERIVE_SCOPES.app,
              subaccounts: OWN,
            }),
          ],
          derive_guardian: [derive.revokeSessionKeys({ chain: 1 })],
        },
        allowances: [
          { key: 'derive_usdc', balance: MILLION_USDC, period: ONE_WEEK },
        ],
        stateOverrides: {
          // FiatTokenV2_2 balances (slot 9) and WETH9 balanceOf (slot 3)
          [USDC.token]: {
            stateDiff: { [balanceSlot(AVATAR, 9)]: word(5n * MILLION_USDC) },
          },
          [ETH.token]: {
            stateDiff: { [balanceSlot(AVATAR, 3)]: word(parseEther('10')) },
          },
        },
        cases: [
          {
            label: 'approve USDC',
            role: 'derive_treasury',
            to: USDC.token,
            data: erc20.encodeFunctionData('approve', [
              ACTION_MANAGER,
              MILLION_USDC,
            ]),
            allowed: true,
          },
          {
            label: 'first deposit, owner = avatar',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('depositToNewSubaccount', [
              USDC.label,
              250_000n * 10n ** 6n,
              5,
              AVATAR,
            ]),
            allowed: true,
          },
          {
            label: 'top-up into an own subaccount',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              100_000n * 10n ** 6n,
              OWN[0],
              AVATAR,
            ]),
            allowed: true,
          },
          {
            label: 'approve WETH',
            role: 'derive_treasury',
            to: ETH.token,
            data: erc20.encodeFunctionData('approve', [
              ACTION_MANAGER,
              parseEther('1'),
            ]),
            allowed: true,
          },
          {
            label: 'deposit WETH into an own subaccount',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              ETH.label,
              parseEther('1'),
              OWN[1],
              AVATAR,
            ]),
            allowed: true,
          },
          {
            label: 'withdraw to the avatar',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            value: parseEther('0.002'),
            data: withdrawTo(AVATAR),
            allowed: true,
          },
          {
            label: 'register an options-desk key',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, DERIVE_SCOPES.optionsDesk, [OWN[0]]),
            allowed: true,
          },
          {
            label: 'register a key for both subaccounts',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10], [...OWN]),
            allowed: true,
          },
          {
            // What Pilot turns the app's admin key into
            label: 'register the app’s key, restricted by Pilot',
            role: 'derive_app',
            to: ACTION_MANAGER,
            data: setKey(
              BROWSER_KEY,
              BigInt(Math.floor(Date.now() / 1000)) + 30n * 24n * 60n * 60n,
              [...DERIVE_SCOPES.app, 12],
              [...OWN]
            ),
            allowed: true,
          },
          {
            label: 'register a key for both subaccounts, with transfers',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [6, 10, 12], [...OWN]),
            allowed: true,
          },
          {
            label: 'register a key, single listed subaccount',
            role: 'derive_single',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [4, 5, 6, 8, 9, 10], [OWN[0]]),
            allowed: true,
          },
          {
            label: 'register a single-subaccount key, with transfers',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [6, 12], [OWN[1]]),
            allowed: true,
          },
          {
            label: 'register a key on either subaccount',
            role: 'derive_separate',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [6, 10], [OWN[1]]),
            allowed: true,
          },
          {
            label: 'top-up without new subaccounts',
            role: 'derive_topups',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              100n * 10n ** 6n,
              OWN[0],
              AVATAR,
            ]),
            allowed: true,
          },
          {
            label: 'revoke a key',
            role: 'derive_guardian',
            to: ACTION_MANAGER,
            data: setKey(OTHER_KEY, 0n, [], []),
            allowed: true,
          },

          {
            label: 'approve USDC to a stranger',
            role: 'derive_treasury',
            to: USDC.token,
            data: erc20.encodeFunctionData('approve', [STRANGER, 1n]),
            allowed: false,
          },
          {
            label: 'first deposit, owner = stranger',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('depositToNewSubaccount', [
              USDC.label,
              250_000n * 10n ** 6n,
              5,
              STRANGER,
            ]),
            allowed: false,
          },
          {
            label: 'first deposit, unlisted manager',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('depositToNewSubaccount', [
              USDC.label,
              250_000n * 10n ** 6n,
              3,
              AVATAR,
            ]),
            allowed: false,
          },
          {
            label: 'deposit into a foreign subaccount',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              100_000n * 10n ** 6n,
              123456n,
              AVATAR,
            ]),
            allowed: false,
          },
          {
            label: 'deposit with a stranger as fallback',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              100_000n * 10n ** 6n,
              OWN[0],
              STRANGER,
            ]),
            allowed: false,
          },
          {
            label: 'deposit below the minimum',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              5n * 10n ** 6n,
              OWN[0],
              AVATAR,
            ]),
            allowed: false,
          },
          {
            label: 'deposit beyond the weekly allowance',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              700_000n * 10n ** 6n,
              OWN[0],
              AVATAR,
            ]),
            allowed: false,
          },
          {
            label: 'withdraw to a stranger',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            value: parseEther('0.002'),
            data: withdrawTo(STRANGER),
            allowed: false,
          },
          {
            label: 'withdraw from a foreign subaccount',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            value: parseEther('0.002'),
            data: withdrawTo(AVATAR, 123456n),
            allowed: false,
          },
          {
            label: 'withdraw with a fee cap above 50 USD',
            role: 'derive_treasury',
            to: ACTION_MANAGER,
            value: parseEther('0.002'),
            data: withdrawTo(AVATAR, OWN[0], 51n * 10n ** 18n),
            allowed: false,
          },
          {
            label: 'key with the admin scope',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [0], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'key that transfers to other owners',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10, 14], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'key for every subaccount (empty list)',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10], []),
            allowed: false,
          },
          {
            label: 'key for a foreign subaccount',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10], [123456n]),
            allowed: false,
          },
          {
            label: 'key for more subaccounts than listed',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10], [...OWN, OWN[0]]),
            allowed: false,
          },
          {
            label: 'separate keys: one key for both',
            role: 'derive_separate',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [6, 10], [...OWN]),
            allowed: false,
          },
          {
            label: 'separate keys: a key that transfers',
            role: 'derive_separate',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [6, 12], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'the app’s admin key, unrestricted',
            role: 'derive_app',
            to: ACTION_MANAGER,
            data: setKey(BROWSER_KEY, EXPIRY, [0], []),
            allowed: false,
          },
          {
            label: 'app key that transfers to other owners',
            role: 'derive_app',
            to: ACTION_MANAGER,
            data: setKey(BROWSER_KEY, EXPIRY, [1, 2, 14], [...OWN]),
            allowed: false,
          },
          {
            label: 'transfer key, single listed subaccount',
            role: 'derive_single',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10, 12], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'transfer key for every subaccount (empty list)',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [12], []),
            allowed: false,
          },
          {
            label: 'transfer key with a foreign subaccount',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [12], [OWN[0], 123456n]),
            allowed: false,
          },
          {
            label: 'transfer key for more subaccounts than listed',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [12], [...OWN, OWN[0]]),
            allowed: false,
          },
          {
            label: 'transfer key creating subaccounts',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [12, 13], [...OWN]),
            allowed: false,
          },
          {
            label: 'new subaccount without new subaccounts',
            role: 'derive_topups',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('depositToNewSubaccount', [
              USDC.label,
              100n * 10n ** 6n,
              5,
              AVATAR,
            ]),
            allowed: false,
          },
          {
            label: 'unlisted key',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(OTHER_KEY, EXPIRY, [10], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'key past the expiry cap',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY + 2n, [10], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'other action type (52)',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('submit', [
              52,
              keyData(KEY, EXPIRY, [10], [OWN[0]]),
            ]),
            allowed: false,
          },
          {
            label: 'guardian registers a key',
            role: 'derive_guardian',
            to: ACTION_MANAGER,
            data: setKey(KEY, EXPIRY, [10], [OWN[0]]),
            allowed: false,
          },
          {
            label: 'desk deposits',
            role: 'derive_desk',
            to: ACTION_MANAGER,
            data: am.encodeFunctionData('deposit', [
              USDC.label,
              100_000n * 10n ** 6n,
              OWN[0],
              AVATAR,
            ]),
            allowed: false,
          },
        ],
      })

      console.log(`Ethereum block ${block}`)
      for (const c of cases) {
        console.log(
          `${c.passed ? 'ok  ' : 'FAIL'} ${c.allowed ? 'allowed' : 'blocked'}  ${c.role.padEnd(18)} ${c.label.padEnd(40)} ${c.detail}`
        )
      }
      expect(failedSetup).toEqual([])
      expect(cases.filter((c) => !c.passed)).toEqual([])
    },
    { timeout: 120_000 }
  )
})
