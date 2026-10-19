import type { Role } from './models';

export interface SourcePersonIdentity {
  /** 字面量保持不变以兼容存量数据；口径上指非标CRM（飞书多维表格·JP站点）侧的模拟样例。 */
  source: 'CRM模拟样例';
  id: string;
  name: string;
}

export interface DemoIdentityBinding {
  personId: string;
  role: 'sales' | 'assistant' | 'manager';
  displayName: string;
  sourcePerson: SourcePersonIdentity;
  assistantForPersonId?: string;
  legacyPlatformNames: string[];
}

// This is a small, explicit Demo mapping. The IDs are mock values and do not
// represent real Feishu identities or grant access based on a display name.
export const DEMO_IDENTITY_BINDINGS: DemoIdentityBinding[] = [
  {
    personId: 'demo-person-sales-zhang',
    role: 'sales',
    displayName: '张销售',
    sourcePerson: { source: 'CRM模拟样例', id: 'CRM-DEMO-PERSON-001', name: '张销售' },
    legacyPlatformNames: ['张销售'],
  },
  {
    personId: 'demo-person-assistant-lin',
    role: 'assistant',
    displayName: '林助理',
    sourcePerson: { source: 'CRM模拟样例', id: 'CRM-DEMO-PERSON-002', name: '林助理' },
    assistantForPersonId: 'demo-person-sales-zhang',
    legacyPlatformNames: ['林助理'],
  },
  {
    personId: 'demo-person-manager-zhao',
    role: 'manager',
    displayName: '赵主管',
    sourcePerson: { source: 'CRM模拟样例', id: 'CRM-DEMO-PERSON-003', name: '赵主管' },
    legacyPlatformNames: ['赵主管'],
  },
];

export function identityForRole(role: Role): DemoIdentityBinding | undefined {
  return DEMO_IDENTITY_BINDINGS.find((binding) => binding.role === role);
}

/** Resolve only a known legacy platform identity; CRM source names are never inputs. */
export function identityForLegacyPlatformName(name: string): DemoIdentityBinding | undefined {
  return DEMO_IDENTITY_BINDINGS.find((binding) => binding.legacyPlatformNames.includes(name));
}
