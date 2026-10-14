import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { addressesRegistry } from '@morpho-org/morpho-ts'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { MORPHO_API, morpho, VAULT_BUNDLES_V1 } from '.'

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
const VAULT = '0xbeeff1d5de8f79ff37a151681100b039661da518'
const OTHER_VAULT = '0x7e97fa6893871a2751b5fe961978dccb2c201e65'
const BUNDLES = VAULT_BUNDLES_V1[42161].toLowerCase()

const SELECTORS = {
  approve: '0x095ea7b3',
  vaultBundlesV1Deposit: '0x6bbba4e0',
  vaultBundlesV1Withdraw: '0x932084a8',
  deposit: '0x6e553f65',
  mint: '0x94bf804d',
  withdraw: '0xb460af94',
  redeem: '0xba087652',
}

type Permission = { targetAddress: string; selector: string; condition: any }

const word = (address: string) =>
  `0x${address.slice(2).padStart(64, '0').toLowerCase()}`

const calls = (permissions: Permission[]) =>
  permissions.map(({ targetAddress, selector }) => [targetAddress, selector])

const find = (permissions: Permission[], target: string, selector: string) =>
  permissions.find((p) => p.targetAddress === target && p.selector === selector)

const deposit = async (vaults: [`0x${string}`, ...`0x${string}`[]]) =>
  (
    await morpho.deposit({
      label: 'Deposit',
      chain: 42161,
      asset: USDC,
      vaults,
    })
  ).permissions as Permission[]

const withdraw = async (vaults: [`0x${string}`, ...`0x${string}`[]]) =>
  (await morpho.withdraw({ label: 'Withdraw', chain: 42161, vaults }))
    .permissions as Permission[]

// The Morpho API, answering for the vaults it knows. V2 and V1 vaults come back
// in separate collections, with checksummed addresses.
const NAMES = {
  vaultV2s: [
    {
      address: '0xbeeff1D5dE8F79ff37a151681100B039661da518',
      name: 'Bitget x Steakhouse USDC',
    },
  ],
  vaults: [
    {
      address: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65',
      name: 'Gauntlet USDC Core',
    },
  ],
}

const fetchMock = mock(async (_url: string, _init?: RequestInit) =>
  Response.json({
    data: {
      vaultV2s: { items: NAMES.vaultV2s },
      vaults: { items: NAMES.vaults },
    },
  })
)
const realFetch = globalThis.fetch

beforeEach(() => {
  fetchMock.mockClear()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('morpho.deposit', () => {
  it('allows depositing through the bundles contract or straight into the vault', async () => {
    expect(calls(await deposit([VAULT]))).toEqual([
      [USDC, SELECTORS.approve],
      [BUNDLES, SELECTORS.vaultBundlesV1Deposit],
      [VAULT, SELECTORS.deposit],
      [VAULT, SELECTORS.mint],
    ])
  })

  it('lets the asset be approved to the bundles contract and the vaults only', async () => {
    const approve = find(await deposit([VAULT]), USDC, SELECTORS.approve)

    expect(
      approve?.condition.children[0].children.map((c: any) => c.compValue)
    ).toEqual([word(BUNDLES), word(VAULT)])
  })

  it('pins the vault and the referral fee to zero', async () => {
    const { condition } = find(
      await deposit([VAULT]),
      BUNDLES,
      SELECTORS.vaultBundlesV1Deposit
    )!

    expect(condition.children[0].compValue).toBe(word(VAULT))
    expect(condition.children[4].compValue).toBe(word('0x0'))
    expect(condition.children[5].compValue).toBe(word('0x0'))
  })

  it('accepts any of several vaults', async () => {
    const permissions = await deposit([VAULT, OTHER_VAULT])
    const { condition } = find(
      permissions,
      BUNDLES,
      SELECTORS.vaultBundlesV1Deposit
    )!

    expect(condition.children[0].children.map((c: any) => c.compValue)).toEqual(
      [word(VAULT), word(OTHER_VAULT)]
    )
    expect(find(permissions, OTHER_VAULT, SELECTORS.mint)).toBeDefined()
  })
})

describe('morpho.withdraw', () => {
  it('allows withdrawing through the bundles contract or straight from the vault', async () => {
    expect(calls(await withdraw([VAULT]))).toEqual([
      [BUNDLES, SELECTORS.vaultBundlesV1Withdraw],
      [VAULT, SELECTORS.approve],
      [VAULT, SELECTORS.withdraw],
      [VAULT, SELECTORS.redeem],
    ])
  })

  it('lets vault shares be approved to the bundles contract only', async () => {
    const approve = find(await withdraw([VAULT]), VAULT, SELECTORS.approve)

    expect(approve?.condition.children[0].compValue).toBe(word(BUNDLES))
  })

  it('pins the vault and the referral fee to zero', async () => {
    const { condition } = find(
      await withdraw([VAULT]),
      BUNDLES,
      SELECTORS.vaultBundlesV1Withdraw
    )!

    expect(condition.children[0].compValue).toBe(word(VAULT))
    expect(condition.children[4].compValue).toBe(word('0x0'))
    expect(condition.children[5].compValue).toBe(word('0x0'))
  })
})

describe('labels', () => {
  it('keeps a label it is given, without asking the Morpho API', async () => {
    const entry = await morpho.deposit({
      label: 'Park USDC',
      chain: 42161,
      asset: USDC,
      vaults: [VAULT],
    })

    expect(entry.label).toBe('Park USDC')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names a vault after the Morpho API', async () => {
    const entry = await morpho.deposit({
      chain: 42161,
      asset: USDC,
      vaults: [VAULT],
    })

    expect(entry.label).toBe(
      'Deposit into Morpho vault: Bitget x Steakhouse USDC'
    )
  })

  it('names several vaults, V1 and V2 alike', async () => {
    const entry = await morpho.withdraw({
      chain: 42161,
      vaults: [VAULT, OTHER_VAULT],
    })

    expect(entry.label).toBe(
      'Withdraw from Morpho vaults: Bitget x Steakhouse USDC, Gauntlet USDC Core'
    )
  })

  it('asks for the vaults on their chain', async () => {
    await morpho.withdraw({ chain: 42161, vaults: [VAULT] })

    const [url, init] = fetchMock.mock.calls[0]!

    expect(url).toBe(MORPHO_API)
    expect(JSON.parse(init!.body as string).variables).toEqual({
      addresses: [VAULT],
      chains: [42161],
    })
  })

  it('falls back to the address of a vault the API does not know', async () => {
    const unknown = '0x1111111111111111111111111111111111111111'
    const entry = await morpho.withdraw({ chain: 42161, vaults: [unknown] })

    expect(entry.label).toBe(`Withdraw from Morpho vault: ${unknown}`)
  })

  it('says to pass a label when the API fails', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('down', { status: 503 })
    )

    await expect(
      morpho.withdraw({ chain: 42161, vaults: [VAULT] })
    ).rejects.toThrow('Pass a `label` to skip the lookup.')
  })
})

describe('VAULT_BUNDLES_V1', () => {
  const zodiacChains = new Set<number>(Object.values(CHAIN_IDS))
  const morpho = Object.entries(addressesRegistry)
    .map(([chain, addresses]) => ({
      chain: Number(chain),
      vaultBundlesV1: (addresses as { bundles?: { vaultBundlesV1?: string } })
        .bundles?.vaultBundlesV1,
    }))
    .filter(
      ({ chain, vaultBundlesV1 }) =>
        vaultBundlesV1 != null && zodiacChains.has(chain)
    )

  it("lists Morpho's address on every chain Zodiac supports", () => {
    expect(
      Object.fromEntries(morpho.map((m) => [m.chain, m.vaultBundlesV1]))
    ).toEqual(VAULT_BUNDLES_V1)
  })
})
