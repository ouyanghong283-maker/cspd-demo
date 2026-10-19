import type { DemoStore } from '../store';
import type { DemoState } from '../models';
import { INTERNAL_PEOPLE, PROJECT_MANAGERS } from '../personnel';
import { knownDemoPersonId } from '../plan-person';
import { isClosed, isValidISODate } from '../rules';
import { commandInputFingerprint } from '../v9-command-input';
import { emptySolutionWorkspace } from './versions';
import type {
  V9OperationContext,
  V9CommandResult,
  V9ErrorCode,
  V9Dates,
  V9Person,
  SolutionSchedule,
} from '../v9-contracts';
export const SOLUTION_PEOPLE: readonly V9Person[] = INTERNAL_PEOPLE.map((name) => ({
  name,
  personId: knownDemoPersonId(name)!,
}));
export interface SetSolutionScheduleInput {
  opportunityId: string;
  pmPersonId: string;
  ownerPersonId: string;
  deadlineDate: string;
  note: string;
}
export interface ChangeSolutionDeadlineInput {
  opportunityId: string;
  deadlineDate: string;
  reason: string;
  scheduleRevision: number;
}
export function setSolutionSchedule(
  store: DemoStore,
  input: SetSolutionScheduleInput,
  context: V9OperationContext,
): V9CommandResult {
  return saveSchedule(store, input, context, false);
}
export function changeSolutionDeadline(
  store: DemoStore,
  input: ChangeSolutionDeadlineInput,
  context: V9OperationContext,
): V9CommandResult {
  return saveSchedule(store, input, context, true);
}
function saveSchedule(
  store: DemoStore,
  input: SetSolutionScheduleInput | ChangeSolutionDeadlineInput,
  context: V9OperationContext,
  change: boolean,
): V9CommandResult {
  const reject = (code: V9ErrorCode, message: string): V9CommandResult => ({
    status: 'rejected',
    objectId: input.opportunityId,
    issue: { code, message },
    message,
  });
  const command = change ? 'changeSolutionDeadline' : 'setSolutionSchedule';
  const target = store.v9CommandTarget();
  if (target?.workspaceId !== context.workspaceId || target.roundId !== context.roundId)
    return reject('workspace-changed', '目标工作区或轮次已变化');
  if (!store.v9CanEdit()) return reject('no-edit-right', '请由PM或授权代办设置期限');
  const sale = store.sale(input.opportunityId);
  if (!sale || sale.type !== 'opportunity') return reject('field-invalid', '商机不存在');
  if (isClosed(sale)) return reject('business-readonly', '已关闭商机只读');
  const fingerprint = commandInputFingerprint({ ...input });
  const receipt = store
    .state()
    .v9CommandReceipts?.find(
      (r) =>
        r.command === command &&
        r.objectId === input.opportunityId &&
        r.operationId === context.operationId &&
        r.workspaceId === context.workspaceId &&
        r.roundId === context.roundId,
    );
  if (receipt)
    return receipt.fingerprint === fingerprint
      ? { ...structuredClone(receipt.result), status: 'unchanged' }
      : reject('operation-input-mismatch', '同操作号不能更改输入');
  const workspace = structuredClone(
    store.state().solutionWorkspaces?.find((w) => w.opportunityId === input.opportunityId) ??
      emptySolutionWorkspace(input.opportunityId),
  );
  if (workspace.firstFinalization || workspace.schedule?.frozenByEventId)
    return reject('business-readonly', '首次定稿已冻结期限与责任记录');
  if (!isValidISODate(input.deadlineDate)) return reject('field-invalid', '请输入有效日历日期');
  let next: SolutionSchedule;
  let reason: string;
  if ('scheduleRevision' in input) {
    if (!workspace.schedule || workspace.schedule.revision !== input.scheduleRevision)
      return reject('revision-mismatch', '期限已更新，请重新确认最新记录');
    if (!input.reason.trim()) return reject('field-required', '改期原因必填');
    next = {
      ...workspace.schedule,
      deadlineDate: input.deadlineDate,
      revision: workspace.schedule.revision + 1,
    };
    reason = input.reason.trim();
  } else {
    if (workspace.schedule) return reject('revision-mismatch', '已设置期限，请使用留因改期');
    const pm = SOLUTION_PEOPLE.find(
      (p) => p.personId === input.pmPersonId && PROJECT_MANAGERS.includes(p.name),
    );
    const owner = SOLUTION_PEOPLE.find((p) => p.personId === input.ownerPersonId);
    if (!pm || !owner || !input.note.trim())
      return reject('field-invalid', '请选择有效PM、负责人并填写首次说明');
    next = {
      opportunityId: input.opportunityId,
      pm: { ...pm },
      owner: { ...owner },
      deadlineDate: input.deadlineDate,
      timezone: 'Asia/Shanghai',
      revision: 1,
      frozenByEventId: null,
    };
    reason = input.note.trim();
  }
  const from = structuredClone(workspace.schedule);
  workspace.schedule = next;
  workspace.revision++;
  workspace.scheduleChanges.push({
    id: `schedule:${JSON.stringify([context.workspaceId, context.roundId, input.opportunityId, context.operationId])}`,
    from,
    to: structuredClone(next),
    reason,
    operator: {
      personId: knownDemoPersonId(store.person()) ?? `demo-role:${store.role()}`,
      name: store.person(),
    },
    changedAt: new Date().toISOString(),
  });
  return store.commitV9Command(
    { ...context, command, objectId: input.opportunityId, input: { ...input } },
    {
      object: { type: 'opportunity', id: input.opportunityId },
      mainlineId: input.opportunityId,
      module: '方案',
      department: '解决方案',
      section: '期限与责任',
      action: change ? '调整期限' : '设置期限',
      owner: { name: next.owner.name, personId: next.owner.personId },
      changes: [
        {
          field: 'solutionSchedule.revision',
          valueType: 'number',
          before: from?.revision ?? null,
          after: next.revision,
        },
      ],
      change: (state) => {
        state.solutionWorkspaces ??= [];
        const index = state.solutionWorkspaces.findIndex(
          (w) => w.opportunityId === input.opportunityId,
        );
        if (index < 0) state.solutionWorkspaces.push(workspace);
        else state.solutionWorkspaces[index] = workspace;
      },
      value: { scheduleRevision: next.revision, deadlineDate: next.deadlineDate },
    },
  );
}
/** 自然日序号只用于合法的日历日期，不与观察档或操作时间混用。 */
export function selectSolutionSchedule(
  state: Readonly<DemoState>,
  businessId: string,
  dates: V9Dates,
) {
  const opportunityId =
    state.projects.find((p) => p.id === businessId)?.opportunityId ?? businessId;
  const workspace = state.solutionWorkspaces?.find((w) => w.opportunityId === opportunityId);
  const schedule = workspace?.schedule ?? null;
  const frozen = !!(workspace?.firstFinalization || schedule?.frozenByEventId);
  const date = schedule?.deadlineDate;
  const overdueDays =
    !frozen && date && isValidISODate(date) && dates.solutionBusinessDate > date
      ? Math.round(
          (Date.parse(dates.solutionBusinessDate + 'T00:00:00Z') -
            Date.parse(date + 'T00:00:00Z')) /
            86400000,
        )
      : 0;
  return {
    opportunityId,
    schedule: schedule ? structuredClone(schedule) : null,
    history: structuredClone(workspace?.scheduleChanges ?? []),
    frozen,
    status: frozen ? '已首次定稿' : !date ? '待设置' : overdueDays ? '逾期未定稿' : '未定稿',
    overdueDays,
    missingOwner: !schedule?.owner?.personId,
  };
}
