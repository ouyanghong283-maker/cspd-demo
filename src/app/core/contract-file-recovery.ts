import type { ContractOriginalBlobStore } from './contract-original-store';

export interface OriginalRecoveryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}
export interface OriginalRecoveryResult {
  promoted: string[];
  deleted: string[];
  pending: { blobId: string; contractId: string }[];
  blocked: boolean;
}
/** 扫描全部保留快照及原文备份；任何无法解析的候选都意味着尚不能证明无引用。 */
export function retainedOriginalReferences(storage: OriginalRecoveryStorage): Set<string> | null {
  const references = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'blobId' && typeof item === 'string') references.add(item);
      else visit(item);
    }
  };
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (
        !key ||
        !(
          key === 'cspd-demo-v2' ||
          key.startsWith('cspd-demo-v2-corrupt-backup-') ||
          /^cspd-demo[^:]*:.*(?:workspace:|backup:)/.test(key)
        )
      )
        continue;
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      visit(value);
    }
    return references;
  } catch {
    return null;
  }
}

/** 引用为真相；每次异步等待后重新核对资格、归属和完整引用集合。 */
export async function recoverContractOriginals(context: {
  blobs: ContractOriginalBlobStore;
  storage: OriginalRecoveryStorage;
  workspaceId: string;
  roundId: string;
  canMutate(): boolean;
  liveReferences(): string[];
  inFlight(blobId: string): boolean;
  includeUnreferencedHistory?: boolean;
  onlyBlobIds?: ReadonlySet<string>;
}): Promise<OriginalRecoveryResult> {
  const result: OriginalRecoveryResult = { promoted: [], deleted: [], pending: [], blocked: false };
  const references = () => {
    if (!context.canMutate()) return null;
    const refs = retainedOriginalReferences(context.storage);
    context.liveReferences().forEach((id) => refs?.add(id));
    return refs;
  };
  try {
    const keys = await context.blobs.keys();
    for (const id of keys) {
      if (context.onlyBlobIds && !context.onlyBlobIds.has(id)) continue;
      if (!context.canMutate()) {
        result.blocked = true;
        break;
      }
      const record = await context.blobs.read(id);
      if (
        !record ||
        record.blobId !== id ||
        !record.contractId ||
        !record.operationId ||
        !context.workspaceId ||
        !context.roundId ||
        record.workspaceId !== context.workspaceId ||
        record.roundId !== context.roundId ||
        context.inFlight(id)
      )
        continue;
      const refs = references();
      if (!refs) {
        result.blocked = true;
        break;
      }
      try {
        if (refs.has(id)) {
          if (record.state === 'staged') {
            await context.blobs.promote(id);
            result.promoted.push(id);
          }
        } else if (record.state === 'staged' || context.includeUnreferencedHistory) {
          // No await between the last reference/lease check and the adapter's delete transaction.
          await context.blobs.discard(id, () => {
            const latest = references();
            return !!latest && !latest.has(id) && !context.inFlight(id);
          });
          result.deleted.push(id);
        }
      } catch {
        result.pending.push({ blobId: id, contractId: record.contractId });
      }
    }
  } catch {
    result.blocked = true;
  }
  return result;
}
