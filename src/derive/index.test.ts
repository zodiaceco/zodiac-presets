import { describe, expect, it } from 'bun:test'
import {
  processPermissions,
  targetIntegrity,
  type Permission,
} from 'zodiac-roles-sdk'
import { derive, DERIVE, DERIVE_ASSETS, DERIVE_SCOPES } from '.'

const ACTION_MANAGER = DERIVE[1].toLowerCase()
const USDC = DERIVE_ASSETS[1].USDC
const ETH = DERIVE_ASSETS[1].ETH
const KEY = '0x0000000000000000000000000000005e55100001'

const SELECTORS = {
  approve: '0x095ea7b3',
  depositToNewSubaccount: '0xe7435fad',
  deposit: '0xcf92a0f2',
  submit: '0xec459679',
  withdraw: '0x6081a3fb',
}

const EQUAL_TO_AVATAR = 15
const EQUAL_TO = 16
const LESS_THAN = 18
const PASS = 0
const OR = 2
const MATCHES = 5
const ARRAY_EVERY = 7
const WITHIN_ALLOWANCE = 28

const word = (value: string | bigint) =>
  `0x${(typeof value === 'bigint' ? value.toString(16) : value.slice(2))
    .padStart(64, '0')
    .toLowerCase()}`

const find = (permissions: any[], target: string, selector: string) =>
  permissions.find(
    (p) => p.targetAddress.toLowerCase() === target && p.selector === selector
  )

const compiles = (permissions: any[]) =>
  targetIntegrity(processPermissions(permissions as Permission[]).targets)

describe('derive.deposit', () => {
  const deposit = () =>
    derive.deposit({
      chain: 1,
      tokens: [
        { asset: 'USDC', minimum: 10_000_000n, allowance: 'derive_usdc' },
        { asset: 'ETH', minimum: 4_300_000_000_000_000n },
      ],
      newSubaccounts: { managers: [1, 5] },
      subaccounts: [900001n, 900002n],
    })

  it('labels itself after the tokens', () => {
    expect(deposit().label).toBe('Deposit USDC and ETH into Derive')
  })

  it('approves the tokens to the ActionManager only', () => {
    const { permissions } = deposit() as { permissions: any[] }
    for (const token of [USDC.token, ETH.token]) {
      const approve = find(permissions, token.toLowerCase(), SELECTORS.approve)
      expect(approve.condition.children[0]).toMatchObject({
        operator: EQUAL_TO,
        compValue: word(ACTION_MANAGER),
      })
    }
  })

  it('creates subaccounts owned by the avatar, for listed managers', () => {
    const { permissions } = deposit() as { permissions: any[] }
    const first = permissions.filter(
      (p) =>
        p.targetAddress === ACTION_MANAGER &&
        p.selector === SELECTORS.depositToNewSubaccount
    )
    expect(first).toHaveLength(2)
    const [asset, amount, managers, owner] = first[0].condition.children
    expect(asset).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(USDC.label),
    })
    expect(amount.children.map((c: any) => c.operator)).toEqual([
      17, // GreaterThan (minimum - 1)
      WITHIN_ALLOWANCE,
    ])
    expect(managers.operator).toBe(OR)
    expect(owner.operator).toBe(EQUAL_TO_AVATAR)
  })

  it('tops up only the avatar’s subaccounts, falling back to the avatar', () => {
    const { permissions } = deposit() as { permissions: any[] }
    const later = find(permissions, ACTION_MANAGER, SELECTORS.deposit)
    const [, , subaccount, fallback] = later.condition.children
    expect(subaccount.operator).toBe(OR)
    expect(subaccount.children.map((c: any) => c.compValue)).toEqual([
      word(900001n),
      word(900002n),
    ])
    expect(fallback.operator).toBe(EQUAL_TO_AVATAR)
  })

  it('leaves out top-ups until the subaccounts are known', () => {
    const { permissions } = derive.deposit({
      chain: 1,
      tokens: [{ asset: 'USDC', minimum: 10_000_000n }],
      newSubaccounts: { managers: [5] },
    }) as { permissions: any[] }
    expect(find(permissions, ACTION_MANAGER, SELECTORS.deposit)).toBeUndefined()
  })

  it('creates no subaccounts without `newSubaccounts`', () => {
    const { permissions } = derive.deposit({
      chain: 1,
      tokens: [{ asset: 'USDC', minimum: 10_000_000n }],
      subaccounts: [900001n],
    }) as { permissions: any[] }
    expect(
      find(permissions, ACTION_MANAGER, SELECTORS.depositToNewSubaccount)
    ).toBeUndefined()
    expect(find(permissions, ACTION_MANAGER, SELECTORS.deposit)).toBeDefined()
  })

  it('needs new or existing subaccounts', () => {
    expect(() =>
      derive.deposit({
        chain: 1,
        tokens: [{ asset: 'USDC', minimum: 10_000_000n }],
      })
    ).toThrow('`newSubaccounts` or `subaccounts`')
  })

  it('refuses a zero minimum', () => {
    expect(() =>
      derive.deposit({
        chain: 1,
        tokens: [{ asset: 'USDC', minimum: 0n }],
        newSubaccounts: { managers: [1] },
      })
    ).toThrow('minimum above zero')
  })

  it('compiles', () => {
    expect(() => compiles((deposit() as any).permissions)).not.toThrow()
  })
})

describe('derive.withdraw', () => {
  const withdraw = () =>
    derive.withdraw({
      chain: 1,
      assets: ['USDC', 'ETH'],
      subaccounts: [900001n],
      maxFeeUsd: 50,
    }) as { label: string; permissions: any[] }

  it('pays out to the avatar only, with the fee capped', () => {
    const [permission] = withdraw().permissions
    expect(permission).toMatchObject({
      targetAddress: ACTION_MANAGER,
      selector: SELECTORS.withdraw,
      send: true,
    })
    const [subaccount, asset, fee, recipient] =
      permission.condition.children[0].children
    expect(subaccount).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(900001n),
    })
    expect(asset.operator).toBe(OR)
    expect(fee).toMatchObject({
      operator: LESS_THAN,
      compValue: word(50n * 10n ** 18n + 1n),
    })
    expect(recipient.operator).toBe(EQUAL_TO_AVATAR)
  })

  it('compiles', () => {
    expect(() => compiles(withdraw().permissions)).not.toThrow()
  })
})

describe('derive.sessionKeys', () => {
  const sessionKeys = (
    scopes: readonly number[] = DERIVE_SCOPES.optionsDesk,
    transfers?: boolean
  ) =>
    derive.sessionKeys({
      chain: 1,
      keys: [KEY],
      scopes,
      subaccounts: [900001n, 900002n, 900003n],
      transfers,
      expiresBefore: new Date('2027-01-01T00:00:00Z'),
    }) as { label: string; permissions: any[] }

  const appKeys = () =>
    derive.sessionKeys({
      chain: 1,
      scopes: DERIVE_SCOPES.app,
      subaccounts: [900001n, 900002n],
    }) as { permissions: any[] }

  const subaccountsCondition = (transfers?: boolean) =>
    sessionKeys(DERIVE_SCOPES.optionsDesk, transfers).permissions[0].condition
      .children[1].children[3]
  const scopesCondition = (transfers?: boolean) =>
    sessionKeys(DERIVE_SCOPES.optionsDesk, transfers).permissions[0].condition
      .children[1].children[2]

  it('allows only Set Session Key, decoded', () => {
    const [permission] = sessionKeys().permissions
    expect(permission).toMatchObject({
      targetAddress: ACTION_MANAGER,
      selector: SELECTORS.submit,
    })
    const [actionType, data] = permission.condition.children
    expect(actionType).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(51n),
    })

    const [key, expiry, scopes, subaccounts] = data.children
    expect(key).toMatchObject({ operator: EQUAL_TO, compValue: word(KEY) })
    expect(expiry).toMatchObject({
      operator: LESS_THAN,
      compValue: word(1798761600n + 1n),
    })
    expect(scopes.operator).toBe(ARRAY_EVERY)
    // One to three of the listed subaccounts, never an empty list
    expect(subaccounts.operator).toBe(OR)
    expect(
      subaccounts.children.map((c: any) => [c.operator, c.children.length])
    ).toEqual([
      [MATCHES, 1],
      [MATCHES, 2],
      [MATCHES, 3],
    ])
    expect(subaccounts.children[0].children[0].operator).toBe(OR)
    expect(subaccounts.children[0].children[0].children).toHaveLength(3)
  })

  it('without `keys` and `expiresBefore`, allows any key and expiry', () => {
    const [key, expiry, scopes, subaccounts] =
      appKeys().permissions[0].condition.children[1].children
    expect(key.operator).toBe(PASS)
    expect(expiry.operator).toBe(PASS)
    expect(scopes.children[0].children.map((c: any) => c.compValue)).toEqual([
      word(1n),
      word(2n),
    ])
    expect(subaccounts.operator).toBe(OR)
  })

  it('without transfers, refuses transfers between subaccounts', () => {
    expect(
      scopesCondition().children[0].children.map((c: any) => c.compValue)
    ).toEqual([word(6n), word(10n)])
    expect(() => sessionKeys([6, 12])).toThrow('`transfers: true`')
  })

  it('with transfers, adds them', () => {
    expect(
      scopesCondition(true).children[0].children.map((c: any) => c.compValue)
    ).toEqual([word(6n), word(10n), word(12n)])
    expect(() => sessionKeys([6, 12], true)).not.toThrow()
    expect(subaccountsCondition(true)).toEqual(subaccountsCondition())
  })

  for (const scope of [0, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
    it(`refuses scope ${scope}`, () => {
      expect(() => sessionKeys([6, scope])).toThrow(`Derive scope ${scope}`)
    })
  }

  it('refuses unknown scopes and an empty scope list', () => {
    expect(() => sessionKeys([23])).toThrow('Unknown Derive scope 23')
    expect(() => sessionKeys([])).toThrow('need scopes')
  })

  it('compiles', () => {
    expect(() => compiles(sessionKeys().permissions)).not.toThrow()
    expect(() =>
      compiles(sessionKeys(DERIVE_SCOPES.optionsDesk, true).permissions)
    ).not.toThrow()
    expect(() => compiles(appKeys().permissions)).not.toThrow()
  })
})

describe('derive.revokeSessionKeys', () => {
  it('allows Set Session Key with expiry 0 only', () => {
    const [permission] = (
      derive.revokeSessionKeys({ chain: 1 }) as { permissions: any[] }
    ).permissions
    const [actionType, data] = permission.condition.children
    expect(actionType.compValue).toBe(word(51n))
    expect(data.children[1]).toMatchObject({
      operator: EQUAL_TO,
      compValue: word(0n),
    })
  })
})
