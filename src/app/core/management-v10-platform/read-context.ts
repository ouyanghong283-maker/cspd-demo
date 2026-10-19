import { computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { DemoStore } from '../store';
import { SolutionClock } from '../solution-workflow/clock';
import { SolutionFilesService, checkSolutionFile } from '../solution-workflow/files';
import { FilesService } from '../files.service';
import { createV10ReadSession, type V10ReadSnapshot, type V10QueryContext } from '../v10-contracts';
import type { FileAvailability } from '../v9-contracts';

/** 页面公开适配器，只消费Store发布状态；日期／文件刷新不写业务版本。 */
export function useV10ReadContext() {
  const store = inject(DemoStore);
  const clock = inject(SolutionClock);
  const solutionFiles = inject(SolutionFilesService);
  const files = inject(FilesService);
  const session = createV10ReadSession();
  const snapshot = signal<V10ReadSnapshot | null>(null);
  const sourceOverrides = signal<Partial<V10QueryContext['sources']>>({});
  let lastState: ReturnType<typeof store.state> | undefined;
  let lastSuccessfulReadAt: string | null = null;
  let lastWorkspaceId: string | undefined;
  const publish = (value: V10ReadSnapshot) => snapshot.set(value);
  const refreshFiles = async () => {
    const value = snapshot();
    if (!value) return;
    const checks: Record<string, () => Promise<FileAvailability>> = {};
    for (const workspace of value.state.solutionWorkspaces ?? []) {
      for (const version of workspace.versions) {
        if (Object.values(workspace.currentOutputs).includes(version.id))
          checks[version.id] = () => checkSolutionFile(solutionFiles, version);
      }
    }
    for (const attachment of value.state.attachments) {
      const fileId = attachment.fileId;
      if (!fileId) continue;
      checks[fileId] = async () => {
        const blob = await files.get(fileId);
        if (!blob) return 'missing';
        await blob.slice(0, 1).arrayBuffer();
        return 'present';
      };
    }
    await session.checkFiles(value, checks, publish);
  };
  effect(() => {
    const state = store.state();
    const target = store.v9CommandTarget();
    const dates = clock.dates();
    const overrides = sourceOverrides();
    untracked(() => {
      if (lastState !== state || lastWorkspaceId !== target?.workspaceId) {
        lastState = state;
        lastWorkspaceId = target?.workspaceId;
        lastSuccessfulReadAt = target ? new Date().toISOString() : null;
      }
      publish(
        session.read({
          state,
          workspaceId: target?.workspaceId ?? 'unavailable',
          nowUtc: dates.realNowUtc,
          observationDate: dates.planObservationDate,
          lastSuccessfulReadAt,
          sources: target
            ? overrides
            : {
                projects: 'unavailable',
                customers: 'unavailable',
                opportunities: 'unavailable',
                finance: 'unavailable',
                solutions: 'unavailable',
                workItems: 'unavailable',
              },
        }),
      );
      void refreshFiles();
    });
  });
  const refresh = () => {
    clock.now.set(new Date().toISOString());
  };
  const onFocus = () => {
    refresh();
  };
  window.addEventListener('focus', onFocus);
  inject(DestroyRef).onDestroy(() => {
    session.dispose();
    window.removeEventListener('focus', onFocus);
  });
  return {
    snapshot: snapshot.asReadonly(),
    context: computed(() => snapshot()?.context ?? null),
    refresh,
    refreshFiles,
    /** 故障恢复／加载适配入口：按域声明读取状态，不修改业务数据。 */
    setSources: (sources: Partial<V10QueryContext['sources']>) => sourceOverrides.set(sources),
  };
}
