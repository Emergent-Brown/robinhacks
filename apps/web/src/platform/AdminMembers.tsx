import { useState } from 'react';
import type { AccessRequest, Member } from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import {
  Blank,
  config,
  ErrorMessage,
  Panel,
  stamp,
  teamName,
  useCommand,
  type CommandInput,
  type PageProps,
} from './shared';
import './team-formation.css';

const isStaff = (role: Member['role']) => role === 'organizer' || role === 'judge';
const roleLabel = (role: string) => (role === 'trader' ? 'Designated investor' : role);

export function AdminMembers({ data, actions }: PageProps) {
  const [email, setEmail] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    command: CommandInput;
    label?: string;
  } | null>(null);
  const cmd = useCommand(actions);
  const settings = config(data);
  const pending = data.requests
    .filter((request) => request.status === 'pending')
    .sort((a, b) => a.requestedAt - b.requestedAt);
  const members = data.members
    .filter((member) => member.status !== 'pending')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const unassigned = members.filter(
    (member) => member.status === 'approved' && !isStaff(member.role) && !member.teamId,
  );
  const registration = ['DRAFT', 'REGISTRATION'].includes(data.event!.phase);
  const rosterEditable = registration || (data.event!.paused && !data.event!.activeOperationId);
  const canApprove = registration && !settings.rulesLockedAt;
  const formationOpen = !!settings.teamFormationOpen;
  const approvedOrganizers = members.filter(
    (member) => member.role === 'organizer' && member.status === 'approved',
  ).length;

  function confirm(title: string, description: string, command: CommandInput, label?: string) {
    cmd.clearError();
    setConfirmation({ title, description, command, label });
  }
  async function checkRequests() {
    setRefreshing(true);
    setRefreshError('');
    try {
      await actions.gateway.snapshot(true);
      await actions.refresh();
      setCheckedAt(Date.now());
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : 'Could not check requests. Try again.',
      );
    } finally {
      setRefreshing(false);
    }
  }
  function approve(request: AccessRequest) {
    if (request.requestedRole === 'judge') {
      confirm(
        'Approve judge access',
        `Give ${request.displayName} (${request.email}) permission to judge assigned projects?`,
        { type: 'setMemberRole', uid: request.uid, role: 'judge', status: 'approved' },
        'Approve judge',
      );
    } else {
      void cmd.run({ type: 'approveMembership', uid: request.uid });
    }
  }
  function remove(uid: string, name: string, address?: string) {
    confirm(
      'Remove event access',
      `Remove ${name} (${address || uid}) from this event? Their access request and team membership will be removed. Their project, investments, and submitted records will stay.`,
      { type: 'removeMember', uid },
      'Remove access',
    );
  }

  return (
    <>
      <Panel
        title={`Pending approvals (${pending.length})`}
        aside={
          <button
            className="p-link"
            disabled={refreshing || cmd.pending}
            onClick={() => void checkRequests()}
          >
            {refreshing ? 'Checking…' : 'Check for sign-ups'}
          </button>
        }
      >
        <p className="muted">
          Check the attendee’s name and verified email, then approve access. They’ll choose their
          own team when you open team selection.
        </p>
        {checkedAt && (
          <p className="muted" role="status">
            Checked at{' '}
            {new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
          </p>
        )}
        <ErrorMessage>{refreshError}</ErrorMessage>
        {!pending.length && <Blank>No one is waiting for approval.</Blank>}
        <ul className="p-request-list">
          {pending.map((request) => (
            <li key={request.uid}>
              <div>
                <strong>{request.displayName}</strong>
                <p>
                  {request.email || 'Email unavailable'} ·{' '}
                  {request.emailVerified ? 'Verified email' : 'Email not verified'}
                </p>
                <p>
                  {request.requestedRole === 'judge' ? 'Judge request · ' : ''}
                  {stamp(request.requestedAt, settings.details.timeZone)}
                </p>
              </div>
              <div className="p-actions">
                <button
                  className="button primary"
                  disabled={
                    !request.emailVerified ||
                    !request.email ||
                    cmd.pending ||
                    (request.requestedRole === 'judge' ? !rosterEditable : !canApprove)
                  }
                  onClick={() => approve(request)}
                >
                  Approve{request.requestedRole === 'judge' ? ' judge' : ''}
                </button>
                <button
                  className="p-link p-member-danger"
                  disabled={cmd.pending || !rosterEditable}
                  onClick={() => remove(request.uid, request.displayName, request.email)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!canApprove && (
          <p className="muted">Participant approvals close when the first funding round opens.</p>
        )}
      </Panel>
      <Panel
        title="Team selection"
        aside={<span className="p-status">{formationOpen ? 'Open' : 'Closed'}</span>}
      >
        <p>
          <strong>{unassigned.length}</strong> approved{' '}
          {unassigned.length === 1 ? 'participant is' : 'participants are'} waiting to choose a
          team.
        </p>
        <p className="muted">
          When open, approved participants create or join a team and choose an available role.
          Everyone needs a team before using the event workspace. Close team selection before
          opening the first funding round.
        </p>
        <button
          className="button primary"
          disabled={
            cmd.pending ||
            data.event!.phase !== 'REGISTRATION' ||
            !!settings.rulesLockedAt ||
            data.event!.paused
          }
          onClick={() =>
            confirm(
              formationOpen ? 'Close team selection' : 'Start team selection',
              formationOpen
                ? `Close team selection now? ${unassigned.length} approved participants still need a team and will remain on the waiting screen until selection reopens.`
                : 'Let approved participants create or join a team and choose their role now?',
              {
                type: 'setTeamFormation',
                open: !formationOpen,
                expectedPhaseVersion: data.event!.phaseVersion,
              },
              formationOpen ? 'Close team selection' : 'Start team selection',
            )
          }
        >
          {formationOpen ? 'Close team selection' : 'Start team selection'}
        </button>
        {settings.rulesLockedAt && <p className="muted">Team rosters locked when funding began.</p>}
        {data.event!.paused && <p className="muted">Resume the event to change team selection.</p>}
      </Panel>
      <Panel title="Members and staff">
        <p className="muted">
          Each team has one captain and up to one designated investor. Other teammates join as
          members. Pause the event before removing access after registration.
        </p>
        {settings.rulesLockedAt && data.event!.paused && (
          <p className="p-note">
            If a captain or designated investor is missing, use an approved teammate’s role menu to
            fill the vacant role. Existing filled roles stay locked.
          </p>
        )}
        {!members.length ? (
          <Blank>No approved members yet.</Blank>
        ) : (
          <div className="p-table-wrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Team / role</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const protectedMember =
                    member.uid === data.member?.uid ||
                    (member.role === 'organizer' &&
                      member.status === 'approved' &&
                      approvedOrganizers <= 1);
                  return (
                    <tr key={member.uid}>
                      <td>
                        <strong>{member.displayName}</strong>
                        <small className="p-cell-note p-break">
                          {member.email || 'Email unavailable'}
                        </small>
                      </td>
                      <td>
                        {member.teamId
                          ? teamName(data, member.teamId)
                          : isStaff(member.role)
                            ? 'Staff'
                            : 'Waiting for a team'}
                        <small className="p-cell-note">{roleLabel(member.role)}</small>
                      </td>
                      <td>
                        <MemberActions
                          member={member}
                          roles={memberRoleOptions(member, data)}
                          disabled={cmd.pending || !rosterEditable || protectedMember}
                          onChange={(command) =>
                            confirm(
                              'Change event access',
                              `Change ${member.displayName} (${member.email || member.uid}) to ${roleLabel(command.role)}, with ${command.status} access?`,
                              command,
                            )
                          }
                          onRemove={() => remove(member.uid, member.displayName, member.email)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Organizer emails">
        <p>
          Add a Google account email to grant organizer access. That person will receive access when
          they next sign in or refresh the site.
        </p>
        <form
          className="p-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const address = email.trim().toLowerCase();
            confirm(
              'Grant organizer access',
              `Give ${address} organizer access? They will be able to approve attendees, manage the event, change settings, and publish results.`,
              { type: 'addOrganizerEmail', email: address },
              'Add organizer email',
            );
          }}
        >
          <Field label="Google account email">
            <input
              type="email"
              autoComplete="off"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </Field>
          <button
            className="button secondary"
            disabled={cmd.pending || !email.trim() || !rosterEditable}
          >
            Add organizer
          </button>
        </form>
        {!!data.organizerInvites?.length && (
          <ul className="p-admin-invites">
            {data.organizerInvites.map((invite) => (
              <li key={invite.email}>
                <div>
                  <strong>{invite.email}</strong>
                  <small className="p-cell-note">
                    Added {stamp(invite.createdAt, settings.details.timeZone)}
                  </small>
                </div>
                <button
                  className="p-link p-member-danger"
                  disabled={
                    cmd.pending ||
                    !rosterEditable ||
                    data.members.some(
                      (member) =>
                        member.email?.toLowerCase() === invite.email.toLowerCase() &&
                        (member.uid === data.member?.uid ||
                          (member.role === 'organizer' &&
                            member.status === 'approved' &&
                            approvedOrganizers <= 1)),
                    )
                  }
                  onClick={() =>
                    confirm(
                      'Remove organizer email',
                      `Remove organizer access for ${invite.email}? This removes their email invitation and any existing organizer membership for this account. Submitted event records stay.`,
                      { type: 'removeOrganizerEmail', email: invite.email },
                      'Remove organizer access',
                    )
                  }
                >
                  Remove access
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      {confirmation && (
        <Dialog title={confirmation.title} onClose={() => !cmd.pending && setConfirmation(null)}>
          <p>{confirmation.description}</p>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <div className="p-actions">
            <button
              className="button primary"
              disabled={cmd.pending}
              onClick={() =>
                void cmd.run(confirmation.command, () => {
                  if (confirmation.command.type === 'addOrganizerEmail') setEmail('');
                  setConfirmation(null);
                })
              }
            >
              {cmd.pending ? 'Saving…' : confirmation.label || 'Confirm change'}
            </button>
            <button
              className="button secondary"
              disabled={cmd.pending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function MemberActions({
  member,
  roles,
  disabled,
  onChange,
  onRemove,
}: {
  member: Member;
  roles: Member['role'][];
  disabled: boolean;
  onChange: (command: Extract<CommandInput, { type: 'setMemberRole' }>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="p-member-controls">
      <span>{member.status}</span>
      <select
        aria-label={`Change role for ${member.displayName}`}
        value={member.role}
        disabled={disabled || roles.length < 2}
        onChange={(event) =>
          onChange({
            type: 'setMemberRole',
            uid: member.uid,
            role: event.target.value as Member['role'],
            status: member.status,
          })
        }
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role)}
          </option>
        ))}
      </select>
      <button
        className="p-link"
        disabled={disabled}
        onClick={() =>
          onChange({
            type: 'setMemberRole',
            uid: member.uid,
            role: member.role,
            status: member.status === 'suspended' ? 'approved' : 'suspended',
          })
        }
      >
        {member.status === 'suspended' ? 'Restore' : 'Suspend'}
      </button>
      <button className="p-link p-member-danger" disabled={disabled} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

/** Show only role changes the server permits, including a vacant-role recovery while paused. */
function memberRoleOptions(member: Member, data: PageProps['data']): Member['role'][] {
  if (!member.teamId)
    return member.role === 'organizer'
      ? ['organizer', 'judge']
      : member.role === 'judge'
        ? ['judge']
        : ['member', 'judge'];
  const others = data.members.filter(
    (candidate) =>
      candidate.teamId === member.teamId &&
      candidate.uid !== member.uid &&
      candidate.status === 'approved',
  );
  const available = (role: Member['role']) =>
    role === 'member' || !others.some((candidate) => candidate.role === role);
  if (!config(data).rulesLockedAt)
    return (['captain', 'trader', 'member'] as const).filter(
      (role) => role === member.role || available(role),
    );
  const result: Member['role'][] = [member.role];
  if (
    member.status !== 'approved' ||
    !data.event!.paused ||
    ['FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(data.event!.phase)
  )
    return result;
  if (member.role !== 'captain' && available('captain')) result.push('captain');
  if (member.role === 'member' && available('trader')) result.push('trader');
  return result;
}
