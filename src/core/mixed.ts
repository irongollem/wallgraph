// Bulk-pane mixed-value detection: whether the objects a group selection
// gathers disagree on one field. Pure, so it means the same thing wherever a
// bulk pane computes it (panel.ts, stairs.ts, vide.ts, furnishing.ts) and is
// unit-testable without a DOM.
export function isMixed<T, V>(items: readonly T[], get: (item: T) => V): boolean {
  if (items.length <= 1) return false;
  const first = get(items[0]!);
  return items.some(item => get(item) !== first);
}
