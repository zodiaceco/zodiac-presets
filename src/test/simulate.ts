import {
  encodeKey,
  flattenCondition,
  processPermissions,
  rolesAbi,
  Status,
  type Permission,
} from 'zodiac-roles-sdk'
import {
  AbiCoder,
  getAddress,
  Interface,
  JsonRpcProvider,
  keccak256,
  toBeHex,
  toQuantity,
  zeroPadValue,
} from 'ethers'
import type { Address } from '../kit'

// Runs presets against real chain state without sending anything: one
// eth_simulateV1 block that
//   1. puts the deployed Roles v2.1.1 mastercopy code and a Safe 1.4.1 at
//      fresh addresses (state overrides),
//   2. sets the Roles mod up, scopes each role with its presets' permissions
//      (the contract's own integrity check runs here) and sets the allowances,
//   3. sends every case through execTransactionWithRole against the real
//      protocol contracts.
// Opt in with SIMULATE=1 (`bun test:sim`); the RPC must support eth_simulateV1.

const ROLES_V2_1_1 = '0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5'
const SAFE_1_4_1 = '0x41675C099F32341bf84BFc5382aF534df5C7461a'

const address = (tag: string) =>
  getAddress(`0x${tag.padStart(40, '0')}`) as Address

/** The Safe the simulated Roles mod acts for. */
export const AVATAR = address('5afe000001')
/** Someone the presets must never pay or give anything to. */
export const STRANGER = address('bad0000001')

const ROLES = address('d371ae0001')
const OWNER = address('a0a0e10001')
const member = (role: string) =>
  address(keccak256(new TextEncoder().encode(role)).slice(2, 12))

export const simulationEnabled = process.env.SIMULATE === '1'

export type Allowance = {
  key: string
  balance: bigint
  maxRefill?: bigint
  refill?: bigint
  period?: bigint
}

export type Case = {
  label: string
  role: string
  to: Address
  data: string
  value?: bigint
  allowed: boolean
}

export type CaseResult = Case & { passed: boolean; detail: string }

type Preset = { permissions: unknown }

export const simulate = async ({
  rpc,
  roles,
  allowances = [],
  cases,
  stateOverrides = {},
}: {
  rpc: string
  /** Presets per role key. */
  roles: Record<string, readonly Preset[]>
  allowances?: readonly Allowance[]
  cases: readonly Case[]
  /** Extra state, e.g. token balances for `AVATAR`. */
  stateOverrides?: Record<string, unknown>
}) => {
  const provider = new JsonRpcProvider(rpc)
  const abi = AbiCoder.defaultAbiCoder()
  const iface = new Interface(rolesAbi)
  const block = await provider.getBlock('latest')
  if (!block) throw new Error('No block from the RPC')
  const [rolesCode, safeCode] = await Promise.all([
    provider.getCode(ROLES_V2_1_1),
    provider.getCode(SAFE_1_4_1),
  ])

  const setup: { label: string; data: string }[] = [
    {
      label: 'setUp',
      data: iface.encodeFunctionData('setUp', [
        abi.encode(['address', 'address', 'address'], [OWNER, AVATAR, AVATAR]),
      ]),
    },
  ]

  for (const [role, presets] of Object.entries(roles)) {
    const roleKey = encodeKey(role)
    setup.push({
      label: `assign ${role}`,
      data: iface.encodeFunctionData('assignRoles', [
        member(role),
        [roleKey],
        [true],
      ]),
    })
    const permissions = presets.flatMap(
      (preset) => preset.permissions as Permission[]
    )
    for (const target of processPermissions(permissions).targets) {
      setup.push({
        label: `${role}: scope ${target.address}`,
        data: iface.encodeFunctionData('scopeTarget', [
          roleKey,
          target.address,
        ]),
      })
      for (const fn of target.functions) {
        if (fn.wildcarded || !fn.condition) {
          setup.push({
            label: `${role}: allow ${target.address} ${fn.selector}`,
            data: iface.encodeFunctionData('allowFunction', [
              roleKey,
              target.address,
              fn.selector,
              fn.executionOptions,
            ]),
          })
          continue
        }
        const conditions = flattenCondition(fn.condition).map((node) => ({
          parent: node.parent,
          paramType: node.paramType,
          operator: node.operator,
          compValue: node.compValue ?? '0x',
        }))
        setup.push({
          label: `${role}: scope ${target.address} ${fn.selector}`,
          data: iface.encodeFunctionData('scopeFunction', [
            roleKey,
            target.address,
            fn.selector,
            conditions,
            fn.executionOptions,
          ]),
        })
      }
    }
  }

  for (const allowance of allowances) {
    const refill = allowance.refill ?? allowance.balance
    setup.push({
      label: `allowance ${allowance.key}`,
      data: iface.encodeFunctionData('setAllowance', [
        encodeKey(allowance.key),
        allowance.balance,
        allowance.maxRefill ?? refill,
        refill,
        allowance.period ?? 0n,
        BigInt(block.timestamp),
      ]),
    })
  }

  const slot = (key: string, index: number) =>
    keccak256(abi.encode(['address', 'uint256'], [key, index]))
  const word = (value: bigint | string) => zeroPadValue(toBeHex(value), 32)
  const overrides = {
    ...stateOverrides,
    [ROLES]: { code: rolesCode },
    [AVATAR]: {
      code: safeCode,
      balance: toQuantity(10n ** 18n),
      stateDiff: {
        [slot(address('1'), 1)]: word(ROLES), // modules[SENTINEL] = Roles
        [slot(ROLES, 1)]: word(address('1')), // modules[Roles] = SENTINEL
        [toBeHex(4, 32)]: word(1n), // threshold
      },
    },
  }

  const calls = [
    ...setup.map(({ data }) => ({ from: OWNER, to: ROLES, data })),
    ...cases.map(({ role, to, value = 0n, data }) => ({
      from: member(role),
      to: ROLES,
      data: iface.encodeFunctionData('execTransactionWithRole', [
        to,
        value,
        data,
        0,
        encodeKey(role),
        true,
      ]),
    })),
  ].map((call) => ({ ...call, gas: toQuantity(8_000_000) }))

  const [simulated] = await provider.send('eth_simulateV1', [
    {
      blockStateCalls: [{ stateOverrides: overrides, calls }],
      validation: false,
    },
    'latest',
  ])
  const results: {
    status: string
    returnData: string
    error?: { data?: string }
  }[] = simulated.calls

  const reason = (data?: string) => {
    if (!data) return 'reverted'
    try {
      const error = iface.parseError(data)
      if (!error) return data.slice(0, 10)
      return error.name === 'ConditionViolation'
        ? `ConditionViolation(${Status[Number(error.args[0])]})`
        : error.name
    } catch {
      return data.slice(0, 10)
    }
  }

  const failedSetup = setup
    .map((step, i) => ({ ...step, result: results[i]! }))
    .filter(({ result }) => result.status !== '0x1')
    .map(
      ({ label, result }) =>
        `${label}: ${reason(result.error?.data ?? result.returnData)}`
    )

  const caseResults: CaseResult[] = cases.map((testCase, i) => {
    const result = results[setup.length + i]!
    const allowed = result.status === '0x1'
    return {
      ...testCase,
      passed: allowed === testCase.allowed,
      detail: allowed
        ? 'executed'
        : reason(result.error?.data ?? result.returnData),
    }
  })

  return { block: block.number, failedSetup, cases: caseResults }
}
