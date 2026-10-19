import { Field, ROLES } from './models';
import { DEMO_IDENTITY_BINDINGS } from './identity';

/** Existing demo users; customer contacts belong to their own customer directory. */
export const INTERNAL_PEOPLE: readonly string[] = [
  ...new Set([
    ...ROLES.filter((role) => role.id !== 'outsider').map((role) => role.person),
    ...DEMO_IDENTITY_BINDINGS.map((binding) => binding.displayName),
    '赵销售',
    '孙销售',
    '刘项目',
  ]),
];

export const PROJECT_MANAGERS: readonly string[] = [
  ...ROLES.filter((role) => role.id === 'pm').map((role) => role.person),
  '刘项目',
];

export function personField(
  key: string,
  label: string,
  value = '',
  required = false,
  people: readonly string[] = INTERNAL_PEOPLE,
): Field {
  const options = [...new Set(people.filter(Boolean))];
  const known = !value || options.includes(value);
  return {
    key,
    label,
    type: 'select',
    options,
    optionsOnly: true,
    required,
    value,
    hint: !known
      ? `原记录为“${value}”，请从现有名单重新选择；保存前原记录保留。`
      : options.length
        ? '从现有名单中选择。'
        : '暂无可选人员，请先在联系人管理中维护该客户的联系人。',
  };
}

export function selectedPeople(value: string): string[] {
  return [
    ...new Set(
      value
        .split('、')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

export function peopleField(
  key: string,
  label: string,
  value: string,
  people: readonly string[],
): Field {
  const field = personField(key, label, '', false, people);
  const unknown = selectedPeople(value).filter((name) => !people.includes(name));
  return {
    ...field,
    multiple: true,
    value,
    hint: unknown.length
      ? `原记录中的“${unknown.join('、')}”不在现有名单中，请移除后重新选择；保存前原记录保留。`
      : '可从已有内部人员和当前客户联系人中选择多人。',
  };
}
