import type { AppSnapshot, Member } from '@robinhacks/core';

export const roleLabel = (role: Member['role']) =>
  role === 'trader' ? 'Member' : role[0]!.toUpperCase() + role.slice(1);

function eventManagementLockReason(data: AppSnapshot): string {
  const event = data.event!;
  if (['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase) || event.publishedResultId)
    return 'This event has ended. Its published records are read-only.';
  if (event.phase === 'FINALIZING')
    return 'Discard the award preview in Event controls before making corrections.';
  if (event.activeOperationId) return 'Wait for the current event operation to finish.';
  return '';
}

export function managementLockReason(data: AppSnapshot): string {
  const locked = eventManagementLockReason(data);
  if (locked) return locked;
  const event = data.event!;
  if (!['DRAFT', 'REGISTRATION'].includes(event.phase) && !event.paused)
    return 'Pause the event in Event controls to change people, teams, or projects.';
  return '';
}

/** New teams do not change the eligibility snapshots of existing funding rounds. */
export function teamCreationLockReason(data: AppSnapshot): string {
  return eventManagementLockReason(data);
}

/** Adding an approved unassigned person does not disrupt an existing team assignment. */
export function assignmentLockReason(data: AppSnapshot, member: Member): string {
  const canAdd =
    member.teamId === null &&
    member.status === 'approved' &&
    member.emailVerified === true &&
    !['organizer', 'judge'].includes(member.role);
  return canAdd ? eventManagementLockReason(data) : managementLockReason(data);
}
