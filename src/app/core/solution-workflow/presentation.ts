const businessTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
export function formatSolutionTime(timestamp: string | null | undefined): string {
  return timestamp && Number.isFinite(Date.parse(timestamp))
    ? businessTimeFormatter.format(new Date(timestamp))
    : '时间待核';
}
