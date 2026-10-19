import type { DemoState } from './models';

export const V8_STORAGE_SCHEMA_VERSION = 2;

/** 只迁移存储结构和可追溯来源，不创建合同、项目、文件或业务完成事实。 */
export function migrateV8Snapshot(input: DemoState): DemoState {
  if ((input.storageSchemaVersion || 0) > V8_STORAGE_SCHEMA_VERSION)
    throw new Error('快照来自更高版本，不能降级迁移');
  const state = structuredClone(input);
  if (state.storageSchemaVersion === V8_STORAGE_SCHEMA_VERSION) return state;
  state.storageSchemaVersion = V8_STORAGE_SCHEMA_VERSION;
  if (state.dateMode === undefined) state.dateMode = 'normal';
  for (const key of ['contractMilestones', 'contractFileVersions', 'planWarningReads'] as const) {
    if (state[key] === undefined) Object.assign(state, { [key]: [] });
    else if (!Array.isArray(state[key])) throw new Error(`旧快照 ${key} 不是合法集合，原数据保留`);
  }
  const review = (entityType: string, entityId: string, relation: string, reason: string) => {
    const rows = (state.migrationReviewItems ||= []);
    const id = `V8-MIGRATION-${entityType}-${entityId}-${relation}`;
    if (!rows.some((row) => row.id === id))
      rows.push({ id, entityType, entityId, relation, reason });
  };
  for (const project of state.projects)
    for (const plan of project.plans) {
      if (plan.warningLeadDays === undefined || plan.warningLeadDays === null)
        review(
          'projectPlan',
          `${project.id}/${plan.id}`,
          'warningLeadDays',
          '旧计划预警天数待补；保留原缺失或显式空值，不默认0或7。',
        );
      if (
        plan.type === '内部WBS' &&
        (plan.budgetAmount === undefined || plan.budgetAmount === null || !plan.budgetCurrency)
      )
        review(
          'projectPlan',
          `${project.id}/${plan.id}`,
          'budget',
          '旧WBS预算待补；不从回款金额推算，不把缺失视为0。',
        );
    }
  for (const contract of state.contracts) {
    const series = (state.quoteSeries || []).find((row) => row.id === contract.quoteSeriesId);
    const version = series?.versions.find(
      (row) => row.id === contract.quoteVersionId && row.seriesId === series.id,
    );
    if (
      !version ||
      !series ||
      series.opportunityId !== contract.opportunityId ||
      version.customerId !== contract.customerId
    )
      review(
        'contract',
        contract.id,
        'quoteReference',
        '旧合同报价来源待核；保留原引用，不按报价号、最新版本或相似关系补造。',
      );
    if (contract.status !== '草稿' && !contract.adoptedQuoteSnapshot)
      review(
        'contract',
        contract.id,
        'adoptedQuoteSnapshot',
        '旧合同未保存签约采用摘要，依据待核；不从当前报价补造签约历史。',
      );
  }
  for (const method of state.paymentMethods || []) {
    const nested = method.crmFields?.['alp_framework_protocol'];
    const nestedValue =
      nested && typeof nested === 'object'
        ? (nested as Record<string, unknown>)['alp_delivery_in_full_payment']
        : undefined;
    const flatValue = method.crmFields?.['alp_delivery_in_full_payment'];
    const values = [
      Object.hasOwn(method, 'deliveryInFullPayment') ? method.deliveryInFullPayment : undefined,
      nestedValue,
      flatValue,
    ].filter((value) => value !== undefined);
    if (!Object.hasOwn(method, 'deliveryInFullPayment') && values.length) {
      if (typeof values[0] === 'string' || values[0] === null)
        method.deliveryInFullPayment = values[0];
      else
        review(
          'paymentMethod',
          method.id,
          'deliveryInFullPayment',
          '旧款清发货来源类型待核，原始来源保留，不推算业务主值。',
        );
    }
    if (values.some((value) => value !== values[0])) {
      method.deliveryInFullPaymentNeedsReview = true;
      review(
        'paymentMethod',
        method.id,
        'deliveryInFullPayment',
        '款清发货多个来源冲突；保留业务主值（含显式空值）及源原值，待人工核对。',
      );
    }
  }
  return state;
}
