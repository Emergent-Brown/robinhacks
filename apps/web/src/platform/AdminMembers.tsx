import { useState } from 'react';
import type { AccessRequest, Member } from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import { AdminPersonEditor } from './AdminPersonEditor';
import { managementLockReason } from './admin-management';
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
import './admin-management.css';

const isStaff = (role: Member['role']) => role === 'organizer' || role === 'judge';
const roleLabel = (role: string) => (role === 'trader' ? 'Member' : role);

export function AdminMembers({ data, actions }: PageProps) {
  const [emails, setEmails] = useState('');
  const addresses = [
    ...new Set(
      emails
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const emailError =
    addresses.length > 50
      ? 'Add up to 50 emails at a time.'
      : addresses.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        ? 'Enter complete email addresses, separated by commas or new lines.'
        : '';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Member | null>(null);
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
    .filter((member) => member.status !== 'pending' && member.role !== 'organizer')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const unassigned = members.filter(
    (member) => member.status === 'approved' && !isStaff(member.role) && !member.teamId,
  );
  const registration = ['DRAFT', 'REGISTRATION'].includes(data.event!.phase);
  const rosterEditable = registration || (data.event!.paused && !data.event!.activeOperationId);
  const canApprove = registration && !settings.rulesLockedAt;
  const formationOpen = !!settings.teamFormationOpen;
  const managementLock = managementLockReason(data);
  const visibleMembers = members.filter(
    (member) =>
      `${member.displayName} ${member.email || ''} ${member.teamId ? teamName(data, member.teamId) : ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'staff' && isStaff(member.role)) ||
        (filter === 'participants' && !isStaff(member.role)) ||
        (filter === 'unassigned' && !isStaff(member.role) && !member.teamId) ||
        (filter === 'suspended' && member.status === 'suspended')),
  );
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(visibleMembers.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const displayedMembers = visibleMembers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const approvedOrganizers = data.members.filter(
    (member) => member.role === 'organizer' && member.status === 'approved',
  ).length;

  const organizers = new Map(
    (data.organizerInvites ?? []).map((invite) => [
      invite.email.toLowerCase(),
      {
        email: invite.email,
        createdAt: invite.createdAt,
        member: data.members.find(
          (member) =>
            member.role === 'organizer' &&
            member.email?.toLowerCase() === invite.email.toLowerCase(),
        ),
      },
    ]),
  );
  data.members
    .filter((member) => member.role === 'organizer')
    .forEach((member) => {
      if (member.email && !organizers.has(member.email.toLowerCase()))
        organizers.set(member.email.toLowerCase(), { email: member.email, createdAt: 0, member });
    });

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
      <Panel title="Signup approval">
        <label className="p-check">
          <input
            type="checkbox"
            checked={!!settings.autoApproveParticipants}
            disabled={!canApprove || cmd.pending}
            onChange={(event) =>
              void cmd.run({
                type: 'setSignupPolicy',
                autoApprove: event.target.checked,
                expectedPhaseVersion: data.event!.phaseVersion,
              })
            }
          />
          <span>Automatically approve new participants</span>
        </label>
        <p className="muted">
          Applies to new verified Google signups. Existing requests and judge requests still need
          review. Limit: 160 participants; four people per team.
        </p>
        <ErrorMessage>{cmd.error}</ErrorMessage>
      </Panel>
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
      <Panel title="Organizers">
        <p>
          Add up to 50 Google account emails at once. Existing accounts become organizers
          immediately; participants leave their competing team. New organizers receive access when
          they sign in. Organizers are listed here, separate from participants.
        </p>
        {!rosterEditable && (
          <p className="p-note">
            Pause the event before promoting a team member or judge. Those roles are locked once
            results review starts. New organizer emails can still be added.
          </p>
        )}
        <form
          className="p-organizer-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (emailError || !addresses.length) return;
            confirm(
              'Grant organizer access',
              `Give ${addresses.length} ${addresses.length === 1 ? 'person' : 'people'} organizer access? They can approve attendees, manage the event, change settings, and publish results. Existing participants and judges leave their current event role; participants also leave their team. Emails: ${addresses.join(', ')}.`,
              { type: 'addOrganizerEmails', emails: addresses },
              `Add ${addresses.length === 1 ? 'organizer' : 'organizers'}`,
            );
          }}
        >
          <Field label="Google account emails" hint="One email per line, or separated by commas.">
            <textarea
              rows={4}
              autoComplete="off"
              required
              maxLength={13000}
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder={'alex@example.com\nsam@example.com'}
            />
          </Field>
          <button
            className="button secondary"
            disabled={cmd.pending || !addresses.length || !!emailError}
          >
            Add {addresses.length > 1 ? `${addresses.length} organizers` : 'organizer'}
          </button>
        </form>
        <ErrorMessage>{emailError}</ErrorMessage>
        {!!organizers.size && (
          <ul className="p-admin-invites">
            {[...organizers.values()].map((invite) => (
              <li key={invite.email}>
                <div>
                  <strong className="p-break">{invite.email}</strong>
                  <small className="p-cell-note">
                    {invite.member
                      ? `${invite.member.displayName} · ${invite.member.status}`
                      : 'Awaiting first sign-in'}
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
      <Panel title="Participants and judges">
        <p className="muted">
          Each team has up to four people: one captain and the remaining teammates join as members.
          Pause the event before removing access after registration.
        </p>
        {settings.rulesLockedAt && data.event!.paused && (
          <p className="p-note">
            Use Edit to move approved people between teams or change their roles. Change a filled
            captain or investor role to member before giving it to someone else. Past investments
            stay with their original team.
          </p>
        )}
        {managementLock && <p className="p-note">{managementLock}</p>}
        <div className="p-admin-toolbar">
          <Field label="Find a person">
            <input
              type="search"
              placeholder="Name, email, or team"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Show">
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Participants and judges</option>
              <option value="participants">Participants</option>
              <option value="unassigned">Waiting for a team</option>
              <option value="staff">Judges</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
        </div>
        <p className="p-admin-count">
          {visibleMembers.length} of {members.length} people
        </p>
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
                {displayedMembers.map((member) => {
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
                        <button
                          className="p-link"
                          disabled={cmd.pending || !!managementLock}
                          onClick={() => setEditing(member)}
                        >
                          Edit person / team
                        </button>
                        <MemberActions
                          member={member}
                          roles={
                            member.role === 'organizer'
                              ? ['organizer', 'judge']
                              : member.role === 'judge'
                                ? ['judge']
                                : ['member', 'judge']
                          }
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
        {pageCount > 1 && (
          <nav className="p-member-pagination" aria-label="Participant pages">
            <button
              className="button secondary"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span aria-live="polite">
              Page {currentPage} of {pageCount}
            </span>
            <button
              className="button secondary"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </nav>
        )}
        {!!members.length && !visibleMembers.length && (
          <Blank>No participants match your search.</Blank>
        )}
      </Panel>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      {editing && (
        <AdminPersonEditor
          data={data}
          actions={actions}
          member={editing}
          onClose={() => setEditing(null)}
        />
      )}
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
                  if (confirmation.command.type === 'addOrganizerEmails') setEmails('');
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
      {!member.teamId && (
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
      )}
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
