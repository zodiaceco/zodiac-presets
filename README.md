# Zodiac Presets

Reusable permission presets for [Zodiac](https://zodiac.eco) constellations.
Each preset is a labelled permission entry you drop into a role's
`permissions`, for protocol flows the SDK's built-in actions don't cover.

```sh
bun add @zodiaceco/presets
```

```ts
// constellation/roles/curator/permissions.ts
import { morpho } from '@zodiaceco/presets'

const vaults = ['0xbeeff1D5dE8F79ff37a151681100B039661da518'] as const // Bitget x Steakhouse USDC

export default [
  // Labelled "Deposit into Morpho vault: Bitget x Steakhouse USDC"
  await morpho.deposit({
    chain: 42161,
    asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    vaults,
  }),
  await morpho.withdraw({ chain: 42161, vaults, label: 'Withdraw USDC' }),
] satisfies Permissions
```

Presets that look something up are async, so `await` them. A role's
permissions file is an ES module, so top-level `await` works there.

## Presets

Each protocol is one object, `<protocol>.<preset>`. Every receiver, owner and
`onBehalfOf` is pinned to the avatar, so funds only ever move in and out of
positions the avatar holds.

| Preset                                   | What it allows                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `aave.deposit`                           | Supply tokens (or the native token, through the gateway) to an Aave v3 market and use them as collateral.                                   |
| `aave.withdraw`                          | Withdraw supplied tokens and claim rewards.                                                                                                 |
| `aave.borrow`                            | Borrow and repay tokens.                                                                                                                    |
| `fluid.deposit`                          | Supply tokens (or the native token) to their Fluid fTokens.                                                                                 |
| `fluid.withdraw`                         | Withdraw them again.                                                                                                                        |
| `hyperliquid.tradingKeys` (experimental) | Add, replace and remove trading keys for the avatar's Hyperliquid account.                                                                  |
| `hyperliquid.funds` (experimental)       | Deposit USDC into the avatar's Hyperliquid account, move it between spot and perp, and withdraw it from spot to the avatar on HyperEVM.     |
| `hyperliquid.builderFee` (experimental)  | Approve the fee of one builder, up to one rate.                                                                                             |
| `morpho.deposit`                         | Deposit into Morpho vaults (V1 and V2) that share one asset, straight into the vault or through VaultBundlesV1 the way the Morpho app does. |
| `morpho.withdraw`                        | Withdraw from Morpho vaults, straight from the vault or through VaultBundlesV1.                                                             |
| `uniswap.deposit`                        | Open Uniswap v3 positions for given tokens and fee tiers, or add to given positions.                                                        |
| `uniswap.withdraw`                       | Remove liquidity and collect fees from the avatar's positions.                                                                              |

Without a `label`, each preset derives one from its inputs.

| Protocol                   | Chains                                                                                                                                          | Addresses                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Aave v3                    | Ethereum (Core, Prime, EtherFi), Optimism, BNB, Gnosis, Polygon, Sonic, MegaETH, Mantle, Base, Plasma, Arbitrum, Celo, Avalanche, Linea, Scroll | `AAVE_V3` in `src/aave/markets.ts`, from `@bgd-labs/aave-address-book`    |
| Fluid                      | Ethereum, BNB, Polygon, Base, Plasma, Arbitrum                                                                                                  | `F_TOKENS` in `src/fluid/fTokens.ts`, read on chain by `bun sync:fluid`   |
| Hyperliquid (experimental) | HyperEVM                                                                                                                                        | `HYPERLIQUID` and `CORE_WRITER` in `src/hyperliquid/index.ts`             |
| Morpho                     | Ethereum, Optimism, Unichain, Polygon, World Chain, HyperEVM, Base, Arbitrum, Katana                                                            | `VAULT_BUNDLES_V1` in `src/morpho/index.ts`, from `@morpho-org/morpho-ts` |
| Uniswap v3                 | Every chain with a v3 position manager that Zodiac supports                                                                                     | `POSITION_MANAGER` in `src/uniswap/index.ts`, from `@uniswap/sdk-core`    |

Morpho pins VaultBundlesV1's referral fee to zero and, without a `label`, looks
up the vaults' names on the [Morpho API](https://api.morpho.org/graphql). The
other presets make no network calls.

### Hyperliquid (experimental)

The Hyperliquid presets are checked against HyperEVM state but not yet used
in a deployed role. A Safe acts on its Hyperliquid account through CoreWriter
on HyperEVM, which takes each action as raw bytes, so the presets pin byte
ranges of it:

- `tradingKeys` allows action 9 (`addApiWallet`) with any key and name.
  Trading keys trade the account, but Hyperliquid lets them neither withdraw
  nor transfer from it.
- `funds` allows USDC approvals to Circle's CoreDepositWallet, deposits for the
  avatar into perp or spot, action 7 (`usdClassTransfer`, between the avatar's
  own spot and perp) and action 13 (`sendAsset`) of USDC from spot to USDC's
  system address, which pays it out to the avatar on HyperEVM. Only the amounts
  are open.
- `builderFee` allows action 12 (`approveBuilderFee`) for one builder at one
  rate. Add it only when an app the avatar trades through charges a builder
  fee.

```ts
import { hyperliquid } from '@zodiaceco/presets'

export default [
  await hyperliquid.tradingKeys({ chain: 999 }),
  await hyperliquid.funds({ chain: 999 }),
] satisfies Permissions
```

## Adding a preset

1. If the preset needs contracts the package doesn't know yet, add them to
   `zodiac.config.ts`:
   - **An ABI used at many addresses** (a token standard, a vault type, a
     contract deployed on several chains) goes under `any`, with its ABI at
     `abis/any/<name>.json`. Presets bind it to an address at call time with
     `at('<name>', address)`.
   - **A contract at one address** goes under its chain prefix
     (`arb1: { … }`); `bun codegen` fetches its ABI.
2. `bun codegen` regenerates the kit types in `src/kit.generated.d.ts`.
3. Write the presets in `src/<protocol>/index.ts`, grouped as one object per
   protocol (`export const morpho = { deposit, withdraw }`), each built with
   `custom()` from `@zodiaceco/sdk/actions` on the typed kit.
   Explain in a comment why every unconstrained parameter is safe.
   Contract addresses that differ by chain go in a map keyed by chain id,
   covering every chain the protocol and Zodiac share.
4. Export the object from `src/index.ts`, add tests next to it
   (`src/<protocol>/index.test.ts`) and a row to the table above. A preset
   replacing a DeFi Kit one is tested against DeFi Kit's output for the same
   inputs (`expectSamePermissions` in `src/test/defiKit.ts`).
5. Check the presets against chain state in `src/<protocol>/index.sim.test.ts`
   with `simulateByCall()` from `src/test/simulateByCall.ts`. It scopes a
   Roles v2.1.1 mod on a Safe with your presets and sends each case through
   it, all in one `eth_call` with state overrides: the intended flows must
   execute against the real protocol contracts, and every call that would hand
   funds to someone else must stop at the Roles mod. Nothing is sent.

## Development

| Command           | What it does                                                                        |
| ----------------- | ----------------------------------------------------------------------------------- |
| `bun install`     | Install dependencies                                                                |
| `bun codegen`     | Regenerate the kit types from the ABIs                                              |
| `bun test`        | Run the tests                                                                       |
| `bun test:sim`    | Run the simulations against chain state (`RPC_<chainId>` overrides the default RPC) |
| `bun check:types` | Type-check                                                                          |
| `bun fix:format`  | Format with Prettier                                                                |
| `bun run build`   | Build `dist/` (ESM and type declarations)                                           |

## Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please)
from [conventional commits](https://www.conventionalcommits.org): `fix:` bumps
the patch version, `feat:` the minor one. The workflow
(`.github/workflows/release.yml`) is disabled until the first version is on
npm. To get there:

1. Publish 0.1.0 by hand: `bun run build && npm publish --access public`.
2. Tag it: `git tag v0.1.0 && git push origin v0.1.0`, so release-please starts
   from there.
3. Configure the trusted publisher at
   npmjs.com/package/@zodiaceco/presets/access for this repo and
   `release.yml`.
4. Switch the workflow's trigger to pushes to `main`.

## License

[LGPL-3.0-only](LICENSE)
