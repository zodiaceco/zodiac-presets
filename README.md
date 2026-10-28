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

| Preset                     | What it allows                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aave.deposit`             | Supply tokens (or the native token, through the gateway) to an Aave v3 market and use them as collateral.                                                                         |
| `aave.withdraw`            | Withdraw supplied tokens and claim rewards.                                                                                                                                       |
| `aave.borrow`              | Borrow and repay tokens.                                                                                                                                                          |
| `derive.deposit`           | Fund the avatar's Derive account: into new subaccounts it owns (the first creates the account) and/or its listed subaccounts, with a minimum and an optional allowance per token. |
| `derive.withdraw`          | Withdraw from the avatar's subaccounts to the avatar, with a fee cap.                                                                                                             |
| `derive.sessionKeys`       | Register EOA session keys that trade for the avatar: listed scopes on listed subaccounts and transfers between them, optionally listed keys and an expiry cap.                    |
| `derive.revokeSessionKeys` | Delete any of the avatar's session keys.                                                                                                                                          |
| `fluid.deposit`            | Supply tokens (or the native token) to their Fluid fTokens.                                                                                                                       |
| `fluid.withdraw`           | Withdraw them again.                                                                                                                                                              |
| `morpho.deposit`           | Deposit into Morpho vaults (V1 and V2) that share one asset, straight into the vault or through VaultBundlesV1 the way the Morpho app does.                                       |
| `morpho.withdraw`          | Withdraw from Morpho vaults, straight from the vault or through VaultBundlesV1.                                                                                                   |
| `uniswap.deposit`          | Open Uniswap v3 positions for given tokens and fee tiers, or add to given positions.                                                                                              |
| `uniswap.withdraw`         | Remove liquidity and collect fees from the avatar's positions.                                                                                                                    |

Without a `label`, each preset derives one from its inputs.

| Protocol   | Chains                                                                                                                                          | Addresses                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Aave v3    | Ethereum (Core, Prime, EtherFi), Optimism, BNB, Gnosis, Polygon, Sonic, MegaETH, Mantle, Base, Plasma, Arbitrum, Celo, Avalanche, Linea, Scroll | `AAVE_V3` in `src/aave/markets.ts`, from `@bgd-labs/aave-address-book`                                    |
| Derive V3  | Ethereum, Sepolia (Derive testnet)                                                                                                              | `DERIVE` and `DERIVE_ASSETS` in `src/derive/index.ts`, read on chain with `WithdrawalOutbox.resolveAsset` |
| Fluid      | Ethereum, BNB, Polygon, Base, Plasma, Arbitrum                                                                                                  | `F_TOKENS` in `src/fluid/fTokens.ts`, read on chain by `bun sync:fluid`                                   |
| Morpho     | Ethereum, Optimism, Unichain, Polygon, World Chain, HyperEVM, Base, Arbitrum, Katana                                                            | `VAULT_BUNDLES_V1` in `src/morpho/index.ts`, from `@morpho-org/morpho-ts`                                 |
| Uniswap v3 | Every chain with a v3 position manager that Zodiac supports                                                                                     | `POSITION_MANAGER` in `src/uniswap/index.ts`, from `@uniswap/sdk-core`                                    |

Morpho pins VaultBundlesV1's referral fee to zero and, without a `label`, looks
up the vaults' names on the [Morpho API](https://api.morpho.org/graphql). The
other presets make no network calls.

Derive trades off chain: an EOA session key signs the orders, so the Derive
presets bound the keys, not the orders. `derive.sessionKeys` refuses scopes
that hand out funds or rights (admin, transfers to other owners, child keys,
liquidations, curator rights) and never lets a key's subaccount list be empty,
since that means every subaccount. Withdrawals only ever pay the avatar, and a
Safe-owned account's withdrawal whitelist stays empty, so keys can't pay out.

Subaccounts are chosen up front. `derive.deposit` creates new ones only with
`newSubaccounts` (the first deposit needs it); without it, deposits go to the
listed `subaccounts` only. Session keys only ever act on listed subaccounts
and can't create new ones. A key acts on one or several of them and, when a
role lists several, may move collateral and positions between them. To rule
out transfers, use `derive.sessionKeys` once for each subaccount: each key
then acts on a single one.

```ts
derive.sessionKeys({
  chain: 1,
  keys: [desk],
  scopes: DERIVE_SCOPES.fullDesk,
  subaccounts: [optionsBook, perpHedge],
  expiresBefore: new Date('2027-01-01'),
})
```

The Derive app works through Pilot. It makes its session key in the browser
and registers it with the `admin` scope on every subaccount, and Pilot
rewrites that to trading and withdrawals (`DERIVE_SCOPES.app`) on the avatar's
subaccounts, plus transfers if it has several. The app's expiry stays. A role
for it leaves out `keys`, since the key is new each time, and should list all
of the avatar's subaccounts:

```ts
derive.sessionKeys({
  chain: 1,
  scopes: DERIVE_SCOPES.app,
  subaccounts: [optionsBook, perpHedge],
})
```

Without `keys`, a member can hand trading to any key, including someone
else's. The app also signs in with the Safe, which these presets don't allow;
see [Derive through Zodiac Pilot](#derive-through-zodiac-pilot).

Derive vaults are unsupported. Anyone can create and curate one, and the
curator mints shares at a price it quotes, so a key that may deposit into
vaults could hand the avatar's funds to an attacker's vault. A session key's
data names no vault, so Roles can't limit which ones it uses. Vault deposits
are signed off chain only, so `derive.sessionKeys` refuses all vault scopes
(17–22) and the avatar can't hold vault shares.

### Derive through Zodiac Pilot

A role member can use the Derive app (derive.xyz, or testnet.derive.xyz on
Sepolia) with Zodiac Pilot, acting as the avatar. Pilot needs
zodiaceco/zodiac-os#5712 for the sign-in and zodiaceco/zodiac-os#5702 for
_Enable trading_. Set up in this order:

1. **Deploy a role with `derive.deposit` and `newSubaccounts`.** No
   subaccounts exist yet, so nothing else can be listed.
2. **Sign in through an owner route, with instant execution on.** The app
   signs in by asking the avatar to sign a message (SIWE). A Safe signs it on
   chain, with a delegatecall to `SignMessageLib`, which the presets don't
   allow. So pick a route that executes as a Safe owner. Before signing, click
   the record dot in Pilot to switch to _Instant execution_: Derive checks the
   signature against the chain straight away, so the message must be signed
   on chain before Pilot answers. When recording a batch, Pilot answers once
   the message is signed in its simulation, and Derive rejects the signature. The sign-in is remembered, so
   this is needed once.
3. **Deposit from the app through the role.** The first deposit creates the
   subaccount for the avatar, and each further deposit into a new subaccount
   needs its manager in `newSubaccounts`.
4. **List the subaccounts in the role.** Read their IDs from the app or from
   Derive's `public/get_subaccounts`, then add `derive.sessionKeys` with
   `DERIVE_SCOPES.app`, `derive.withdraw` and `subaccounts` to `derive.deposit`,
   and redeploy.
5. **Enable trading through the role.** The app registers its new session key
   with `admin` on every subaccount. Pilot rewrites it to the scopes the role
   allows, keeping the app's expiry.

Withdrawals pay Derive's fee in ETH (`send: true`), so the avatar needs a
little ETH. Trading itself is signed by the session key and needs no
transactions.

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
   with `simulate()` from `src/test/simulate.ts`. It scopes a Roles v2.1.1 mod
   on a simulated Safe with your presets and sends each case through it: the
   intended flows must execute against the real protocol contracts, and every
   call that would hand funds or rights to someone else must stop at the Roles
   mod. Nothing is sent.

## Development

| Command           | What it does                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `bun install`     | Install dependencies                                                                                                |
| `bun codegen`     | Regenerate the kit types from the ABIs                                                                              |
| `bun test`        | Run the tests                                                                                                       |
| `bun test:sim`    | Run the simulations against chain state (needs an RPC with `eth_simulateV1`; `RPC_<chainId>` overrides the default) |
| `bun check:types` | Type-check                                                                                                          |
| `bun fix:format`  | Format with Prettier                                                                                                |
| `bun run build`   | Build `dist/` (ESM and type declarations)                                                                           |

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
