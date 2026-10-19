import type { Contract, DemoState, QuoteSeries, QuoteVersion } from './models';

/** 报价引用来源的字段与合同草稿字段的对应关系；只用于对比和补空白，不改写归属。 */
interface QuoteSourceValues {
  amount: number | null;
  currency: string;
  payment: string;
  product: string;
  scope: string;
  delivery: string;
  warranty: string;
  service: string;
}
export type QuoteSourcedField = keyof QuoteSourceValues;
export type QuoteReferenceIssue =
  'ok' | 'not-found' | 'no-final-lock' | 'opportunity-mismatch' | 'customer-mismatch';
export type QuoteDifferenceStatus = '一致' | '待补齐' | '人工值保留' | '双方均未提供';

export interface QuoteReferenceCandidate {
  seriesId: string;
  seriesNumber: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  versionStatus: string;
  finalLocked: boolean;
  lockedAt: string;
  lockedBy: string;
  opportunityId: string;
  opportunityName: string;
  customerId: string;
  customerName: string;
  amount: number | null;
  currency: string;
  selectable: boolean;
  issue: QuoteReferenceIssue;
  message: string;
}

export interface QuoteReferenceLookup {
  quoteNumber: string;
  candidates: QuoteReferenceCandidate[];
  message: string;
}

export interface QuoteFieldDifference {
  field: QuoteSourcedField;
  label: string;
  contractValue: string;
  sourceValue: string;
  status: QuoteDifferenceStatus;
}

export interface QuoteTarget {
  opportunityId?: string;
  customerId?: string;
}

type ContractQuoteFields = Pick<
  Contract,
  'amount' | 'currency' | 'payment' | 'product' | 'scope' | 'delivery' | 'warranty' | 'service'
>;

function normalizeQuoteNumber(value: string | undefined): string {
  return (value || '').trim().toUpperCase();
}

function quoteSourceValues(version: QuoteVersion, total: number | null): QuoteSourceValues {
  return {
    amount: total,
    currency: version.currency || '',
    payment: version.payment || '',
    product: version.items
      .map((item) => item.name)
      .filter(Boolean)
      .join('、'),
    scope: version.scope || '',
    delivery: version.delivery || '',
    warranty: version.warranty || '',
    service: version.service || '',
  };
}

function isBlank(field: QuoteSourcedField, value: number | string | null | undefined): boolean {
  if (field === 'amount') return !value || Number(value) <= 0;
  return !String(value ?? '').trim();
}

/** 合同草稿相对报价来源的差异；只展示事实，不自动覆写。 */
export function contractQuoteDifferences(input: {
  contract: ContractQuoteFields;
  version: QuoteVersion;
  total: number | null;
  money: (amount: number, currency: string) => string;
}): QuoteFieldDifference[] {
  const source = quoteSourceValues(input.version, input.total);
  const currency = input.contract.currency || input.version.currency || 'CNY';
  const labels: Record<QuoteSourcedField, string> = {
    amount: '合同金额',
    currency: '币种',
    payment: '付款条件',
    product: '产品',
    scope: '合同范围',
    delivery: '交期',
    warranty: '质保',
    service: '服务约定',
  };
  const fields = Object.keys(labels) as QuoteSourcedField[];
  return fields.map((field) => {
    const contractRaw = input.contract[field];
    const sourceRaw = source[field];
    const contractBlank = isBlank(field, contractRaw);
    const sourceBlank = isBlank(field, sourceRaw);
    const display = (value: number | string | null | undefined, fallback: string) => {
      if (isBlank(field, value)) return fallback;
      return field === 'amount' ? input.money(Number(value), currency) : String(value).trim();
    };
    const status: QuoteDifferenceStatus = contractBlank
      ? sourceBlank
        ? '双方均未提供'
        : '待补齐'
      : sourceBlank || String(contractRaw).trim() !== String(sourceRaw).trim()
        ? '人工值保留'
        : '一致';
    return {
      field,
      label: labels[field],
      contractValue: display(contractRaw, field === 'amount' ? '未填写金额' : '未填写'),
      sourceValue: display(sourceRaw, field === 'amount' ? '报价合计未明确' : '来源未提供'),
      status,
    };
  });
}

/** 换选报价时只补空白：返回可以写入的字段，已有值一律保留。 */
export function blankQuoteFields(
  contract: ContractQuoteFields,
  version: QuoteVersion,
  total: number | null,
): Partial<ContractQuoteFields> {
  const source = quoteSourceValues(version, total);
  const patch: Partial<ContractQuoteFields> = {};
  for (const field of Object.keys(source) as QuoteSourcedField[]) {
    if (!isBlank(field, contract[field]) || isBlank(field, source[field])) continue;
    const value = source[field];
    if (field === 'amount') patch.amount = Number(value);
    else if (field === 'currency') patch.currency = String(value);
    else patch[field] = String(value);
  }
  return patch;
}

function reasonFor(
  series: QuoteSeries,
  version: QuoteVersion,
  target: QuoteTarget,
  state: DemoState,
): { issue: QuoteReferenceIssue; message: string } {
  const opportunityName = (id: string) =>
    state.sales.find((sale) => sale.id === id)?.projectName || id;
  const customerName = (id: string) =>
    state.customers.find((customer) => customer.id === id)?.name || id;
  if (target.opportunityId && series.opportunityId !== target.opportunityId)
    return {
      issue: 'opportunity-mismatch',
      message: `报价号 ${series.number} 属于商机 ${series.opportunityId}（${opportunityName(series.opportunityId)}），与本合同来源商机 ${target.opportunityId}（${opportunityName(target.opportunityId)}）不一致；不自动更改合同归属。`,
    };
  if (target.customerId && version.customerId !== target.customerId)
    return {
      issue: 'customer-mismatch',
      message: `报价版本客户为 ${version.customerId}（${customerName(version.customerId)}），与合同客户 ${target.customerId}（${customerName(target.customerId)}）不一致；不自动更改合同归属。`,
    };
  if (version.id !== series.activeFinalVersionId || version.status !== '最终锁定')
    return {
      issue: 'no-final-lock',
      message: `版本状态为“${version.status}”，不是该系列的最终锁定版本；合同来源必须引用最终锁定版本，不自动选取最新版本。`,
    };
  return { issue: 'ok', message: '最终锁定版本，可显式关联到合同草稿。' };
}

/** 按报价号解析候选系列与各版本；只做精确匹配，不推断相似报价号。 */
export function quoteReferenceCandidates(
  state: DemoState,
  input: { quoteNumber: string } & QuoteTarget,
  totalOf: (version: QuoteVersion) => number | null,
): QuoteReferenceLookup {
  const quoteNumber = (input.quoteNumber || '').trim();
  const series = (state.quoteSeries || []).filter(
    (item) => normalizeQuoteNumber(item.number) === normalizeQuoteNumber(quoteNumber),
  );
  if (!series.length)
    return {
      quoteNumber,
      candidates: [],
      message: quoteNumber
        ? `未找到报价号“${quoteNumber}”；不按相似报价号或最新版本推断来源。`
        : '请填写报价号后再查询候选；自由文本不产生报价版本引用。',
    };
  const candidates = series.flatMap((item) =>
    item.versions.map((version) => {
      const reason = reasonFor(item, version, input, state);
      const finalLocked = version.id === item.activeFinalVersionId && version.status === '最终锁定';
      return {
        seriesId: item.id,
        seriesNumber: item.number,
        versionId: version.id,
        versionNumber: version.number,
        versionLabel: `V${version.number}`,
        versionStatus: version.status,
        finalLocked,
        lockedAt: version.lockedDate || '',
        lockedBy: version.lockedBy || '',
        opportunityId: item.opportunityId,
        opportunityName:
          state.sales.find((sale) => sale.id === item.opportunityId)?.projectName ||
          item.opportunityId,
        customerId: version.customerId,
        customerName:
          state.customers.find((customer) => customer.id === version.customerId)?.name ||
          version.customerId,
        amount: totalOf(version),
        currency: version.currency,
        selectable: reason.issue === 'ok',
        issue: reason.issue,
        message: reason.message,
      } satisfies QuoteReferenceCandidate;
    }),
  );
  const selectable = candidates.filter((candidate) => candidate.selectable).length;
  return {
    quoteNumber,
    candidates,
    message: selectable
      ? `报价号 ${candidates[0].seriesNumber} 有 ${selectable} 个最终锁定版本候选，请显式选择。`
      : `报价号 ${candidates[0].seriesNumber} 没有可用于合同的最终锁定版本；不自动选取最新版本。`,
  };
}

export interface ContractQuoteReferenceSource {
  seriesId: string;
  seriesNumber: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  versionStatus: string;
  locked: boolean;
  lockedAt: string;
  lockedBy: string;
  opportunityId: string;
  opportunityName: string;
  customerId: string;
  customerName: string;
  amount: number | null;
  currency: string;
}

export interface ContractQuoteReferenceView {
  contractId: string;
  /** empty：草稿暂缺关联；linked：已指向现存报价版本；review：旧来源无法确认，保留待核。 */
  status: 'empty' | 'linked' | 'review';
  seriesId: string;
  versionId: string;
  displayNumber: string;
  lockedLabel: string;
  message: string;
  savedAt: string;
  savedBy: string;
  source: ContractQuoteReferenceSource | null;
  differences: QuoteFieldDifference[];
}

/** 读取合同草稿当前的报价来源、来源快照与差异；不连接时说明原因，不推测来源。 */
export function contractQuoteReferenceView(input: {
  state: DemoState;
  contract: Contract;
  totalOf: (version: QuoteVersion) => number | null;
  money: (amount: number, currency: string) => string;
}): ContractQuoteReferenceView {
  const { contract, state } = input;
  const snapshot = contract.quoteReferenceSnapshot;
  const empty: ContractQuoteReferenceView = {
    contractId: contract.id,
    status: 'empty',
    seriesId: contract.quoteSeriesId || '',
    versionId: '',
    displayNumber: '未关联',
    lockedLabel: '未关联',
    message: '草稿暂未关联报价版本；可在报价号候选中显式选择，自由文本不产生引用。',
    savedAt: '',
    savedBy: '',
    source: null,
    differences: [],
  };
  if (!contract.quoteVersionId) return empty;
  const series = (state.quoteSeries || []).find((item) => item.id === contract.quoteSeriesId);
  const version = (state.quoteSeries || [])
    .flatMap((item) => item.versions)
    .find((item) => item.id === contract.quoteVersionId);
  // 版本能解析出来还不够：必须确实属于合同保存的系列指针，否则视为旧来源保留待核。
  if (!version || !series || version.seriesId !== series.id) {
    const label = snapshot
      ? `${snapshot.seriesNumber} ${snapshot.versionLabel}`.trim()
      : contract.quoteVersionId;
    return {
      ...empty,
      status: 'review',
      versionId: contract.quoteVersionId,
      displayNumber: label,
      lockedLabel: '待核',
      message: version
        ? `报价版本 ${contract.quoteVersionId} 不属于合同保存的报价系列 ${
            contract.quoteSeriesId || '（未记录）'
          }；旧来源保留待核，不按相似报价号或最新版本补造。`
        : `报价版本 ${contract.quoteVersionId} 在当前工作区无法确认；旧来源保留待核，不按相似报价号或最新版本补造。`,
      savedAt: snapshot?.savedAt || '',
      savedBy: snapshot?.savedBy || '',
    };
  }
  const total = input.totalOf(version);
  const locked = version.status === '最终锁定';
  const seriesNumber = series.number;
  return {
    contractId: contract.id,
    status: 'linked',
    seriesId: series.id,
    versionId: version.id,
    displayNumber: `${seriesNumber} V${version.number}`.trim(),
    lockedLabel: version.status,
    message: locked
      ? '已关联最终锁定报价版本；换选只补齐空白字段，人工值保留。'
      : `来源版本当前状态为“${version.status}”；已保存的引用保持原样，不自动更改。`,
    savedAt: snapshot?.savedAt || '',
    savedBy: snapshot?.savedBy || '',
    source: {
      seriesId: series.id,
      seriesNumber,
      versionId: version.id,
      versionNumber: version.number,
      versionLabel: `V${version.number}`,
      versionStatus: version.status,
      locked,
      lockedAt: version.lockedDate || '',
      lockedBy: version.lockedBy || '',
      // 商机取自报价系列本身；来源缺失时不回落到合同归属去“补造”。
      opportunityId: series.opportunityId,
      opportunityName:
        state.sales.find((sale) => sale.id === series.opportunityId)?.projectName ||
        series.opportunityId,
      customerId: version.customerId,
      customerName:
        state.customers.find((customer) => customer.id === version.customerId)?.name ||
        version.customerId,
      amount: total,
      currency: version.currency,
    },
    differences: contractQuoteDifferences({
      contract,
      version,
      total,
      money: input.money,
    }),
  };
}
