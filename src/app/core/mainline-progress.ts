import type { OperationEvent } from './models';

/** A persisted object's explicit relationship to a sales mainline. */
export interface MainlineObjectOwnership {
  objectType: string;
  objectId: string;
  mainlineId: string;
}

export interface MainlineProgressInput {
  roundId: string;
  mainlineId: string;
  /** Prior or related mainline IDs that are explicitly part of this same line. */
  mainlineAliases?: readonly string[];
  events: readonly OperationEvent[];
  /** Registered progress sections and the exact OperationEvent.module values they own. */
  registeredModules: readonly MainlineProgressModuleRegistration[];
  ownership: readonly MainlineObjectOwnership[];
}

export interface MainlineProgressModuleRegistration {
  id: 'sales' | 'solution' | 'quote' | 'contract' | 'startup';
  label: string;
  eventModules: readonly string[];
}

export interface MainlineModuleProgress {
  id: MainlineProgressModuleRegistration['id'];
  label: string;
  done: boolean;
  /** Valid operations are retained as trace entries; multiple operations count once. */
  events: OperationEvent[];
}

export interface MainlineProgress {
  roundId: string;
  mainlineId: string;
  modules: MainlineModuleProgress[];
  /** Events that may belong to this line, but whose source cannot be verified. */
  pendingVerification: OperationEvent[];
}

const NON_OPERATION_TERMS = ['导航', '打开页面', '页面访问', '样例', '示例'];

function hasMeaningfulOperation(event: OperationEvent): boolean {
  if (!event.changes?.length && event.taskSource?.kind !== 'explicit-action') return false;
  const description = `${event.action} ${event.taskSource?.kind || ''}`;
  return !NON_OPERATION_TERMS.some((term) => description.includes(term));
}

function belongsToMainline(
  event: OperationEvent,
  ownership: readonly MainlineObjectOwnership[],
  mainlineIds: ReadonlySet<string>,
): 'yes' | 'no' | 'unknown' {
  const matches = ownership.filter(
    (item) => item.objectType === event.objectType && item.objectId === event.objectId,
  );
  if (!matches.length) return 'unknown';
  return matches.some((item) => mainlineIds.has(item.mainlineId)) ? 'yes' : 'no';
}

/**
 * Calculates progress from committed module events for one round and mainline.
 * Navigation, samples, empty saves, legacy events and events from unregistered
 * modules do not complete a module. Ownership gaps are surfaced for review.
 */
export function calculateMainlineProgress(input: MainlineProgressInput): MainlineProgress {
  const registrations = input.registeredModules.filter(
    (registration, index, all) => all.findIndex((item) => item.id === registration.id) === index,
  );
  const mainlineIds = new Set([input.mainlineId, ...(input.mainlineAliases || [])]);
  const eventsBySection = new Map(registrations.map(({ id }) => [id, [] as OperationEvent[]]));
  const pendingVerification: OperationEvent[] = [];

  for (const event of input.events) {
    if (event.roundId !== input.roundId) continue;
    const missingMainline = !event.mainlineId || event.legacyMissingFields?.includes('mainlineId');
    if (!mainlineIds.has(event.mainlineId) && !missingMainline) continue;
    if (missingMainline && !mainlineIds.has(event.mainlineId)) {
      const possibleOwner = belongsToMainline(event, input.ownership, mainlineIds);
      if (possibleOwner === 'yes' && hasMeaningfulOperation(event)) pendingVerification.push(event);
      continue;
    }
    const registration = registrations.find((item) => item.eventModules.includes(event.module));
    if (!registration) {
      pendingVerification.push(event);
      continue;
    }
    if (!hasMeaningfulOperation(event)) continue;

    if (event.legacy || event.legacyMissingFields?.length) {
      pendingVerification.push(event);
      continue;
    }

    const ownership = belongsToMainline(event, input.ownership, mainlineIds);
    if (ownership === 'unknown') {
      pendingVerification.push(event);
      continue;
    }
    if (ownership === 'no') continue;
    eventsBySection.get(registration.id)!.push(event);
  }

  return {
    roundId: input.roundId,
    mainlineId: input.mainlineId,
    modules: registrations.map(({ id, label }) => {
      const events = eventsBySection.get(id)!;
      return { id, label, done: events.length > 0, events };
    }),
    pendingVerification,
  };
}
