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
| `gmx.trade`                | Open and close positions in listed GMX markets through the SubaccountRouter, with caps on collateral, size and the execution fee. No swaps, no callbacks.                         |
| `gmx.ownSubaccount`        | Register the avatar as its own GMX subaccount, which `gmx.trade` needs, with an expiry and action-count cap.                                                                      |
| `gmx.deposit`              | Deposit tokens into listed GM markets and GLVs, every token transfer within an allowance.                                                                                         |
| `gmx.withdraw`             | Withdraw from listed GM markets and GLVs to the avatar, every pool-token transfer within an allowance.                                                                            |
| `gmx.tradingKeys`          | Register EOAs as GMX subaccounts (one-click trading): listed keys, expiry, lifetime action count and gas top-up caps.                                                             |
| `gmx.revoke`               | Remove any subaccount, cancel orders and set Router approvals to 0.                                                                                                               |
| `gmx.claim`                | Claim funding fees, claimable collateral and GMX distributions to the avatar.                                                                                                     |
| `morpho.deposit`           | Deposit into Morpho vaults (V1 and V2) that share one asset, straight into the vault or through VaultBundlesV1 the way the Morpho app does.                                       |
| `morpho.withdraw`          | Withdraw from Morpho vaults, straight from the vault or through VaultBundlesV1.                                                                                                   |
| `pendle.buyPt`             | Buy Pendle PT in listed markets with listed tokens, straight into the SY (no aggregator, no limit-order fills), with an optional allowance per token.                             |
| `pendle.sellPt`            | Sell PT for tokens the SY pays out, to the avatar.                                                                                                                                |
| `pendle.redeem`            | Redeem PT (after the expiry, PT alone) for tokens the SY pays out, to the avatar; for markets already expired also the exit Pendle's app uses (PT and LP in one call).            |
| `pendle.addLiquidity`      | Add liquidity to listed markets with listed tokens, LP to the avatar.                                                                                                             |
| `pendle.removeLiquidity`   | Remove liquidity, before or after the expiry, to the avatar.                                                                                                                      |
| `pendle.exit`              | Exit PT, YT and LP in one call before the expiry, the default of the app's Withdraw tab: burn LP, redeem PT and YT in pairs, sell the rest, pay the avatar.                       |
| `pendle.buyYt`             | Buy YT in listed markets with listed tokens.                                                                                                                                      |
| `pendle.sellYt`            | Sell YT for tokens the SY pays out, to the avatar.                                                                                                                                |
| `pendle.claim`             | Claim YT interest and SY and LP rewards, paid to the avatar, also the way the app claims (V2, YT interest paid out as a token, no swaps).                                         |
| `uniswap.deposit`          | Open Uniswap v3 positions for given tokens and fee tiers, or add to given positions.                                                                                              |
| `uniswap.withdraw`         | Remove liquidity and collect fees from the avatar's positions.                                                                                                                    |

Without a `label`, each preset derives one from its inputs.

| Protocol   | Chains                                                                                                                                          | Addresses                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Aave v3    | Ethereum (Core, Prime, EtherFi), Optimism, BNB, Gnosis, Polygon, Sonic, MegaETH, Mantle, Base, Plasma, Arbitrum, Celo, Avalanche, Linea, Scroll | `AAVE_V3` in `src/aave/markets.ts`, from `@bgd-labs/aave-address-book`                                                                       |
| Derive V3  | Ethereum                                                                                                                                        | `DERIVE` and `DERIVE_ASSETS` in `src/derive/index.ts`, read on chain with `WithdrawalOutbox.resolveAsset`                                    |
| Fluid      | Ethereum, BNB, Polygon, Base, Plasma, Arbitrum                                                                                                  | `F_TOKENS` in `src/fluid/fTokens.ts`, read on chain by `bun sync:fluid`                                                                      |
| GMX v2     | Arbitrum, Avalanche, MegaETH                                                                                                                    | `GMX` in `src/gmx/index.ts`, read on chain; `bun test:sim` checks it against GMX's RoleStore                                                 |
| Morpho     | Ethereum, Optimism, Unichain, Polygon, World Chain, HyperEVM, Base, Arbitrum, Katana                                                            | `VAULT_BUNDLES_V1` in `src/morpho/index.ts`, from `@morpho-org/morpho-ts`                                                                    |
| Pendle V2  | Ethereum, Optimism, BNB, Unichain, Sonic, HyperEVM, Mantle, Base, Plasma, Arbitrum, Berachain                                                   | `PENDLE` in `src/pendle/chains.ts`, from Pendle's deployments, routers checked on chain by `bun sync:pendle`; markets from `pendleMarkets()` |
| Uniswap v3 | Every chain with a v3 position manager that Zodiac supports                                                                                     | `POSITION_MANAGER` in `src/uniswap/index.ts`, from `@uniswap/sdk-core`                                                                       |

Morpho pins VaultBundlesV1's referral fee to zero and, without a `label`, looks
up the vaults' names on the [Morpho API](https://api.morpho.org/graphql). The
other presets make no network calls.

GMX executes requests later, through keepers, and a GMX vault credits its
tokens to the next request that asks for them, from any account. Roles v2
can't check the GMX interface's multicall call by call (all elements of an
array must have the same type tree), so `gmx.trade` goes through
`SubaccountRouter.createOrder`, which pulls the collateral and creates the
order in one call, with the avatar registered as its own subaccount
(`gmx.ownSubaccount`). GM and GLV have no such call: `gmx.deposit` and
`gmx.withdraw` allow the token transfers as separate calls, so each one needs
an allowance, which is the most a member can strand in a vault. Trading keys
(`gmx.tradingKeys`) trade without Roles: GMX forces their receiver to the
avatar, but they pick market, size and leverage, and pull collateral through
the avatar's Router approval.

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
subaccounts, plus transfers if it has several. The app's expiry stays. A role for it leaves out `keys`, since
the key is new each time, and should list all of the avatar's subaccounts:

```ts
derive.sessionKeys({
  chain: 1,
  scopes: DERIVE_SCOPES.app,
  subaccounts: [optionsBook, perpHedge],
})
```

Without `keys`, a member can hand trading to any key, including someone
else's. The app also signs in with the Safe (SIWE, checked through ERC-1271),
which these presets don't allow: sign in once while setting up the role.

Derive vaults are unsupported. Anyone can create and curate one, and the
curator mints shares at a price it quotes, so a key that may deposit into
vaults could hand the avatar's funds to an attacker's vault. A session key's
data names no vault, so Roles can't limit which ones it uses. Vault deposits
are signed off chain only, so `derive.sessionKeys` refuses all vault scopes
(17–22) and the avatar can't hold vault shares.

Pendle markets expire, so the Pendle presets take them as a parameter.
`pendleMarkets()` reads them from Pendle's API, by name among the active ones
or by address (expired ones too, to redeem):

```ts
import { pendle, pendleMarkets } from '@zodiaceco/presets'

const USDE = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3'
const SUSDE = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497'
const markets = await pendleMarkets({ chain: 1, names: ['sUSDe'] })

export default [
  pendle.buyPt({
    chain: 1,
    markets,
    tokens: [{ token: USDE, allowance: 'pendle_usde' }, { token: SUSDE }],
  }),
  pendle.sellPt({ chain: 1, markets, tokens: [SUSDE] }),
  pendle.redeem({ chain: 1, markets, tokens: [SUSDE] }),
] satisfies Permissions
```

Keep a market in the list until the avatar holds none of its PT, YT or LP:
after the expiry, swaps revert, `pendle.redeem` takes PT alone and
`pendle.removeLiquidity` still works. The presets pay tokens into the SY
directly (the chain's wrapped native token may also be unwrapped first, the
way Pendle's own API pays WETH into an SY that takes ETH) and refuse
aggregator routes and limit-order fills. Pendle's Convert API
(`/core/v2/sdk/<chain>/convert`) builds calls they accept with
`enableAggregator=false&useLimitOrder=false`; with its default
`useLimitOrder=true` it fills limit orders, which the presets refuse. In a
recording from October 2026, app.pendle.finance filled limit orders whenever
its order book matched the trade, with no setting to turn that off, and took
an aggregator route when that paid more, even for a token the SY takes, until
all four aggregators were unticked in its settings. Its Withdraw tab exits PT,
YT and LP with `exitPreExpToToken` and claims in the same `multicall`. Roles
can't scope the calls inside a multicall, so a member needs Zodiac Pilot to
unfold it into its calls, which `pendle.exit` and `pendle.claim` allow. To
redeem after the expiry it called `exitPostExpToToken`. That function doesn't
check the expiry, and before it, it leaves PT in the YT contract for whoever
redeems next, so `pendle.redeem` allows it only for markets that had expired
when the preset was built: build it again after a market expires.

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
