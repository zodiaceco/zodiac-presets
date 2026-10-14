import { c } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from './kit'

// Morpho vaults (V1 and V2), used either directly (the vault's own ERC-4626
// calls) or the way the Morpho app does it, through VaultBundlesV1.
//
// VaultBundlesV1 (verified source on Sourcify) only ever pulls from, deposits
// for, redeems from and pays out to `msg.sender` — here the avatar — so
// approving it is safe. The one exception is a referral fee it can split off
// to any address, which is why `referralFeePct` and `referralFeeRecipient` are
// pinned to zero.

/**
 * VaultBundlesV1 on every chain both Morpho and Zodiac support, by chain id.
 * Morpho keeps the canonical list in `@morpho-org/morpho-ts`
 * (`addressesRegistry[chainId].bundles.vaultBundlesV1`); a test checks this
 * one against it.
 */
export const VAULT_BUNDLES_V1 = {
  1: '0x02912516d49dE997db75B9D7858faAE59209650B', // Ethereum
  10: '0x112088363eE4CcF3F37EaBD98FDDeEd98F0Be485', // Optimism
  130: '0x40755e3e2513D71cB79DC3Eeefd8Eb848d9cd899', // Unichain
  137: '0x386ABE0188b7FADA897cE4dF9d72E8F57915B103', // Polygon
  480: '0x768BBD5F6c22b2498cC9C19832d3AEE08240755a', // World Chain
  999: '0xB5173417e28482c61C14A4C2e217b158fF0db666', // HyperEVM
  8453: '0x2B08A911f48dE25A7e305D910Afb5597aBE8ea7B', // Base
  42161: '0x5afAb0B2414E30c92a708234ea1b383Ce6317ED5', // Arbitrum
  747474: '0x2464F4d0a4481732e7cC90ADD5abF986A48A06Dd', // Katana
} as const satisfies Record<number, Address>

export type MorphoChain = keyof typeof VAULT_BUNDLES_V1

type Vaults = readonly [Address, ...Address[]]

export type MorphoDepositParams = {
  /** Defaults to "Deposit into Morpho vault: <vault name>". */
  label?: string
  chain: MorphoChain
  /** The token every vault below takes deposits in. */
  asset: Address
  vaults: Vaults
}

export type MorphoWithdrawParams = {
  /** Defaults to "Withdraw from Morpho vault: <vault name>". */
  label?: string
  chain: MorphoChain
  vaults: Vaults
}

const ZERO: Address = '0x0000000000000000000000000000000000000000'

/**
 * Deposit into Morpho vaults that share one asset, receiving the shares in
 * the avatar. Without a `label`, looks up the vaults' names on the Morpho API.
 */
export const morphoDeposit = async ({
  label,
  chain,
  asset,
  vaults,
}: MorphoDepositParams) => {
  const vaultBundles = VAULT_BUNDLES_V1[chain]

  return custom({
    label: label ?? `Deposit into ${await describeVaults(chain, vaults)}`,
    permissions: [
      at('erc20', asset).approve(oneOf([vaultBundles, ...vaults])),

      // The Morpho app's route
      at('morpho_vault_bundles_v1', vaultBundles).vaultBundlesV1Deposit(
        oneOf(vaults),
        undefined, // assets
        undefined, // maxSharePriceE27
        undefined, // assetPermit
        0, // referralFeePct
        ZERO // referralFeeRecipient
      ),

      // Straight into the vaults
      ...vaults.flatMap((address) => {
        const vault = at('erc4626', address)

        return [
          vault.deposit(undefined, c.avatar),
          vault.mint(undefined, c.avatar),
        ]
      }),
    ],
  })
}

/**
 * Withdraw from Morpho vaults, paying the assets out to the avatar. Without a
 * `label`, looks up the vaults' names on the Morpho API.
 */
export const morphoWithdraw = async ({
  label,
  chain,
  vaults,
}: MorphoWithdrawParams) => {
  const vaultBundles = VAULT_BUNDLES_V1[chain]

  return custom({
    label: label ?? `Withdraw from ${await describeVaults(chain, vaults)}`,
    permissions: [
      // The Morpho app's route, which pulls the shares it redeems
      at('morpho_vault_bundles_v1', vaultBundles).vaultBundlesV1Withdraw(
        oneOf(vaults),
        undefined, // assets
        undefined, // shares
        undefined, // sharesPermit
        0, // referralFeePct
        ZERO // referralFeeRecipient
      ),

      ...vaults.flatMap((address) => {
        const vault = at('erc4626', address)

        return [
          vault.approve(vaultBundles),

          // Straight from the vaults
          vault.withdraw(undefined, c.avatar, c.avatar),
          vault.redeem(undefined, c.avatar, c.avatar),
        ]
      }),
    ],
  })
}

const oneOf = (addresses: readonly Address[]) =>
  addresses.length === 1
    ? addresses[0]!
    : c.or(...(addresses as [Address, Address, ...Address[]]))

/** "Morpho vault: <name>", or "Morpho vaults: <name>, <name>". */
const describeVaults = async (chain: MorphoChain, vaults: Vaults) => {
  const names = await vaultNames(chain, vaults)

  return `Morpho ${vaults.length === 1 ? 'vault' : 'vaults'}: ${vaults
    .map((vault) => names.get(vault.toLowerCase()) ?? vault)
    .join(', ')}`
}

export const MORPHO_API = 'https://api.morpho.org/graphql'

// Vault V1 and V2 are separate collections in the API, so this asks both.
const VAULT_NAMES_QUERY = `
  query VaultNames($addresses: [String!], $chains: [Int!]) {
    vaultV2s(first: 1000, where: { address_in: $addresses, chainId_in: $chains }) {
      items { address name }
    }
    vaults(first: 1000, where: { address_in: $addresses, chainId_in: $chains }) {
      items { address name }
    }
  }
`

type VaultItems = { items: { address: string; name: string }[] }

/** Vault names by lowercase address. Vaults the API doesn't know are left out. */
const vaultNames = async (
  chain: MorphoChain,
  vaults: Vaults
): Promise<Map<string, string>> => {
  const response = await fetch(MORPHO_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: VAULT_NAMES_QUERY,
      variables: {
        addresses: vaults.map((vault) => vault.toLowerCase()),
        chains: [chain],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(
      `The Morpho API answered ${response.status} when asked for vault names. Pass a \`label\` to skip the lookup.`
    )
  }

  const { data, errors } = (await response.json()) as {
    data?: { vaultV2s: VaultItems; vaults: VaultItems }
    errors?: { message: string }[]
  }

  if (data == null) {
    throw new Error(
      `The Morpho API could not name the vaults: ${errors?.map((e) => e.message).join('; ')}. Pass a \`label\` to skip the lookup.`
    )
  }

  return new Map(
    [...data.vaultV2s.items, ...data.vaults.items].map(({ address, name }) => [
      address.toLowerCase(),
      name,
    ])
  )
}
