import { c } from '@zodiaceco/sdk'
import { custom } from '@zodiaceco/sdk/actions'
import { at, type Address } from '../kit'
import { list, oneOf } from '../utils'

// Derive V3 (derive.xyz): an options, perps and spot exchange that matches off
// chain and settles on Ethereum, proven by a zkVM. A Safe owns its Derive
// account directly and acts on it only through the OnchainActionManager:
// deposits, session keys and withdrawals. Trading itself is signed off chain
// by an EOA session key the Safe registers, with the protocol scopes it gives
// that key. Derive accepts ECDSA signatures only, so the Safe can't sign
// orders itself.
//
// The OnchainActionManager (verified source on Sourcify) checks none of what
// it queues: not who owns a subaccount, not a session key's scopes, not a
// withdrawal's recipient. It records `msg.sender` and Derive's sequencer
// applies the action later. So these presets are the only on-chain check:
// every owner, fallback recipient and payout recipient is pinned to the
// avatar, and session keys only get trading and withdrawals on listed
// subaccounts, and transfers between them.
//
// What stays outside Roles: the orders a session key signs. A key can lose
// money through trades within its scopes, but can't pay anything out: a
// Safe-owned account's withdrawal whitelist is empty, and only an owner
// signature or an admin key can fill it.

/** The OnchainActionManager (proxy), by chain id. */
export const DERIVE = {
  1: '0xE366CcA474968e33b777E13905829A3b800CFAD3', // Ethereum
} as const satisfies Record<number, Address>

export type DeriveChain = keyof typeof DERIVE

/**
 * Collateral by symbol: the protocol asset `label` that `deposit` and
 * `withdraw` take (an identifier, not a contract), and the ERC-20 `token` the
 * ActionManager pulls. Read with `WithdrawalOutbox.resolveAsset(label)`;
 * Derive lists them under `public/get_risk_universes`.
 */
export const DERIVE_ASSETS = {
  1: {
    USDC: {
      label: '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b',
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    ETH: {
      label: '0xE201fCEfD4852f96810C069f66560dc25B2C7A55',
      token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    },
    WSTETH: {
      label: '0x69c7AADFfD607F74eE610f047f552CaDecabca4E',
      token: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    },
    WEETH: {
      label: '0xF30EE744fCfd135A135E6a4e327e01d0f697e6Ec',
      token: '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee',
    },
    SUSDE: {
      label: '0x375804CdcF0D534FDD2657584A7c4Ff5AB14A2bb',
      token: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    },
    DRV: {
      label: '0x1Abdb2896e57047fD989af7B3Ee6B7e81830F8D2',
      token: '0xB1D1eae60EEA9525032a6DCb4c1CE336a1dE71BE',
    },
  },
} as const satisfies Record<
  DeriveChain,
  Record<string, { label: Address; token: Address }>
>

export type DeriveAsset = keyof (typeof DERIVE_ASSETS)[1]

/**
 * Session-key scope codes, as Derive numbers them (derive-ts
 * `src/auth/scopes.ts`). A parent scope grants its children: `admin` grants
 * everything, each `…All` its branch.
 */
export const DERIVE_SCOPE = {
  admin: 0,
  withdraw: 1,
  tradeAll: 2,
  tradeOrderbookAll: 3,
  tradeOrderbookSpot: 4,
  tradeOrderbookPerp: 5,
  tradeOrderbookOption: 6,
  tradeRfqAll: 7,
  tradeRfqSpot: 8,
  tradeRfqPerp: 9,
  tradeRfqOption: 10,
  transferAll: 11,
  transferExistingSubaccount: 12,
  transferNewSubaccount: 13,
  transferDifferentOwner: 14,
  setSessionKey: 15,
  liquidate: 16,
  vaultAll: 17,
  vaultCuratorCreate: 18,
  vaultCuratorMintAndBurn: 19,
  vaultUserDeposit: 20,
  vaultUserWithdraw: 21,
  vaultUserCancel: 22,
} as const

/**
 * Scope sets for common desks. `derive.sessionKeys` adds transfers between
 * the listed subaccounts when there are several.
 */
export const DERIVE_SCOPES = {
  /**
   * What Pilot registers for the Derive app: all trading, and withdrawals,
   * which a key can only pay to the avatar.
   */
  app: [1, 2],
  optionsDesk: [6, 10],
  perpHedge: [5, 9],
  spotAndBasis: [4, 8],
  marketMaker: [4, 5, 6],
  /** Orderbook and RFQ in options, perps and spot. */
  fullDesk: [4, 5, 6, 8, 9, 10],
} as const

// Anyone can create and curate a Derive vault, and the curator mints the shares
// at a price it quotes. A key's data names no vault, so Roles can't keep a key
// with the deposit scope away from an attacker's vault. Vault deposits are
// signed off chain only, so without that scope a Safe can't hold shares, and
// the withdraw and cancel scopes have nothing to act on.
const VAULTS_UNSUPPORTED =
  'Derive vaults are unsupported: Roles can’t pin which vault a key deposits into'

// Scopes a preset never grants, and why.
const REFUSED_SCOPES: Record<number, string> = {
  0: 'admin grants everything, including filling the withdrawal whitelist',
  11: 'transferAll includes transfers to other owners',
  14: 'transfers to other owners move funds out of the account',
  13: 'new subaccounts are outside every listed subaccount: create them with `derive.deposit`',
  15: 'setSessionKey lets the key create more keys',
  16: 'liquidate takes on other accounts’ positions',
  17: 'vaultAll includes curator rights',
  18: 'curator rights manage other people’s funds',
  19: 'curator rights manage other people’s funds',
  20: VAULTS_UNSUPPORTED,
  21: VAULTS_UNSUPPORTED,
  22: VAULTS_UNSUPPORTED,
}

// Set Session Key: `submit(51, abi.encode(key, expirySec, scopes, subaccountIds))`.
// Expiry 0 deletes the key; an empty `subaccountIds` means every current and
// future subaccount.
const SET_SESSION_KEY = 51
const SESSION_KEY_DATA = ['address', 'uint256', 'uint256[]', 'uint256[]']

type Subaccounts = readonly [bigint, ...bigint[]]

export type DeriveDepositParams = {
  /** Defaults to e.g. "Deposit USDC and ETH into Derive". */
  label?: string
  chain: DeriveChain
  tokens: readonly [DeriveDepositToken, ...DeriveDepositToken[]]
  /**
   * Let a deposit create a new subaccount, with one of these margin managers.
   * The first deposit creates the account this way. Each manager fixes a risk
   * universe: 1 and 5 PRIME (BTC, ETH), 2 and 6 MIDCAP, 3 and 7 ALT, 4 and 8
   * RWA, the first of each pair standard margin, the second portfolio margin.
   * Leave it out to deposit into `subaccounts` only.
   */
  newSubaccounts?: { managers: readonly [number, ...number[]] }
  /**
   * The avatar's existing subaccounts, for later deposits. Read them with
   * Derive's `public/get_subaccounts`.
   */
  subaccounts?: Subaccounts
}

export type DeriveDepositToken = {
  asset: DeriveAsset
  /**
   * Smallest deposit, in the token's units. Derive donates deposits below
   * its `min_deposit_usd` to its security module.
   */
  minimum: bigint
  /** Key of an allowance on the same Roles mod that caps the deposits. */
  allowance?: string
}

export type DeriveWithdrawParams = {
  /** Defaults to e.g. "Withdraw USDC from Derive". */
  label?: string
  chain: DeriveChain
  assets: readonly [DeriveAsset, ...DeriveAsset[]]
  subaccounts: Subaccounts
  /** Highest fee Derive may take per withdrawal, in USD. */
  maxFeeUsd: number
}

export type DeriveSessionKeysParams = {
  /** Defaults to "Register Derive session keys". */
  label?: string
  chain: DeriveChain
  /**
   * EOAs that may become session keys. Leave it out to allow any key, which
   * the Derive app needs: it creates its key in the browser. Whoever holds a
   * key trades within `scopes`, so members could then hand trading to anyone.
   */
  keys?: readonly [Address, ...Address[]]
  /** Scope codes, e.g. `DERIVE_SCOPES.optionsDesk`. */
  scopes: readonly number[]
  /**
   * The avatar's existing subaccounts the keys may act on. A key acts on one
   * or several of them, and may move collateral and positions between them
   * (`transferExistingSubaccount`).
   */
  subaccounts: Subaccounts
  /** Latest expiry a key may get. Leave it out for no limit. */
  expiresBefore?: Date
}

/**
 * Fund the avatar's Derive account: into new subaccounts the avatar owns
 * (`newSubaccounts`, which the first deposit needs), or into its existing
 * `subaccounts`.
 */
const deposit = ({
  label,
  chain,
  tokens,
  newSubaccounts,
  subaccounts,
}: DeriveDepositParams) => {
  if (!newSubaccounts && !subaccounts) {
    throw new Error('Derive deposits need `newSubaccounts` or `subaccounts`')
  }

  const actionManager = at('derive_onchain_action_manager', DERIVE[chain])

  return custom({
    label: label ?? `Deposit ${list(tokens.map((t) => t.asset))} into Derive`,
    permissions: tokens.flatMap(({ asset, minimum, allowance }) => {
      if (minimum <= 0n) {
        throw new Error(
          `Derive deposits of ${asset} need a minimum above zero: Derive donates deposits below its own minimum`
        )
      }

      const { label: assetLabel, token } = DERIVE_ASSETS[chain][asset]
      const amount = allowance
        ? c.and(c.gte(minimum), c.withinAllowance(allowance))
        : c.gte(minimum)

      return [
        at('erc20', token).approve(DERIVE[chain]),
        // Creates a subaccount, and the account with the first. The owner
        // is free in the contract, so it's pinned; an unknown manager only
        // lands the funds in the avatar's idle fallback subaccount, but it's
        // pinned anyway.
        ...(newSubaccounts
          ? [
              actionManager.depositToNewSubaccount(
                assetLabel,
                amount,
                oneOf(newSubaccounts.managers),
                c.avatar // owner
              ),
            ]
          : []),
        // A deposit into someone else's subaccount would gift them the funds,
        // and a failed one lands with `fallbackRecipient`.
        ...(subaccounts
          ? [
              actionManager.deposit(
                assetLabel,
                amount,
                oneOf(subaccounts),
                c.avatar // fallbackRecipient
              ),
            ]
          : []),
      ]
    }),
  })
}

/**
 * Withdraw from the avatar's subaccounts to the avatar. Each withdrawal costs
 * exactly 0.002 ETH, which the ActionManager enforces.
 */
const withdraw = ({
  label,
  chain,
  assets,
  subaccounts,
  maxFeeUsd,
}: DeriveWithdrawParams) =>
  custom({
    label: label ?? `Withdraw ${list([...assets])} from Derive`,
    permissions: [
      at('derive_onchain_action_manager', DERIVE[chain]).withdraw(
        {
          subaccountId: oneOf(subaccounts),
          protocolAsset: oneOf(
            assets.map((asset) => DERIVE_ASSETS[chain][asset].label)
          ),
          // USD with 18 decimals; Derive requires a multiple of 1e6.
          maxFeeUsdE18: c.lte(BigInt(Math.round(maxFeeUsd * 1e6)) * 10n ** 12n),
          // The contract pays any recipient the owner names.
          recipient: c.avatar,
          // amountInUnderlying and forceBatch (faster proving for a higher
          // fee, capped above) can't send funds anywhere else.
        },
        { send: true }
      ),
    ],
  })

/**
 * Register session keys that trade for the avatar. Each key is one of `keys`
 * (or any key), gets only `scopes`, acts on some of `subaccounts` and expires
 * before `expiresBefore` (if given).
 */
const sessionKeys = ({
  label,
  chain,
  keys,
  scopes,
  subaccounts,
  expiresBefore,
}: DeriveSessionKeysParams) => {
  if (scopes.length === 0) throw new Error('Derive session keys need scopes')

  for (const scope of scopes) {
    if (scope in REFUSED_SCOPES) {
      throw new Error(
        `Derive scope ${scope} is not allowed: ${REFUSED_SCOPES[scope]}`
      )
    }
    if (!Object.values(DERIVE_SCOPE).includes(scope as never)) {
      throw new Error(`Unknown Derive scope ${scope}`)
    }
  }

  return custom({
    label: label ?? 'Register Derive session keys',
    permissions: [
      at('derive_onchain_action_manager', DERIVE[chain]).submit(
        SET_SESSION_KEY,
        c.abiEncodedMatches(
          [
            keys ? oneOf(keys) : undefined,
            expiresBefore
              ? c.lte(BigInt(Math.floor(expiresBefore.getTime() / 1000)))
              : undefined,
            c.every(
              oneOf(
                subaccounts.length > 1
                  ? [
                      ...new Set([
                        ...scopes,
                        DERIVE_SCOPE.transferExistingSubaccount,
                      ]),
                    ]
                  : scopes
              )
            ),
            keySubaccounts(subaccounts),
          ],
          SESSION_KEY_DATA
        )
      ),
    ],
  })
}

/**
 * The subaccounts a key acts on: one to `subaccounts.length` of them. An empty
 * list would mean every current and future subaccount, and `c.every` alone
 * accepts it, so each allowed length is spelled out (`c.matches` fixes the
 * length).
 */
const keySubaccounts = (subaccounts: Subaccounts) => {
  const id = oneOf(subaccounts)

  return oneOf(
    Array.from({ length: subaccounts.length }, (_, i) =>
      c.matches(Array.from({ length: i + 1 }, () => id))
    )
  )
}

/**
 * Delete any of the avatar's session keys (Set Session Key with expiry 0),
 * the only way to revoke one. Safe to hand to many people.
 */
const revokeSessionKeys = ({
  label,
  chain,
}: {
  /** Defaults to "Revoke Derive session keys". */
  label?: string
  chain: DeriveChain
}) =>
  custom({
    label: label ?? 'Revoke Derive session keys',
    permissions: [
      at('derive_onchain_action_manager', DERIVE[chain]).submit(
        SET_SESSION_KEY,
        c.abiEncodedMatches(
          [undefined, 0, undefined, undefined],
          SESSION_KEY_DATA
        )
      ),
    ],
  })

export const derive = { deposit, withdraw, sessionKeys, revokeSessionKeys }
