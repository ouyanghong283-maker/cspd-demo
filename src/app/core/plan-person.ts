import { Project, ROLES } from './models';
import { INTERNAL_PEOPLE } from './personnel';
import { identityForLegacyPlatformName } from './identity';

function normalizePersonId(personId: string): string {
  const role = ROLES.find((item) => item.id !== 'outsider' && `demo-role:${item.id}` === personId);
  return role ? knownDemoPersonId(role.person)! : personId;
}

export function knownDemoPersonId(name: string): string | undefined {
  const person = name.trim();
  if (!INTERNAL_PEOPLE.includes(person)) return undefined;
  return identityForLegacyPlatformName(person)?.personId || `demo-person:${person}`;
}

/** Explicit IDs survive display changes; legacy names resolve only against known identities. */
export function knownProjectPersonId(
  project: Project,
  name: string,
  personId?: string,
): string | undefined {
  if (personId) {
    if (INTERNAL_PEOPLE.some((person) => knownDemoPersonId(person) === personId)) return personId;
    if (ROLES.some((role) => role.id !== 'outsider' && `demo-role:${role.id}` === personId))
      return knownDemoPersonId(ROLES.find((role) => `demo-role:${role.id}` === personId)!.person);
    const member = project.team.find((item) => item.id === personId);
    return member?.personId ? normalizePersonId(member.personId) : member?.id;
  }
  const demoPersonId = knownDemoPersonId(name);
  if (demoPersonId) return demoPersonId;
  const members = project.team.filter((item) => item.person === name && item.id);
  return members.length === 1 ? normalizePersonId(members[0].personId || members[0].id) : undefined;
}
