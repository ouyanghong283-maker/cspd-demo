/** 底层稳定ID索引；保存适配不依赖只读查询出口。 */
export function stableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    if (!stableId(row.id)) continue;
    const matches = index.get(row.id) ?? [];
    matches.push(row);
    index.set(row.id, matches);
  }
  return index;
}
