import type { AppSnapshot, Member } from '@robinhacks/core';

export const roleLabel = (role: Member['role']) =>
  role === 'trader' ? 'Member' : role[0]!.toUpperCase() + role.slice(1);

export function managementLockReason(data: AppSnapshot): string {
  const event = data.event!;
  if (['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase) || event.publishedResultId)
    return 'This event has ended. Its published records are read-only.';
  if (event.phase === 'FINALIZING')
    return 'Discard the award preview in Event controls before making corrections.';
  if (event.activeOperationId) return 'Wait for the current event operation to finish.';
  if (!['DRAFT', 'REGISTRATION'].includes(event.phase) && !event.paused)
    return 'Pause the event in Event controls to change people, teams, or projects.';
  return '';
}
