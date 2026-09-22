import { useState } from 'react';
import { RULES, type AccessRequest, type Member } from '@robinhacks/core';
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

export function AdminMembers({ data, actions }: PageProps) {
  const [review, setReview] = useState<AccessRequest | null>(null);
  const [assignment, setAssignment] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    command: CommandInput;
  } | null>(null);
  const cmd = useCommand(actions);
  const pending = data.requests
    .filter((request) => request.status === 'pending')
    .sort((a, b) => a.requestedAt - b.requestedAt);
  const members = data.members
    .filter((member) => member.status !== 'pending')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const activeTeams = data.market.entries
    .map(({ team }) => team)
    .filter((team) => team.eligibility === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
  const rosterEditable =
    ['DRAFT', 'REGISTRATION'].includes(data.event!.phase) ||
    (data.event!.paused &&
      !data.event!.activeOperationId &&
      ['SEED_OPEN', 'INTERMISSION', 'TRADING_OPEN', 'FROZEN'].includes(data.event!.phase));
  const canApproveParticipants = rosterEditable && !config(data).rulesLockedAt;
  const canCreateTeam =
    canApproveParticipants &&
    ['DRAFT', 'REGISTRATION'].includes(data.event!.phase) &&
    data.market.entries.length < RULES.maxTeams;
  const duplicateTeamName = activeTeams.some(
    (team) => team.name.toLowerCase() === newTeamName.trim().toLowerCase(),
  );

  function openReview(request: AccessRequest) {
    cmd.clearError();
    setReview(request);
    const proposed = activeTeams.find(
      (team) =>
        team.id === request.teamId ||
        (!!request.teamName && team.name.toLowerCase() === request.teamName.toLowerCase()),
    );
    setAssignment(proposed ? proposed.id : request.teamName && canCreateTeam ? 'new' : '');
    setNewTeamName(request.teamId ? '' : request.teamName || '');
  }

  async function checkRequests() {
    setRefreshing(true);
    setRefreshError('');
    try {
      // The app refresh handles errors internally, so check the network result first.
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

  function approveRequest(request: AccessRequest) {
    if (!request.emailVerified || !request.email) return;
    if (request.requestedRole && rosterEditable) {
      void cmd.run(
        {
          type: 'setMemberRole',
          uid: request.uid,
          role: request.requestedRole,
          status: 'approved',
        },
        () => setReview(null),
      );
    } else if (canApproveParticipants && assignment === 'new' && canCreateTeam) {
      if (newTeamName.trim().length < 2 || duplicateTeamName) return;
      void cmd.run(
        {
          type: 'approveMembership',
          uid: request.uid,
          role: 'captain',
          teamName: newTeamName.trim(),
        },
        () => setReview(null),
      );
    } else if (canApproveParticipants && activeTeams.some((team) => team.id === assignment)) {
      void cmd.run(
        { type: 'approveMembership', uid: request.uid, role: 'member', teamId: assignment },
        () => setReview(null),
      );
    }
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
          People sign in with Google and enter their name. Check their email, assign a team, then
          approve them here. Only organizers can grant access.
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
                  {request.emailVerified ? 'Verified email' : 'Email not verified'} ·{' '}
                  {stamp(request.requestedAt, config(data).details.timeZone)}
                </p>
                <p>
                  {request.requestedRole
                    ? `Staff request: ${request.requestedRole}`
                    : request.teamId
                      ? `Requested ${request.teamName || teamName(data, request.teamId)}`
                      : request.teamName
                        ? `Suggested team: ${request.teamName}`
                        : 'Needs a team assignment'}
                </p>
              </div>
              <button
                className="button primary"
                disabled={
                  !request.emailVerified ||
                  !request.email ||
                  cmd.pending ||
                  (request.requestedRole ? !rosterEditable : !canApproveParticipants)
                }
                onClick={() => openReview(request)}
              >
                Review and approve
              </button>
            </li>
          ))}
        </ul>
        {!canApproveParticipants && pending.some((request) => !request.requestedRole) && (
          <p className="muted">Team approval is closed after the first funding round.</p>
        )}
        {!rosterEditable && pending.some((request) => request.requestedRole) && (
          <p className="muted">Pause the event before approving staff access.</p>
        )}
      </Panel>
      <Panel title="Members and staff">
        <p className="muted">
          Rosters lock when the first funding round opens. To suspend event access after that point,
          pause the event first. Existing team members cannot become judges or organizers.
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
                {members.map((member) => (
                  <tr key={member.uid}>
                    <td>
                      <strong>{member.displayName}</strong>
                      <small className="p-cell-note p-break">
                        {member.email || 'Email unavailable'} ·{' '}
                        {member.emailVerified ? 'Verified' : 'Unverified'}
                      </small>
                    </td>
                    <td>
                      {member.teamId ? teamName(data, member.teamId) : 'Staff'}
                      <small className="p-cell-note">
                        {member.role === 'trader' ? 'Designated investor' : member.role}
                      </small>
                    </td>
                    <td>
                      <MemberActions
                        member={member}
                        disabled={cmd.pending}
                        onChange={(command) =>
                          setConfirmation({
                            title: 'Change event access',
                            description: `Apply this access change for ${member.displayName} (${member.email || member.uid})? New role: ${command.role}. Status: ${command.status}.`,
                            command,
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      {review && (
        <Dialog
          title={review.requestedRole ? `Approve ${review.requestedRole}` : 'Approve participant'}
          onClose={() => setReview(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              approveRequest(review);
            }}
          >
            <p>
              <strong>{review.displayName}</strong>
              <br />
              {review.email} · Verified email
            </p>
            {review.requestedRole ? (
              <p>
                This gives {review.displayName} {review.requestedRole} permissions. Verify that they
                are staff before approving.
              </p>
            ) : (
              <>
                <Field label="Assign to team">
                  <select
                    required
                    value={assignment}
                    onChange={(event) => setAssignment(event.target.value)}
                  >
                    <option value="" disabled>
                      Choose a team
                    </option>
                    {activeTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                    {canCreateTeam && <option value="new">Create a new team</option>}
                  </select>
                </Field>
                {assignment === 'new' && (
                  <Field label="New team name">
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={newTeamName}
                      onChange={(event) => setNewTeamName(event.target.value)}
                      placeholder="Enter the team's name"
                    />
                  </Field>
                )}
                {assignment === 'new' && duplicateTeamName && (
                  <p className="p-error">That team already exists. Choose it from the list.</p>
                )}
                <p className="muted">
                  {assignment === 'new'
                    ? `${review.displayName} will become the new team's captain.`
                    : assignment
                      ? `${review.displayName} will join as a team member.`
                      : 'Choose the team this person belongs to.'}
                </p>
                {!canApproveParticipants && (
                  <p className="p-error">Team approvals are closed for this event.</p>
                )}
              </>
            )}
            <ErrorMessage>{cmd.error}</ErrorMessage>
            <div className="p-actions">
              <button
                className="button primary"
                disabled={
                  cmd.pending ||
                  !review.emailVerified ||
                  !review.email ||
                  (review.requestedRole && !rosterEditable) ||
                  (!review.requestedRole &&
                    (!canApproveParticipants ||
                      !assignment ||
                      (assignment === 'new' &&
                        (!canCreateTeam || newTeamName.trim().length < 2 || duplicateTeamName))))
                }
              >
                {cmd.pending ? 'Approving…' : 'Approve access'}
              </button>
              <button className="button secondary" type="button" onClick={() => setReview(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {confirmation && (
        <Dialog title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p>{confirmation.description}</p>
          <ErrorMessage>{cmd.error}</ErrorMessage>
          <div className="p-actions">
            <button
              className="button primary"
              disabled={cmd.pending}
              onClick={() => void cmd.run(confirmation.command, () => setConfirmation(null))}
            >
              Confirm change
            </button>
            <button className="button secondary" onClick={() => setConfirmation(null)}>
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
  disabled,
  onChange,
}: {
  member: Member;
  disabled: boolean;
  onChange: (command: Extract<CommandInput, { type: 'setMemberRole' }>) => void;
}) {
  return (
    <div className="p-actions">
      <span>{member.status}</span>
      <select
        aria-label={`Change role for ${member.displayName}`}
        value={member.role}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            type: 'setMemberRole',
            uid: member.uid,
            role: event.target.value as Member['role'],
            status: member.status,
          })
        }
      >
        {(member.teamId ? ['captain', 'trader', 'member'] : ['judge', 'organizer']).map((role) => (
          <option key={role} value={role}>
            {role === 'trader' ? 'Designated investor' : role}
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
    </div>
  );
}
