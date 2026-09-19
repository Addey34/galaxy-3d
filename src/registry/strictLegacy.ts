/** Comparaison du témoin figé et du registre : valeurs, bits et ordre de toutes les clés. */
export function compareStrict(
  actual: unknown,
  expected: unknown,
  where = 'root'
): void {
  if (actual instanceof Date || expected instanceof Date) {
    if (
      !(actual instanceof Date) ||
      !(expected instanceof Date) ||
      !Object.is(actual.getTime(), expected.getTime())
    )
      throw new Error(`${where}: date différente`);
    return;
  }
  if (
    actual !== null &&
    expected !== null &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
      throw new Error(
        `${where}: ordre/clés ${actualKeys.join(',')} ≠ ${expectedKeys.join(',')}`
      );
    for (const key of expectedKeys)
      compareStrict(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${where}.${key}`
      );
    return;
  }
  if (!Object.is(actual, expected))
    throw new Error(`${where}: valeur différente`);
}
