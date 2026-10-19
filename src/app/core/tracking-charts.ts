import { daysBetweenISO } from './rules';

export interface TrackingChartRow {
  key: string;
  project: { id: string; name: string };
  kind: string;
  basisDate?: string;
}
const categories = [
  { kind: '延期', label: '已逾期', color: '#ce5555' },
  { kind: '临近到期', label: '临期', color: '#d69b2d' },
  { kind: '日期待补', label: '日期待补', color: '#91a0b4' },
  { kind: '预警待设置', label: '预警待设置', color: '#b1bbc9' },
  { kind: '已完成（逾期）', label: '逾期完成', color: '#51a080' },
  { kind: '财务', label: '应收逾期', color: '#8068b4' },
];

/** 图表只消费列表当前可见事项，按稳定key去重，避免图表和表格口径分离。 */
export function buildTrackingCharts(input: readonly TrackingChartRow[], observationDate: string) {
  const rows = [...new Map(input.map((row) => [row.key, row])).values()];
  const total = rows.length;
  const risks = categories.map((category) => ({
    ...category,
    count: rows.filter((row) => row.kind === category.kind).length,
  }));
  let position = 0;
  const gradient = risks
    .filter((risk) => risk.count)
    .map((risk) => {
      const start = position;
      position += (risk.count / Math.max(total, 1)) * 100;
      return `${risk.color} ${start}% ${position}%`;
    });
  const projects = [...new Map(rows.map((row) => [row.project.id, row.project])).values()]
    .map((project) => {
      const items = rows.filter((row) => row.project.id === project.id);
      return {
        ...project,
        total: items.length,
        risks: risks.map((risk) => ({
          ...risk,
          count: items.filter((row) => row.kind === risk.kind).length,
        })),
      };
    })
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const due = [
    { label: '已过期', count: 0, color: '#ce5555' },
    { label: '今天到期', count: 0, color: '#d69b2d' },
    { label: '未来1–7天', count: 0, color: '#6488cb' },
    { label: '7天以后', count: 0, color: '#91afdb' },
    { label: '日期待补', count: 0, color: '#91a0b4' },
  ];
  for (const row of rows) {
    if (row.kind === '财务' || row.kind === '已完成（逾期）') continue;
    const days = daysBetweenISO(observationDate, row.basisDate || '');
    const index = days === undefined ? 4 : days < 0 ? 0 : days === 0 ? 1 : days <= 7 ? 2 : 3;
    due[index].count++;
  }
  return {
    total,
    risks,
    projects,
    due,
    gradient: gradient.length ? `conic-gradient(${gradient.join(',')})` : '#e9eef5',
    projectMax: Math.max(1, ...projects.map((project) => project.total)),
    dueMax: Math.max(1, ...due.map((bucket) => bucket.count)),
  };
}
