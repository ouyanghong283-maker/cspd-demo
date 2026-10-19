import { harness } from './v4-harness';
import { uploadSolutionOutput } from '../src/app/core/solution-workflow/upload';
import {
  setSolutionSchedule,
  SOLUTION_PEOPLE,
  changeSolutionDeadline,
} from '../src/app/core/solution-workflow/schedule';
import {
  finalizeSolution,
  selectFinalizationSource,
  selectFirstAchievement,
} from '../src/app/core/solution-workflow/finalization';
import { SOLUTION_OUTPUT_KINDS } from '../src/app/core/v9-contracts';
import type { SolutionBlobRecord, SolutionFiles } from '../src/app/core/solution-workflow/files';
export async function ready() {
  const { store, role } = harness();
  role('solution');
  store.state().roundId = 'R';
  Object.assign(store, { activeWorkspaceId: 'W' });
  const rows = new Map<string, SolutionBlobRecord>();
  const files: SolutionFiles = {
    async put(id, row) {
      rows.set(id, row);
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
  };
  const context = { workspaceId: 'W', roundId: 'R', operationId: 'F1' };
  const opportunityId = 'DEMO-O008';
  store.sale(opportunityId)!.productNeeds = [
    { id: 'NEED', model: 'SMILE', quantity: 1, unit: '台' },
  ];
  store.sale(opportunityId)!.productNeedRevision = 1;
  setSolutionSchedule(
    store,
    {
      opportunityId,
      pmPersonId: SOLUTION_PEOPLE.find((p) => p.name === '王项目')!.personId,
      ownerPersonId: SOLUTION_PEOPLE.find((p) => p.name === '周方案')!.personId,
      deadlineDate: '2026-10-20',
      note: '首次约定',
    },
    { ...context, operationId: 'S' },
  );
  for (const kind of SOLUTION_OUTPUT_KINDS)
    await uploadSolutionOutput(
      store,
      {
        opportunityId,
        kind,
        file: new File(
          ['bytes'],
          kind + { proposal: '.pptx', bom: '.xlsx', sld: '.pdf', degradation: '.csv' }[kind],
        ),
        note: '',
      },
      { ...context, operationId: kind },
      files,
    );
  const source = selectFinalizationSource(store.state(), opportunityId, {});
  const input = {
    scheduleRevision: source.schedule!.revision,
    opportunityId,
    fourVersionIds: source.fourVersionIds!,
    productNeedRevision: source.productNeedRevision!,
    ownerPersonId: source.schedule!.owner.personId,
    actingOnBehalf: false,
  };
  return { store, files, rows, context, input };
}
