# Zodiac Presets

Reusable permission presets for [Zodiac](https://zodiac.eco) constellations.
Each preset is a labelled permission entry you drop into a role's
`permissions`, for protocol flows the SDK's built-in actions don't cover.

```sh
bun add @zodiaceco/presets
```

```ts
// constellation/roles/curator/permissions.ts
import { morphoDeposit, morphoWithdraw } from '@zodiaceco/presets'

const vaults = ['0xbeeff1D5dE8F79ff37a151681100B039661da518'] as const // Bitget x Steakhouse USDC

export default [
  // Labelled "Deposit into Morpho vault: Bitget x Steakhouse USDC"
  await morphoDeposit({
    chain: 42161,
    asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    vaults,
  }),
  await morphoWithdraw({ chain: 42161, vaults, label: 'Withdraw USDC' }),
] satisfies Permissions
```

Presets that look something up are async, so `await` them. A role's
permissions file is an ES module, so top-level `await` works there.

## Presets

| Preset           | What it allows                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `morphoDeposit`  | Deposit into Morpho vaults (V1 and V2) that share one asset, straight into the vault or through VaultBundlesV1 the way the Morpho app does. Shares go to the avatar. |
| `morphoWithdraw` | Withdraw from Morpho vaults, straight from the vault or through VaultBundlesV1. Assets go to the avatar.                                                             |

Both pin VaultBundlesV1's referral fee to zero. Without a `label`, they look up
the vaults' names on the [Morpho API](https://api.morpho.org/graphql). They
cover every chain where both Morpho and Zodiac are deployed: Ethereum,
Optimism, Unichain, Polygon, World Chain, HyperEVM, Base, Arbitrum and Katana
(`VAULT_BUNDLES_V1` in `src/morpho.ts`, checked against Morpho's own registry
in `@morpho-org/morpho-ts`).

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
3. Write the preset in `src/<protocol>.ts` with `custom()` from
   `@zodiaceco/sdk/actions`, building its permissions from the typed kit.
   Explain in a comment why every unconstrained parameter is safe.
   Contract addresses that differ by chain go in a map keyed by chain id,
   covering every chain the protocol and Zodiac share.
4. Export it from `src/index.ts`, add tests next to it
   (`src/<protocol>.test.ts`) and a row to the table above.

## Development

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `bun install`     | Install dependencies                      |
| `bun codegen`     | Regenerate the kit types from the ABIs    |
| `bun test`        | Run the tests                             |
| `bun check:types` | Type-check                                |
| `bun fix:format`  | Format with Prettier                      |
| `bun run build`   | Build `dist/` (ESM and type declarations) |

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
