/** 输入为原始最小货币单位；只在显示时舍入，不参与业务聚合。 */
export function formatV10Money(minor: number | null | undefined, currency: string | null): string {
  if (
    minor == null ||
    !Number.isSafeInteger(minor) ||
    !currency ||
    !['CNY', 'EUR', 'USD'].includes(currency)
  )
    return '未知';
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
export function formatV10Percent(ratio: number | null | undefined): string {
  return ratio == null || !Number.isFinite(ratio) ? '不可计算' : `${(ratio * 100).toFixed(2)}%`;
}
