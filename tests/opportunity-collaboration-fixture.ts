import { harness } from './v4-harness';

/** Shared valid opportunity fixture used by existing and V7 collaboration tests. */
export function readyOpportunity() {
  const { store, role } = harness();
  const lead = store.sale('DEMO-L001')!;
  if (!store.has(lead.id, '需求导入表')) {
    store.state().attachments.push({
      ...store.state().attachments[0],
      id: 'v6-requirements',
      entityId: lead.id,
      kind: '需求导入表',
      name: '需求表.xlsx',
    });
  }
  const id = store.convert(lead.id)!;
  store.saveSales({ ...store.sale(id)!, grade: 'A', tender: '否' });
  const template = store.state().attachments.find((item) => item.kind === '需求导入表')!;
  for (const kind of ['核心技术方案', 'BOM清单', '单线图（SLD）', '衰减曲线'])
    store.state().attachments.push({
      ...template,
      id: `v6-${kind}`,
      entityId: id,
      kind,
      name: `演示_${kind}.pdf`,
    });
  return { store, id, role };
}
