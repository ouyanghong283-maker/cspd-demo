import { Activity, BASE_DATE, Project, SalesRecord, Stage } from './models';
export function needsTenderTeam(record: SalesRecord): boolean {
  return record.tender === '是' && ['A', 'S'].includes(record.grade);
}
export function isClosed(record: SalesRecord): boolean {
  return record.stage === '赢单' || record.stage === '丢单';
}
export function coolingDays(record: SalesRecord, activities: Activity[]): number {
  if (isClosed(record) || record.type === 'lead') return 0;
  const related = activities.filter(
    (a) =>
      (a.entityId === record.id || a.entityId === record.leadId) &&
      a.type !== '内部备注' &&
      a.date <= BASE_DATE,
  );
  const date =
    related
      .map((a) => a.date)
      .sort()
      .at(-1) ||
    record.convertedDate ||
    record.createdDate;
  return Math.max(0, Math.floor((Date.parse(BASE_DATE) - Date.parse(date)) / 86400000));
}
export const STAGE_WEIGHTS: Record<Stage, number> = {
  意向沟通: 0.2,
  方案报价: 0.4,
  洽谈: 0.6,
  合同谈判: 0.8,
  赢单: 0,
  丢单: 0,
};
export const GRADE_WEIGHTS: Record<string, number> = { S: 1, A: 0.9, B1: 0.7, B2: 0.5 };
export function weightedAmount(record: SalesRecord): number {
  return isClosed(record)
    ? 0
    : record.amount * STAGE_WEIGHTS[record.stage] * (GRADE_WEIGHTS[record.grade] || 0);
}
export function acceptanceReady(p: Project, hasEvidence: boolean): boolean {
  return (
    hasEvidence &&
    p.acceptance.length > 0 &&
    p.acceptance.every((a) => a.result === '通过' && !!a.signer && !!a.date)
  );
}
export function validDateRange(start: string, end: string): boolean {
  return (
    !!start &&
    !!end &&
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    start <= end
  );
}
