import { ContractMilestone } from './models';
import { DEMO_IDENTITY_BINDINGS } from './identity';

export interface ContractMilestoneInput {
  id?: string;
  contractId: string;
  name: string;
  dueDate: string;
  warningLeadDays: number | null;
  ownerPersonId: string;
  expectedDataVersion: number;
}

/** Stable directory identities; the name is a display snapshot, never a lookup key. */
export const CONTRACT_MILESTONE_OWNERS = DEMO_IDENTITY_BINDINGS;

export function contractMilestoneError(input: ContractMilestoneInput): string | null {
  if (typeof input.name !== 'string' || !input.name.trim()) return '里程碑名称不能为空';
  if (
    typeof input.dueDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
    !Number.isFinite(Date.parse(input.dueDate)) ||
    new Date(input.dueDate).toISOString().slice(0, 10) !== input.dueDate
  )
    return '里程碑日期必须是合法的纯日期';
  if (
    typeof input.warningLeadDays !== 'number' ||
    !Number.isSafeInteger(input.warningLeadDays) ||
    input.warningLeadDays < 0
  )
    return '提前天数必须是非负整数，允许 0';
  if (!CONTRACT_MILESTONE_OWNERS.some((person) => person.personId === input.ownerPersonId))
    return '请从人员名单选择有效负责人';
  return null;
}

/** Called only after contract ownership, lease and revision checks in the Store. */
export function makeContractMilestone(
  input: ContractMilestoneInput,
  previous: ContractMilestone | undefined,
  newId: string,
  createdAt: string,
): ContractMilestone {
  const error = contractMilestoneError(input);
  if (error) throw new Error(error);
  if (previous && (previous.id !== input.id || previous.contractId !== input.contractId))
    throw new Error('不能修改里程碑所属合同');
  return {
    id: previous?.id || newId,
    contractId: input.contractId,
    name: input.name.trim(),
    dueDate: input.dueDate,
    warningLeadDays: input.warningLeadDays!,
    ownerPersonId: input.ownerPersonId,
    ownerName: CONTRACT_MILESTONE_OWNERS.find((person) => person.personId === input.ownerPersonId)!
      .displayName,
    createdAt: previous?.createdAt || createdAt,
  };
}
