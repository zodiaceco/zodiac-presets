// Regenerates `src/fluid/fTokens.ts`, the fTokens on every chain both Fluid
// and Zodiac are deployed on, from Fluid's own sources:
//
// - The chains and their LendingResolver come from Fluid's deployments in
//   github.com/Instadapp/fluid-contracts-public (`deployments/<network>/`).
// - The fTokens come from that LendingResolver on chain (`getAllFTokens`,
//   `getFTokenDetails`), so every fToken the LendingFactory ever deployed is
//   listed, including ones Fluid's app and API no longer show. The underlying
//   token's symbol is its own `symbol()`.
//
//   bun sync:fluid           rewrite the file
//   bun sync:fluid --check   exit 1 if the file is out of date
//
// Public RPCs are used by default; set `RPC_<chainId>` to use another.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CHAIN_IDS } from '@zodiaceco/sdk/allow'
import { Contract, getAddress, JsonRpcProvider } from 'ethers'
import { format, resolveConfig } from 'prettier'

const OUT = fileURLToPath(new URL('../src/fluid/fTokens.ts', import.meta.url))
const REPO = 'Instadapp/fluid-contracts-public'

const RPCS: Record<number, string> = {
  1: 'https://ethereum-rpc.publicnode.com',
  56: 'https://bsc-rpc.publicnode.com',
  137: 'https://polygon-bor-rpc.publicnode.com',
  8453: 'https://base-rpc.publicnode.com',
  9745: 'https://rpc.plasma.to',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
}

// What a native-underlying fToken takes besides its wrapped token. Chains
// can't be asked for this, so a new chain with one has to be added here.
const NATIVE_SYMBOLS: Record<number, string> = {
  1: 'ETH',
  56: 'BNB',
  137: 'POL',
  8453: 'ETH',
  9745: 'XPL',
  42161: 'ETH',
}

const RESOLVER_ABI = [
  'function getAllFTokens() view returns (address[])',
  'function getFTokenDetails(address) view returns ((address tokenAddress, bool eip2612Deposits, bool isNativeUnderlying, string name, string symbol, uint256 decimals, address asset, uint256 totalAssets, uint256 totalSupply, uint256 convertToShares, uint256 convertToAssets, uint256 rewardsRate, uint256 supplyRate, int256 rebalanceDifference, (bool modeWithInterest, uint256 supply, uint256 withdrawalLimit, uint256 lastUpdateTimestamp, uint256 expandPercent, uint256 expandDuration, uint256 baseWithdrawalLimit, uint256 withdrawableUntilLimit, uint256 withdrawable, uint256 decayEndTimestamp, uint256 decayAmount) liquidityUserSupplyData))',
]

type FToken = {
  fToken: string
  asset: string
  symbol: string
  native?: string
}

const github = async (path: string, raw = false) => {
  const url = raw
    ? `https://raw.githubusercontent.com/${REPO}/main/${path}`
    : `https://api.github.com/repos/${REPO}/contents/${path}`
  const response = await fetch(url)
  if (raw && response.status === 404) return
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return raw ? response.text() : response.json()
}

type Chain = { name: string; chain: number; resolver: string }

/** Fluid's networks that Zodiac supports, with their LendingResolver. */
const fluidChains = async (): Promise<Chain[]> => {
  const zodiac = new Set<number>(Object.values(CHAIN_IDS))
  const networks = (
    (await github('deployments')) as { name: string; type: string }[]
  ).filter((entry) => entry.type === 'dir')

  const chains = await Promise.all(
    networks.map(async ({ name }): Promise<Chain | undefined> => {
      const resolver = await github(
        `deployments/${name}/LendingResolver.json`,
        true
      )
      if (resolver == null) return // no Fluid lending there
      const chain = Number(
        (await github(`deployments/${name}/.chainId`, true)).trim()
      )
      const { address } = JSON.parse(resolver) as { address: string }
      return { name, chain, resolver: getAddress(address) }
    })
  )

  return chains
    .filter((c): c is Chain => c != null && zodiac.has(c.chain))
    .sort((a, b) => a.chain - b.chain)
}

const fTokensOn = async (chain: number, resolverAddress: string) => {
  const rpc = process.env[`RPC_${chain}`] ?? RPCS[chain]
  if (rpc == null) {
    throw new Error(`No RPC for chain ${chain}: set RPC_${chain}.`)
  }
  const provider = new JsonRpcProvider(rpc, chain, { staticNetwork: true })
  const resolver = new Contract(resolverAddress, RESOLVER_ABI, provider)

  const fTokens: FToken[] = []
  for (const fToken of (await resolver.getAllFTokens()) as string[]) {
    const details = await resolver.getFTokenDetails(fToken)
    const asset = getAddress(details.asset)
    const symbol = (await new Contract(
      asset,
      ['function symbol() view returns (string)'],
      provider
    ).symbol()) as string

    let native: string | undefined
    if (details.isNativeUnderlying) {
      native = NATIVE_SYMBOLS[chain]
      if (native == null) {
        throw new Error(
          `${fToken} on chain ${chain} takes the native token: add its symbol to NATIVE_SYMBOLS.`
        )
      }
    }

    fTokens.push({ fToken: getAddress(fToken), asset, symbol, native })
  }
  return fTokens
}

const render = async (
  chains: { name: string; chain: number; fTokens: FToken[] }[]
) => {
  const body = chains
    .map(
      ({ name, chain, fTokens }) =>
        `${chain}: [ // ${name}\n${fTokens
          .map(
            ({ fToken, asset, symbol, native }) =>
              `{ fToken: '${fToken}', asset: '${asset}', symbol: ${JSON.stringify(symbol)}${native ? `, native: '${native}'` : ''} },`
          )
          .join('\n')}\n],`
    )
    .join('\n')

  const source = `// Generated by \`bun sync:fluid\` (scripts/sync-fluid.ts) from Fluid's
// deployments and its LendingResolver on each chain. Do not edit.

import type { Address } from '../kit'

/**
 * Fluid's fTokens by chain id: the fToken, the token it takes (\`asset\`) and
 * that token's symbol. \`native\` marks the fToken that also takes the chain's
 * native token, and names it.
 */
export const F_TOKENS = {
${body}
} as const satisfies Record<
  number,
  readonly { fToken: Address; asset: Address; symbol: string; native?: string }[]
>
`
  return format(source, {
    ...(await resolveConfig(OUT)),
    filepath: OUT,
  })
}

const chains = await fluidChains()
const generated = await render(
  await Promise.all(
    chains.map(async ({ name, chain, resolver }) => ({
      name,
      chain,
      fTokens: await fTokensOn(chain, resolver),
    }))
  )
)

if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => '')
  if (current !== generated) {
    console.error(`${OUT} is out of date: run \`bun sync:fluid\`.`)
    process.exit(1)
  }
  console.log(`${OUT} is up to date.`)
} else {
  await writeFile(OUT, generated)
  console.log(`Wrote ${OUT} (${chains.map((c) => c.name).join(', ')}).`)
}
