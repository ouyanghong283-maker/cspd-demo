/** 元来源转换为安全整数分；缺值不能被强制转换为0。 */
export function minor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 0.001 ? cents : null;
}
export function total(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  const result = values.reduce<bigint>((n, v) => n + BigInt(v!), 0n);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) && result >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(result)
    : null;
}
