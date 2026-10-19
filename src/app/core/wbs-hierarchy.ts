/** Display hierarchy comes only from an existing, unambiguous WBS code prefix. */
export function wbsHierarchy<T extends { id: string; wbsCode?: string }>(plans: readonly T[]) {
  const byCode = new Map<string, T[]>();
  for (const plan of plans) {
    const code = plan.wbsCode?.trim();
    if (code) byCode.set(code, [...(byCode.get(code) || []), plan]);
  }
  const children = new Map<T | undefined, T[]>();
  for (const plan of plans) {
    const code = plan.wbsCode?.trim() || '';
    const prefix = code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : '';
    const matches = byCode.get(prefix);
    const parent = matches?.length === 1 ? matches[0] : undefined;
    children.set(parent, [...(children.get(parent) || []), plan]);
  }
  const rows: { plan: T; depth: number; childCount: number }[] = [];
  const visit = (parent: T | undefined, depth: number) => {
    for (const plan of children.get(parent) || []) {
      rows.push({ plan, depth, childCount: children.get(plan)?.length || 0 });
      visit(plan, depth + 1);
    }
  };
  visit(undefined, 0);
  return rows;
}
