import { expect } from 'bun:test'
import type { Permission } from 'zodiac-roles-sdk'
import { processPermissions } from 'zodiac-roles-sdk'

/**
 * Expects `ours` to grant exactly what DeFi Kit's `theirs` grants: the same
 * targets, functions and conditions, whatever order and grouping they come in.
 */
export const expectSamePermissions = (
  ours: readonly unknown[],
  theirs: readonly unknown[]
) => {
  expect(normalize(ours)).toEqual(normalize(theirs))
}

const normalize = (permissions: readonly unknown[]) =>
  processPermissions(permissions as Permission[])
    .targets.map((target) => ({
      ...target,
      address: target.address.toLowerCase(),
      functions: [...target.functions].sort((a, b) =>
        a.selector.localeCompare(b.selector)
      ),
    }))
    .sort((a, b) => a.address.localeCompare(b.address))
