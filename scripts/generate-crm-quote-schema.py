"""Generate the two local form definitions from the saved standard CRM evidence."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
base = root / 'doc/字段资料/V7_CRM只读取证'
load = lambda name: json.loads((base / name).read_text())
summary_runtime = load('quote-summary-38109373-runtime.json')
summary_metadata = load('quote-summary-38109373-metadata.json')
detail = load('quotedetail-f6446575-evidence.json')
output = {}
for entity, data, sections in [
    ('quote', summary_metadata, summary_runtime['sections']),
    ('quotedetail', detail, [section for tab in detail['runtime']['tabs'] for section in tab['sections']]),
]:
    form = ET.fromstring(data['form']['data']['formxml'])
    attributes = {row['LogicalName']: row for row in data['attributes']['data']['value']}
    controls = {}
    for control in form.findall('.//control'):
        if control.get('datafieldname') and control.get('datafieldname') not in controls:
            controls[control.get('datafieldname')] = control
    seen = set()
    fields = []
    for section in sections:
        for control in section['controls']:
            attribute = control.get('attribute')
            name = attribute and attribute['name']
            if not name or name in seen:
                continue
            seen.add(name)
            metadata = attributes.get(name, {})
            readonly = controls.get(name, ET.Element('empty')).get('disabled') == 'true' or metadata.get('SourceType') in [1, 2, 3] or metadata.get('IsValidForUpdate') is False
            if entity == 'quote' and name in ['revisionnumber', 'alp_exports']:
                readonly = True
            if entity == 'quotedetail' and name in ['revisionnumber', 'quoteid', 'transactioncurrencyid']:
                readonly = True
            fields.append({
                'name': name, 'label': control['label'], 'group': section['label'], 'type': attribute['type'],
                'required': attribute['required'] == 'required', 'visible': control['visible'], 'readonly': readonly,
                'precision': attribute.get('precision'), 'min': attribute.get('min'), 'max': attribute.get('max'),
                'maxLength': metadata.get('MaxLength') or attribute.get('maxLength'), 'targets': control.get('entityTypes') or [],
                'options': [{'label': option['text'], 'value': option['value']} for option in attribute.get('options') or []],
            })
    output[entity] = fields
schema = root / 'my demo/src/app/core/crm-quote-schema.ts'
header = schema.read_text().split('export const CRM_SUMMARY_FIELDS:')[0]
schema.write_text(header + 'export const CRM_SUMMARY_FIELDS: readonly CrmField[] = ' + json.dumps(output['quote'], ensure_ascii=False, indent=2) + ';\nexport const CRM_DETAIL_FIELDS: readonly CrmField[] = ' + json.dumps(output['quotedetail'], ensure_ascii=False, indent=2) + ';\n')
report = ['# 报价摘要与明细字段覆盖（2026-10-16）', '', '范围以指定标准CRM表单为准。摘要39个控件（地址拆为7项，含2项源隐藏字段）；明细37个属性。支付条款详情另展示条款编码、中英德描述、负责人，以及付款阶段视图的9列。', '', '仅在明确保存旧草稿时切换到新规则，已发出及已锁定历史不重算。用户另已明确排除客户专属支付条款关系，保留通用有效条款快照。', '']
for entity, fields in output.items():
    report += ['## ' + ('摘要' if entity == 'quote' else '报价明细'), '', '| 源字段 | 显示名称 | 分组 | 源必填 | 初始显示 | 处理及本地路径 |', '| --- | --- | --- | --- | --- | --- |']
    for field in fields:
        target = 'QuoteVersion' if entity == 'quote' else 'QuoteItem'
        mode = '只读/计算' if field['readonly'] else '可编辑（受状态及联动限制）'
        report.append(f"| `{field['name']}` | {field['label']} | {field['group']} | {'是' if field['required'] else '否'} | {'是' if field['visible'] else '条件显示/隐藏'} | {mode}；`{target}.crmFields.{field['name']}` |")
    report.append('')
report += ['## 补充说明', '', '- `shipto_composite`以7个地址子字段承载；不另加第8个可编辑地址输入。', '- 摘要隐藏金额仍按含税合计公式保存；源隐藏类型字段保留在数据定义中。', '- SKU定价、关联商机、报价编号/版本及生效日期按源表单只读；SKU定价须由来源记录提供，不开放人工改写。', '- 明细折扣按销售组织码8210/8220/8250/8270显示；数量精度0，其余26个Decimal精度2。', '- 客户、商机和本地负责人复用工作区稳定关联，明确标识为workspace引用；价目表、产品、SKU、币种、组织及条款使用已保存的标准CRM快照，不将本地演示ID冒充CRM ID。', '- CSPD全局必填标准不由本表改写；本次报价表单规则依据用户明确要求，使用指定标准CRM摘要和明细必填。', '']
(base / '报价摘要与明细字段覆盖_2026-10-16.md').write_text('\n'.join(report))
print('generated:', len(output['quote']), 'summary fields,', len(output['quotedetail']), 'detail fields')
