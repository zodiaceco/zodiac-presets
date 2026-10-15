import { defineConfig } from '@zodiaceco/sdk/cli/config'

// Not a constellation: this config only feeds `bun codegen`, which types the
// contracts below as `AllowKit` in `src/kit.generated.d.ts`.
//
// Under the `any` key are ABIs, not deployments. Their ABIs live in
// `abis/any/` and a preset binds one to the address it's given at call time
// (see `src/kit.ts`), so the zero address here is only a placeholder.
// Contracts that only matter at one address go under their chain prefix,
// where `bun codegen` fetches their ABIs.
const ABI_ONLY = '0x0000000000000000000000000000000000000000'

export default defineConfig({
  contracts: {
    any: {
      erc20: ABI_ONLY,
      erc4626: ABI_ONLY,
      fluid_ftoken_native: ABI_ONLY,
      morpho_vault_bundles_v1: ABI_ONLY,
    },
  },
})
