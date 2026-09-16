import { readSetLedger, type SetLedgerValue } from '../ledger-decoding'

export type VaryParams = Set<string>

export function readVaryParams(
  value: SetLedgerValue<string> | null | undefined,
  rootValue: SetLedgerValue<string> | null | undefined
): VaryParams | null {
  if (value == null || (!process.env.__NEXT_LEDGERS && rootValue == null)) {
    return null
  }
  const total = readSetLedger(value)
  if (process.env.__NEXT_LEDGERS) {
    return total
  }

  // Userspace tracking sends root params once for the entire response. Built-in
  // captures already include the root-param reads that belong to their scope.
  if (rootValue == null || total === null) {
    return null
  }
  const rootTotal = readSetLedger(rootValue)
  if (rootTotal === null) {
    return null
  }
  for (const name of rootTotal) {
    total.add(name)
  }
  return total
}
