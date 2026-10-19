import type { FileAvailability } from '../v9-contracts';
import type { DemoState } from '../models';
import type { V10QueryContext } from '../v10-contracts';
import { createV9Dates } from '../v9-queries';

export interface V10ReadInput {
  state: Readonly<DemoState>;
  workspaceId: string;
  nowUtc: string;
  observationDate: string;
  lastSuccessfulReadAt: string | null;
  sources?: Partial<V10QueryContext['sources']>;
}
export interface V10ReadSnapshot {
  state: Readonly<DemoState>;
  context: V10QueryContext;
}
/** 每个消费实例独立；不读取存储、不修改业务快照。 */
export function createV10ReadSession() {
  const sessionId = globalThis.crypto.randomUUID();
  let revision = 0;
  let current: V10ReadSnapshot | null = null;
  return {
    current: () => current,
    dispose() {
      current = null;
    },
    async checkFiles(
      snapshot: V10ReadSnapshot,
      checks: Readonly<Record<string, () => Promise<FileAvailability>>>,
      publish: (value: V10ReadSnapshot) => void = () => {},
    ): Promise<V10ReadSnapshot | null> {
      if (current !== snapshot) return null;
      const checking: V10ReadSnapshot = {
        state: snapshot.state,
        context: {
          ...snapshot.context,
          contextRevision: `${sessionId}:read-${++revision}`,
          fileAvailability: Object.fromEntries(
            Object.keys(checks).map((id) => [id, 'checking' as const]),
          ),
        },
      };
      current = checking;
      publish(checking);
      const entries = await Promise.all(
        Object.entries(checks).map(async ([id, check]) => {
          try {
            return [id, await check()] as const;
          } catch {
            return [id, 'unavailable' as const] as const;
          }
        }),
      );
      if (current !== checking) return null;
      current = {
        state: checking.state,
        context: {
          ...checking.context,
          contextRevision: `${sessionId}:read-${++revision}`,
          fileAvailability: Object.fromEntries(entries),
        },
      };
      publish(current);
      return current;
    },
    read(input: V10ReadInput): V10ReadSnapshot {
      current = {
        state: input.state,
        context: {
          workspaceId: input.workspaceId,
          roundId: input.state.roundId ?? 'unavailable',
          dataVersion: input.state.dataVersion ?? null,
          contextRevision: `${sessionId}:read-${++revision}`,
          dates: {
            ...createV9Dates(input.nowUtc, input.observationDate),
            lastSuccessfulReadAt: input.lastSuccessfulReadAt,
          },
          fileAvailability: {},
          sources: {
            projects: input.state.projects.length ? 'ready' : 'empty',
            customers: input.state.customers.length ? 'ready' : 'empty',
            opportunities: input.state.sales.some((s) => s.type === 'opportunity')
              ? 'ready'
              : 'empty',
            finance: 'ready',
            solutions: 'ready',
            workItems: 'ready',
            ...input.sources,
          },
        },
      };
      return current;
    },
  };
}
