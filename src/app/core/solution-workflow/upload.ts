import { reclaimSolutionFiles } from './reclaim';
import type { DemoStore } from '../store';
import { isClosed } from '../rules';
import { knownDemoPersonId } from '../plan-person';
import { registerSolutionVersion, solutionVersionId } from './versions';
import type { SolutionFiles } from './files';
import type {
  V9CommandResult,
  V9OperationContext,
  V9SolutionCommandInputs,
  V9ErrorCode,
} from '../v9-contracts';
export const SOLUTION_OUTPUT_FORMATS: Record<string, readonly string[]> = {
  proposal: ['ppt', 'pptx'],
  bom: ['xls', 'xlsx', 'csv'],
  sld: ['pdf', 'svg', 'png', 'jpg'],
  degradation: ['xlsx', 'csv', 'pdf', 'png', 'svg', 'zip'],
};
const pending = new WeakMap<DemoStore, Set<string>>();
/** File字节在系统边界核验；登记前再次经过原目标和修改权检查。 */
export async function uploadSolutionOutput(
  store: DemoStore,
  input: V9SolutionCommandInputs['uploadSolutionOutput'],
  context: V9OperationContext,
  files: SolutionFiles,
): Promise<V9CommandResult> {
  const reject = (
    code: V9ErrorCode,
    message: string,
    status: 'rejected' | 'failed' = 'rejected',
  ): V9CommandResult => ({
    status,
    objectId: input.opportunityId,
    issue: { code, message },
    message,
  });
  if (
    ![context.workspaceId, context.roundId, context.operationId].every(
      (v) => typeof v === 'string' && v.trim(),
    )
  )
    return reject('field-required', '目标身份和操作号必填');
  const target = store.v9CommandTarget();
  if (target?.workspaceId !== context.workspaceId || target.roundId !== context.roundId)
    return reject('workspace-changed', '目标工作区或轮次已变化');
  if (!store.v9CanEdit()) return reject('no-edit-right', '当前没有上传修改资格');
  const sale = store.sale(input.opportunityId);
  if (!sale || sale.type !== 'opportunity') return reject('field-invalid', '商机不存在');
  if (isClosed(sale)) return reject('business-readonly', '已关闭商机只读');
  const file = input.file;
  if (
    !file ||
    !SOLUTION_OUTPUT_FORMATS[input.kind]?.includes(
      file.name.split('.').at(-1)?.toLowerCase() ?? '',
    ) ||
    file.size <= 0 ||
    file.size > 100 * 1024 * 1024
  )
    return reject('field-invalid', '请选择该类别支持的非空文件，单个不超过100MiB');
  const key = JSON.stringify([
    context.workspaceId,
    context.roundId,
    input.opportunityId,
    input.kind,
  ]);
  const active = pending.get(store) ?? new Set<string>();
  pending.set(store, active);
  if (active.has(key)) return reject('revision-mismatch', '此类资料正在保存，请等待本次结果');
  active.add(key);
  try {
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const digest = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    const blobId =
      'solution-blob:' +
      JSON.stringify([
        context.workspaceId,
        context.roundId,
        input.opportunityId,
        input.kind,
        context.operationId,
        digest,
      ]);
    const workspace = store
      .state()
      .solutionWorkspaces?.find((w) => w.opportunityId === input.opportunityId);
    // 无期限时采用既有方案业务责任人，不将上传者自动变为负责人。
    const ownerName =
      workspace?.schedule?.owner.name ??
      sale.team.find((m) => m.role.includes('方案'))?.person ??
      store.state().solutionDocuments?.find((d) => d.opportunityId === input.opportunityId)
        ?.owner ??
      '';
    const id = solutionVersionId(input.opportunityId, input.kind, context);
    const prior = workspace?.versions.find((v) => v.id === id);
    const owner = prior
      ? prior.owner
      : (workspace?.schedule?.owner ??
        (knownDemoPersonId(ownerName)
          ? { personId: knownDemoPersonId(ownerName)!, name: ownerName }
          : null));
    const registration = {
      opportunityId: input.opportunityId,
      kind: input.kind,
      fileName: file.name,
      size: file.size,
      mime: file.type,
      blobId,
      owner,
      note: input.note,
    };
    const retry = store
      .state()
      .v9CommandReceipts?.some(
        (r) =>
          r.command === 'registerSolutionVersion' &&
          r.objectId === input.opportunityId &&
          r.operationId === context.operationId &&
          r.workspaceId === context.workspaceId &&
          r.roundId === context.roundId,
      );
    if (!retry)
      await files.put(blobId, {
        ...context,
        opportunityId: input.opportunityId,
        kind: input.kind,
        versionId: id,
        digest,
        blob: file,
      });
    const result = registerSolutionVersion(store, registration, context, {
      availability: 'present',
      now: new Date().toISOString(),
    });
    if (result.status === 'committed' || result.status === 'unchanged') {
      const value = result.value as {
        reclaimCandidates?: import('../v9-contracts').SolutionFileReference[];
      };
      const cleanup = await reclaimSolutionFiles(
        store,
        value.reclaimCandidates ?? [],
        context,
        files,
      );
      if (cleanup.recoveryNeeded)
        return { ...result, message: '资料已保存；旧文件释放失败，可重试恢复，不会新增版本' };
    }
    return result;
  } catch (e) {
    return reject(
      e instanceof DOMException && e.name === 'QuotaExceededError'
        ? 'quota-exceeded'
        : 'storage-failed',
      '文件保存失败，旧当前版本未更改，可重试',
      'failed',
    );
  } finally {
    active.delete(key);
  }
}
