# Zodiac Presets

Reusable permission presets for [Zodiac](https://zodiac.eco) constellations.
Each preset is a labelled permission entry you drop into a role's
`permissions`, for protocol flows the SDK's built-in actions don't cover.

```sh
bun add @zodiaceco/presets
```

```ts
// constellation/roles/curator/permissions.ts
import { morphoVaults } from '@zodiaceco/presets'

export default [
  morphoVaults({
    label: 'Deposit USDC into Morpho',
    chain: 42161,
    asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    vaults: ['0xbeeff1D5dE8F79ff37a151681100B039661da518'], // Bitget x Steakhouse USDC
  }),
] satisfies Permissions
```

## Presets

| Preset         | What it allows                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `morphoVaults` | Deposit into and withdraw from Morpho vaults that share one asset, either through the vaults' own ERC-4626 calls or the way the Morpho app does it, through VaultBundlesV1. Every receiver and owner is the avatar, and the bundler's referral fee is zero. |

## Adding a preset

1. If the preset needs contracts the package doesn't know yet, add them to
   `zodiac.config.ts`:
   - **An ABI used at many addresses** (a token standard, a vault type, a
     contract deployed on several chains) goes under `any`, with its ABI at
     `abis/any/<name>.json`. Presets bind it to an address at call time with
     `at('<name>', address)`.
   - **A contract at one address** goes under its chain prefix
     (`arb1: { … }`); `bun codegen` fetches its ABI.
2. `bun codegen` regenerates the `Kit` types in `src/kit.generated.d.ts`.
3. Write the preset in `src/<protocol>.ts` with `custom()` from
   `@zodiaceco/sdk/actions`, building its permissions from the typed kit.
   Explain in a comment why every unconstrained parameter is safe.
4. Export it from `src/index.ts`, add tests next to it
   (`src/<protocol>.test.ts`) and a row to the table above.

## Development

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `bun install`     | Install dependencies                      |
| `bun codegen`     | Regenerate the `Kit` types from the ABIs  |
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
