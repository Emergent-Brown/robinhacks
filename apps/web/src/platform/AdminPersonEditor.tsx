import { useState } from 'react';
import type { FormationRole, Member } from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import { ErrorMessage, teams, useCommand, type PageProps } from './shared';
import { managementLockReason, roleLabel } from './admin-management';
import './admin-management.css';

export function AdminPersonEditor({
  data,
  actions,
  member,
  onClose,
}: PageProps & { member: Member; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(member.displayName);
  const [bio, setBio] = useState(member.bio || '');
  const [teamId, setTeamId] = useState(member.teamId || '');
  const [role, setRole] = useState<FormationRole>(
    member.role === 'captain' ? (member.role as FormationRole) : 'member',
  );
  const cmd = useCommand(actions);
  const locked = managementLockReason(data);
  const live = data.members.find((person) => person.uid === member.uid) || member;
  const changed = live.version !== member.version;
  const canAssign = member.status === 'approved' && !['organizer', 'judge'].includes(member.role);
  const available = (['captain', 'member'] as const).filter(
    (choice) =>
      choice === 'member' ||
      (teamId &&
        !data.members.some(
          (other) =>
            other.uid !== member.uid &&
            other.teamId === teamId &&
            other.status === 'approved' &&
            other.role === choice,
        )),
  );
  return (
    <Dialog title={`Edit ${member.displayName}`} onClose={() => !cmd.pending && onClose()}>
      <div className="p-admin-editor">
        {locked && <p className="p-note">{locked}</p>}
        {changed && (
          <p className="p-note">
            This person changed while you were editing. Close and reopen to load their current
            details.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void cmd.run(
              {
                type: 'adminUpdateMember',
                uid: member.uid,
                expectedVersion: member.version,
                displayName,
                bio,
              },
              onClose,
            );
          }}
        >
          <Field label="Name">
            <input
              required
              minLength={2}
              maxLength={60}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="Bio" hint="Optional. Visible with their team’s roster.">
            <textarea
              rows={3}
              maxLength={280}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
            />
          </Field>
          <p className="muted p-break">
            {member.email || 'No email available'} · Email belongs to their Google account and
            cannot be changed here.
          </p>
          <button className="button secondary" disabled={cmd.pending || !!locked || changed}>
            Save details
          </button>
        </form>
        <section className="p-admin-editor-section">
          <h3>Team and role</h3>
          {canAssign ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void cmd.run(
                  {
                    type: 'adminAssignMember',
                    uid: member.uid,
                    expectedVersion: member.version,
                    teamId: teamId || null,
                    role: teamId ? role : 'member',
                  },
                  onClose,
                );
              }}
            >
              <Field label="Team">
                <select
                  value={teamId}
                  onChange={(event) => {
                    setTeamId(event.target.value);
                    setRole('member');
                  }}
                >
                  <option value="">Unassigned — waiting for a team</option>
                  {teams(data)
                    .filter((team) => team.eligibility === 'active' || team.id === member.teamId)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((team) => (
                      <option
                        key={team.id}
                        value={team.id}
                        disabled={team.eligibility !== 'active'}
                      >
                        {team.name}
                        {team.eligibility !== 'active' ? ` (${team.eligibility})` : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Role">
                <select
                  value={role}
                  disabled={!teamId}
                  onChange={(event) => setRole(event.target.value as FormationRole)}
                >
                  {available.map((choice) => (
                    <option key={choice} value={choice}>
                      {roleLabel(choice)}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="muted">
                Up to four people per team. To transfer the captain role, change its current holder
                to member first.
              </p>
              {!!data.event!.platform?.rulesLockedAt && (
                <p className="p-note">
                  Moving someone gives them access to their new team’s workspace. Existing
                  investments and final submitted rosters remain with the original team.
                </p>
              )}
              <button
                className="button primary"
                disabled={
                  cmd.pending ||
                  !!locked ||
                  changed ||
                  !available.includes(role) ||
                  (teamId === (member.teamId || '') && role === member.role)
                }
              >
                Save team and role
              </button>
            </form>
          ) : (
            <p className="muted">
              {member.status !== 'approved'
                ? 'Approve or restore this person’s access before assigning a team.'
                : 'Organizer and judge accounts stay separate from competing teams.'}
            </p>
          )}
        </section>
        <ErrorMessage>{cmd.error}</ErrorMessage>
      </div>
    </Dialog>
  );
}
