import assert from 'node:assert/strict';

/** 不能用不存在字段的 undefined===undefined 或保存后的值冒充保存前基线。 */
export function assertOpportunityRoughPlansUnchanged(before, after, phase) {
  assert(Array.isArray(before) && before.length > 0, `${phase}：粗计划基线必须是非空真实集合`);
  assert(Array.isArray(after), `${phase}：缺少真实 opportunityRoughPlans`);
  assert.deepEqual(after, before, `${phase}：项目计划操作不得反写商机粗计划`);
}
