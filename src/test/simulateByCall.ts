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

// Runs presets against real chain state without sending anything, on RPCs
// that have no eth_simulateV1 but take state overrides on eth_call (HyperEVM's
// public RPC, for one). State overrides put the code of the deployed Roles
// v2.1.1 mastercopy, a Safe 1.4.1 and Multicall3 at fresh addresses, and one
// eth_call to that Multicall3
//   1. sets the Roles mod up as its owner and scopes each role with its
//      presets' permissions (the contract's own integrity check runs here),
//   2. sends every case through execTransactionWithRole, as the member of
//      every role, against the real protocol contracts.
// State carries over from call to call within the eth_call, so an approval
// counts for the deposit after it. Opt in with SIMULATE=1 (`bun test:sim`).

const ROLES_V2_1_1 = '0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5'
const SAFE_1_4_1 = '0x41675C099F32341bf84BFc5382aF534df5C7461a'
const MULTICALL_3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

const address = (tag: string) =>
  getAddress(`0x${tag.padStart(40, '0')}`) as Address

/** The Safe the simulated Roles mod acts for. */
export const AVATAR = address('5afe000001')
/** Someone the presets must never pay or give anything to. */
export const STRANGER = address('bad0000001')

const ROLES = address('d371ae0001')
/** Owner of the Roles mod and member of every role. */
const CALLER = address('ca11e40001')

export const simulationEnabled = process.env.SIMULATE === '1'

export type Case = {
  label: string
  /** A role key; one that is not in `roles` has no members. */
  role: string
  to: Address
  data: string
  value?: bigint
  /** 1 for a delegatecall. */
  operation?: 0 | 1
  allowed: boolean
}

export type CaseResult = Case & { passed: boolean; detail: string }

type Preset = { permissions: unknown }

export const simulateByCall = async ({
  rpc,
  roles,
  cases,
  stateOverrides = {},
}: {
  rpc: string
  /** Presets per role key. */
  roles: Record<string, readonly Preset[]>
  cases: readonly Case[]
  /** Extra state, e.g. token balances for `AVATAR`. */
  stateOverrides?: Record<string, unknown>
}) => {
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true })
  const abi = AbiCoder.defaultAbiCoder()
  const iface = new Interface(rolesAbi)
  const block = await provider.getBlockNumber()
  const [rolesCode, safeCode, multicallCode] = await Promise.all([
    provider.getCode(ROLES_V2_1_1),
    provider.getCode(SAFE_1_4_1),
    provider.getCode(MULTICALL_3),
  ])
  for (const [name, code] of Object.entries({
    'Roles v2.1.1': rolesCode,
    'Safe 1.4.1': safeCode,
    Multicall3: multicallCode,
  })) {
    if (code === '0x') throw new Error(`${name} is not on this chain`)
  }

  const setup: { label: string; data: string }[] = [
    {
      label: 'setUp',
      data: iface.encodeFunctionData('setUp', [
        abi.encode(['address', 'address', 'address'], [CALLER, AVATAR, AVATAR]),
      ]),
    },
  ]

  for (const [role, presets] of Object.entries(roles)) {
    const roleKey = encodeKey(role)
    setup.push({
      label: `assign ${role}`,
      data: iface.encodeFunctionData('assignRoles', [
        CALLER,
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

  const slot = (key: string, index: number) =>
    keccak256(abi.encode(['address', 'uint256'], [key, index]))
  const word = (value: bigint | string) => zeroPadValue(toBeHex(value), 32)
  const overrides = {
    ...stateOverrides,
    [CALLER]: { code: multicallCode },
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
    ...setup.map(({ data }) => data),
    ...cases.map(({ role, to, value = 0n, data, operation = 0 }) =>
      iface.encodeFunctionData('execTransactionWithRole', [
        to,
        value,
        data,
        operation,
        encodeKey(role),
        true,
      ])
    ),
  ]

  const returned = await provider.send('eth_call', [
    {
      to: CALLER,
      data: multicall.encodeFunctionData('aggregate3', [
        calls.map((callData) => [ROLES, true, callData]),
      ]),
      gas: toQuantity(30_000_000),
    },
    'latest',
    overrides,
  ])
  const results: { success: boolean; returnData: string }[] =
    multicall.decodeFunctionResult('aggregate3', returned)[0]

  const reason = (data: string) => {
    if (data === '0x') return 'reverted'
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
    .filter(({ result }) => !result.success)
    .map(({ label, result }) => `${label}: ${reason(result.returnData)}`)

  const caseResults: CaseResult[] = cases.map((testCase, i) => {
    const result = results[setup.length + i]!
    const detail = result.success ? 'executed' : reason(result.returnData)
    return {
      ...testCase,
      // A blocked case must stop at Roles. A call Roles lets through and the
      // target then reverts (ModuleTransactionFailed) proves nothing.
      passed: testCase.allowed
        ? result.success
        : ROLES_REJECTIONS.some((error) => detail.startsWith(error)),
      detail,
    }
  })

  return { block, failedSetup, cases: caseResults }
}

const multicall = new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
])

/** Errors with which Roles refuses a call it does not permit. */
const ROLES_REJECTIONS = [
  'ConditionViolation',
  'NoMembership',
  'CalldataOutOfBounds',
  'FunctionSignatureTooShort',
  'MalformedMultiEntrypoint',
]
