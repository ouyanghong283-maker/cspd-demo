"""Rebuild the local quote catalog from saved read-only evidence. No network calls."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
base = root / 'doc/字段资料/V7_CRM只读取证'
read = lambda name: json.loads((base / name).read_text())
first = read('quote-implementation-catalog-source.json')
prices = read('quote-implementation-prices-source.json')
products = read('quote-implementation-products-source.json')
skus = read('quote-implementation-sku-source.json')
sku_products = read('quote-implementation-sku-products-source.json')
rows = lambda data, key: [row for result in data['result'] if result.get('key') == key for page in result.get('pages', [result]) for row in page.get('data', {}).get('value', [])]
refs = {}
def add(entity, id_key, label_key, records):
    for record in records:
        raw = {key: value for key, value in record.items() if '@' not in key}
        if '_ownerid_value@OData.Community.Display.V1.FormattedValue' in record:
            raw['ownerName'] = record['_ownerid_value@OData.Community.Display.V1.FormattedValue']
        refs[record[id_key]] = {'id': record[id_key], 'entity': entity, 'label': record.get(label_key) or record[id_key], 'data': raw}
for master in read('quote-38109373-reference-snapshot.json')['masters']:
    metadata = master['metadata']['data']
    add(master['entity'], metadata['PrimaryIdAttribute'], metadata['PrimaryNameAttribute'], [master['record']['data']])
for key, entity, identifier, label in [
    ('currencies', 'transactioncurrency', 'transactioncurrencyid', 'isocurrencycode'),
    ('organizations', 'alp_sales_organization', 'alp_sales_organizationid', 'alp_name'),
    ('priceLists', 'alp_pricelevel', 'alp_pricelevelid', 'alp_name'),
    ('skuPriceLists', 'alp_sku_pricelevel', 'alp_sku_pricelevelid', 'alp_name'),
    ('paymentTerms', 'alp_paymentterms', 'alp_paymenttermsid', 'alp_name'),
]:
    add(entity, identifier, label, rows(first, key))
add('product', 'productid', 'name', rows(products, 'products'))
add('product', 'productid', 'name', [row for result in sku_products['result'] for row in result['data'].get('value', [])])
add('alp_product_model', 'alp_product_modelid', 'alp_sku_code', rows(skus, 'skus'))
add('alp_sku_pricelevel', 'alp_sku_pricelevelid', 'alp_name', rows(skus, 'skuBooks'))
points = []
for is_sku, records in [(False, rows(prices, 'prices')), (True, rows(skus, 'skuPrices'))]:
    for row in records:
        points.append({
            'id': row['alp_sku_priceleveldtlid' if is_sku else 'alp_pricelevelchangeid'],
            'priceListId': row['_alp_sku_pricelevelid_value' if is_sku else '_alp_priceleveid_value'],
            'productId': row['_alp_skuid_value' if is_sku else '_alp_product_r1_value'],
            'sku': is_sku,
            'guide': row.get('alp_guideprice_lcy' if is_sku else 'alp_guideprice_lcy_fx'),
            'foreignGuide': row.get('alp_guideprice_fcy'),
            'currencyId': row.get('_alp_currency_fcy_value') or '',
            'cost': row.get('alp_referencecost_lcy'),
            'costWithoutAmortization': row.get('alp_referencecost_noamortize_lcy'),
            'minimum': row.get('alp_grossprice_min_lcy'),
        })
# This is a complete snapshot of the selected price lists, not a claim to contain every CRM record.
stage_columns = ['alp_name', 'alp_method_of_payment', 'alp_condition', 'alp_proportion', 'alp_days', 'alp_follow_fixedamount', 'alp_fixedamount', 'alp_delivery_in_full_payment', 'createdon']
value = {
    'capturedAt': first['capturedAt'],
    'references': list(refs.values()),
    'prices': points,
    'rates': [{'currencyId': row['_alp_currencyid_lcy_value'], 'rate': row['alp_exchange_rate'], 'endDate': row['alp_enddate']} for row in rows(prices, 'rates')],
    'paymentStages': [{'termId': row['_alp_paymenttermsid_value'], 'label': row.get('alp_name') or '付款阶段', 'values': {key: str(row.get(key + '@OData.Community.Display.V1.FormattedValue', row.get(key)) if row.get(key) is not None else '—') for key in stage_columns}} for row in read('quote-implementation-stages-source.json')['data']['value']],
    'skuLinks': [{'skuId': row['_alp_product_modelid_value'], 'productId': row['_alp_material_value'], 'default': row.get('alp_default') is True, 'regions': str(row.get('alp_salesarea') or '')} for row in rows(skus, 'skuLinks')],
    'complete': False,
}
target = root / 'my demo/src/app/core/crm-quote-reference.ts'
# Store repetitive rows as typed tuples; keep the public catalog interface descriptive.
# IDs/names already have dedicated columns and are omitted from the duplicated data bag.
for reference in value['references']:
    reference['data'] = {key: item for key, item in reference['data'].items() if item != reference['id'] and not (item == reference['label'] and key in ['name', 'alp_name', 'fullname', 'alp_sku_code'])}
encode = lambda data: json.dumps(data, ensure_ascii=False, separators=(',', ':'))
reference_rows = [[row['id'], row['entity'], row['label'], row['data']] for row in value['references']]
price_rows = [[row[key] for key in ['id', 'priceListId', 'productId', 'sku', 'guide', 'foreignGuide', 'currencyId', 'cost', 'costWithoutAmortization', 'minimum']] for row in value['prices']]
stage_rows = [[row['termId'], row['label'], [row['values'][key] for key in stage_columns]] for row in value['paymentStages']]
source = """import type { CrmCatalog } from './crm-quote';
import type { CrmValues } from './crm-quote-schema';
// Generated from saved standard Dynamics read-only evidence by scripts/generate-crm-quote-reference.py.
// Customer-specific payment-term relationships were excluded by the user on 2026-10-16.
"""
source += 'const referenceRows: [string,string,string,CrmValues][] = ' + encode(reference_rows) + ';\n'
source += 'const priceRows: [string,string,string,boolean,number|null,number|null,string,number|null,number|null,number|null][] = ' + encode(price_rows) + ';\n'
source += 'const stageRows: [string,string,string[]][] = ' + encode(stage_rows) + ';\n'
source += 'const stageColumns = ' + encode(stage_columns) + ';\n'
source += "export const CRM_QUOTE_CATALOG: CrmCatalog = {\n"
source += "capturedAt:" + encode(value['capturedAt']) + ",complete:false,\n"
source += "references:referenceRows.map(([id,entity,label,data])=>({id,entity,label,data})),\n"
source += "prices:priceRows.map(([id,priceListId,productId,sku,guide,foreignGuide,currencyId,cost,costWithoutAmortization,minimum])=>({id,priceListId,productId,sku,guide,foreignGuide,currencyId,cost,costWithoutAmortization,minimum})),\n"
source += "paymentStages:stageRows.map(([termId,label,values])=>({termId,label,values:Object.fromEntries(stageColumns.map((key,index)=>[key,values[index]]))})),\n"
source += 'rates:' + encode(value['rates']) + ',\n'
source += 'skuLinks:' + encode(value['skuLinks']) + ',\n};\n'
target.write_text(source)
steps = next(item for item in first['result'] if item['key'] == 'steps')
(base / 'quote-backend-step-states.json').write_text(json.dumps({'capturedAt': first['capturedAt'], **steps}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'references': len(refs), 'prices': len(points), 'rates': len(value['rates']), 'stages': len(value['paymentStages']), 'skuLinks': len(value['skuLinks']), 'customerSpecificTerms': 'excluded by user', 'stepStates': [{'name': row['name'], 'statecode': row['statecode']} for row in steps['data']['value']]}, ensure_ascii=False))
