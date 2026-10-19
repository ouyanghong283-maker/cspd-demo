import { DemoStore } from '../src/app/core/store';
import { QuoteVersion } from '../src/app/core/models';
import { applyCrmProduct, calculateCrmLine } from '../src/app/core/crm-quote';

/** Synthetic local quote using real catalog IDs, without writing to standard CRM. */
export function completeCrmDraft(store: DemoStore, versionId: string): QuoteVersion {
  const draft = store.crmQuoteDraft(store.quoteVersion(versionId)!);
  draft.crmSchemaVersion = 1;
  const catalog = store.crmQuoteCatalog();
  const currencyId = draft.crmFields!['transactioncurrencyid'];
  const rate =
    catalog.rates
      .filter((row) => row.currencyId === currencyId)
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.rate ?? 1;
  const point = catalog.prices.find(
    (row) =>
      !row.sku &&
      (row.guide ?? 0) > 0 &&
      catalog.references.some(
        (product) => product.entity === 'product' && product.id === row.productId,
      ),
  )!;
  Object.assign(draft.crmFields!, {
    alp_price_list: point.priceListId,
    alp_quotation_type: 10,
    alp_trade_terms: 749010000,
    alp_paymenttermsid: catalog.references.find(
      (row) =>
        row.entity === 'alp_paymentterms' &&
        row.data['statecode'] === 0 &&
        row.data['alp_payment_state'] === 20,
    )!.id,
    alp_salesbranch:
      catalog.references.find(
        (row) =>
          row.entity === 'alp_sales_organization' &&
          row.data['alp_salesorganizationcode'] === '8210',
      )?.id || null,
    alp_isintax: 20,
    alp_tax_rate: 0,
    closedon: '2026-11-09',
  });
  const price = Math.ceil(point.guide! * rate * 100) / 100 + 1;
  const fields = calculateCrmLine(
    applyCrmProduct(
      {
        alp_productcode: point.productId,
        quoteid: draft.id,
        transactioncurrencyid: currencyId || null,
        alp_isintax: 20,
        alp_taxpercentage: 0,
        quantity: 2,
        alp_priceperunit: price,
        alp_beforedispriceintax: price,
        propertyconfigurationstatus: 2,
      },
      draft.crmFields!,
      catalog,
    ),
    'alp_priceperunit',
  );
  draft.items = [
    {
      id: 'CRM-QI-' + versionId,
      category: '货物',
      name: '',
      spec: '',
      unit: '',
      quantity: 2,
      unitPrice: price,
      source: '本地合成验收记录',
      crmPriceInput: 'alp_priceperunit',
      crmFields: fields,
    },
  ];
  return draft;
}

/** V9报价流程回归的真实方案前置，使用同一公开上传/定稿/采用入口。 */
export async function prepareQuoteSolutionBasis(
  store: DemoStore,
  quoteVersionId: string,
): Promise<void> {
  const { uploadSolutionOutput } = await import('../src/app/core/solution-workflow/upload');
  const { setSolutionSchedule } = await import('../src/app/core/solution-workflow/schedule');
  const { finalizeSolution, selectFinalizationSource } =
    await import('../src/app/core/solution-workflow/finalization');
  const { adoptQuoteSolutionBasis } = await import('../src/app/core/solution-workflow/quote-basis');
  const opportunityId = store
    .state()
    .quoteSeries!.find((s) => s.versions.some((q) => q.id === quoteVersionId))!.opportunityId;
  Object.assign(store, { activeWorkspaceId: 'CRM-FIXTURE' });
  store.state().roundId ||= 'CRM-FIXTURE-ROUND';
  if (!store.sale(opportunityId)!.productNeeds?.length)
    store.saveProductNeed(opportunityId, { id: 'CRM-NEED', model: 'PCS', quantity: 1, unit: '台' });
  const context = { ...store.v9CommandTarget()!, operationId: 'CRM-FINAL' };
  const rows = new Map<
    string,
    import('../src/app/core/solution-workflow/files').SolutionBlobRecord
  >();
  const files = {
    async get(id: string) {
      return rows.get(id) ?? null;
    },
    async put(
      id: string,
      row: import('../src/app/core/solution-workflow/files').SolutionBlobRecord,
    ) {
      rows.set(id, row);
    },
  };
  setSolutionSchedule(
    store,
    {
      opportunityId,
      pmPersonId: 'demo-person:王项目',
      ownerPersonId: 'demo-person:周方案',
      deadlineDate: '2026-10-20',
      note: '报价回归前置',
    },
    { ...context, operationId: 'CRM-SCHEDULE' },
  );
  for (const [kind, ext] of [
    ['proposal', 'pptx'],
    ['bom', 'xlsx'],
    ['sld', 'pdf'],
    ['degradation', 'csv'],
  ] as const)
    await uploadSolutionOutput(
      store,
      { opportunityId, kind, file: new File(['quote regression'], kind + '.' + ext), note: '' },
      { ...context, operationId: 'CRM-' + kind },
      files,
    );
  const source = selectFinalizationSource(store.state(), opportunityId, {});
  const result = await finalizeSolution(
    store,
    {
      opportunityId,
      fourVersionIds: source.fourVersionIds!,
      productNeedRevision: source.productNeedRevision!,
      ownerPersonId: source.schedule!.owner.personId,
      scheduleRevision: source.schedule!.revision,
      actingOnBehalf: true,
    },
    context,
    files,
  );
  if (result.status !== 'committed') throw Error(result.message);
  const quote = store.quoteVersion(quoteVersionId)!;
  const adopted = await adoptQuoteSolutionBasis(
    store,
    {
      quoteVersionId,
      quoteRevision: quote.contentRevision ?? 0,
      finalizationId: selectFinalizationSource(store.state(), opportunityId, {}).current!.id,
    },
    { ...context, operationId: 'CRM-ADOPT' },
    files,
  );
  if (adopted.status !== 'committed') throw Error(adopted.message);
}
