import { describe, expect, it } from 'bun:test'
import { morphoVaults, VAULT_BUNDLES_V1 } from './morpho'

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
const VAULT = '0xbeeff1d5de8f79ff37a151681100b039661da518'
const OTHER_VAULT = '0x7e97fa6893871a2751b5fe961978dccb2c201e65'
const BUNDLES = VAULT_BUNDLES_V1[42161]

const SELECTORS = {
  approve: '0x095ea7b3',
  vaultBundlesV1Deposit: '0x6bbba4e0',
  vaultBundlesV1Withdraw: '0x932084a8',
  deposit: '0x6e553f65',
  mint: '0x94bf804d',
  withdraw: '0xb460af94',
  redeem: '0xba087652',
}

const permissionsOf = (vaults: [`0x${string}`, ...`0x${string}`[]]) =>
  morphoVaults({ label: 'Morpho', chain: 42161, asset: USDC, vaults })
    .permissions as {
    targetAddress: string
    selector: string
    condition: any
  }[]

const find = (
  permissions: ReturnType<typeof permissionsOf>,
  target: string,
  selector: string
) =>
  permissions.find((p) => p.targetAddress === target && p.selector === selector)

const word = (address: string) =>
  `0x${address.slice(2).padStart(64, '0').toLowerCase()}`

describe('morphoVaults', () => {
  it('allows the asset, the bundles contract and every vault', () => {
    const permissions = permissionsOf([VAULT])

    expect(
      permissions.map(({ targetAddress, selector }) => [
        targetAddress,
        selector,
      ])
    ).toEqual([
      [USDC, SELECTORS.approve],
      [BUNDLES, SELECTORS.vaultBundlesV1Deposit],
      [BUNDLES, SELECTORS.vaultBundlesV1Withdraw],
      [VAULT, SELECTORS.approve],
      [VAULT, SELECTORS.deposit],
      [VAULT, SELECTORS.mint],
      [VAULT, SELECTORS.withdraw],
      [VAULT, SELECTORS.redeem],
    ])
  })

  it('lets the asset be approved to the bundles contract and the vaults only', () => {
    const approve = find(permissionsOf([VAULT]), USDC, SELECTORS.approve)

    expect(
      approve?.condition.children[0].children.map((c: any) => c.compValue)
    ).toEqual([word(BUNDLES), word(VAULT)])
  })

  it.each([
    ['deposit', SELECTORS.vaultBundlesV1Deposit],
    ['withdraw', SELECTORS.vaultBundlesV1Withdraw],
  ])(
    'pins the vault and the referral fee to zero when bundling a %s',
    (_, selector) => {
      const { condition } = find(permissionsOf([VAULT]), BUNDLES, selector)!

      expect(condition.children[0].compValue).toBe(word(VAULT))
      expect(condition.children[4].compValue).toBe(word('0x0'))
      expect(condition.children[5].compValue).toBe(word('0x0'))
    }
  )

  it('accepts any of several vaults', () => {
    const permissions = permissionsOf([VAULT, OTHER_VAULT])
    const { condition } = find(
      permissions,
      BUNDLES,
      SELECTORS.vaultBundlesV1Deposit
    )!

    expect(condition.children[0].children.map((c: any) => c.compValue)).toEqual(
      [word(VAULT), word(OTHER_VAULT)]
    )
    expect(find(permissions, OTHER_VAULT, SELECTORS.redeem)).toBeDefined()
  })
})
