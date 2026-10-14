import { c } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from './kit'

// Morpho vaults, used either directly (the vault's own ERC-4626 calls) or the
// way the Morpho app does it, through VaultBundlesV1.
//
// VaultBundlesV1 (verified source on Sourcify) only ever pulls from, deposits
// for, redeems from and pays out to `msg.sender` — here the avatar — so
// approving it is safe. The one exception is a referral fee it can split off
// to any address, which is why `referralFeePct` and `referralFeeRecipient` are
// pinned to zero.

/** VaultBundlesV1, by chain id. Add a chain once Morpho deploys it there. */
export const VAULT_BUNDLES_V1 = {
  42161: '0x5afab0b2414e30c92a708234ea1b383ce6317ed5',
} as const satisfies Record<number, Address>

export type MorphoChain = keyof typeof VAULT_BUNDLES_V1

export type MorphoVaultsParams = {
  label: string
  chain: MorphoChain
  /** The token every vault below takes deposits in. */
  asset: Address
  vaults: readonly [Address, ...Address[]]
}

const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** Deposit into and withdraw from Morpho vaults that share one asset. */
export const morphoVaults = ({
  label,
  chain,
  asset,
  vaults,
}: MorphoVaultsParams) => {
  const vaultBundles = VAULT_BUNDLES_V1[chain]
  const bundles = at('morpho_vault_bundles_v1', vaultBundles)
  const vault = oneOf(vaults)

  return custom({
    label,
    permissions: [
      at('erc20', asset).approve(oneOf([vaultBundles, ...vaults])),

      // The Morpho app's route
      bundles.vaultBundlesV1Deposit(
        vault,
        undefined, // assets
        undefined, // maxSharePriceE27
        undefined, // assetPermit
        0, // referralFeePct
        ZERO // referralFeeRecipient
      ),
      bundles.vaultBundlesV1Withdraw(
        vault,
        undefined, // assets
        undefined, // shares
        undefined, // sharesPermit
        0, // referralFeePct
        ZERO // referralFeeRecipient
      ),

      // Straight into the vaults
      ...vaults.flatMap((address) => {
        const kit = at('erc4626', address)

        return [
          kit.approve(vaultBundles),
          kit.deposit(undefined, c.avatar),
          kit.mint(undefined, c.avatar),
          kit.withdraw(undefined, c.avatar, c.avatar),
          kit.redeem(undefined, c.avatar, c.avatar),
        ]
      }),
    ],
  })
}

const oneOf = (addresses: readonly Address[]) =>
  addresses.length === 1
    ? addresses[0]!
    : c.or(...(addresses as [Address, Address, ...Address[]]))
