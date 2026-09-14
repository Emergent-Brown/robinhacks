import { useState } from 'react';
import type { Member } from '@robinhacks/core';
import { Dialog } from '../ui/primitives';
import {
  Blank,
  ErrorMessage,
  Panel,
  teamName,
  useCommand,
  type CommandInput,
  type PageProps,
} from './shared';

export function AdminMembers({ data, actions }: PageProps) {
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    command: CommandInput;
  } | null>(null);
  const cmd = useCommand(actions);
  const pending = data.requests.filter((request) => request.status === 'pending');
  return (
    <>
      <Panel title="Access requests">
        <p className="muted">
          Check the verified email against your event roster. Judge and organizer requests require
          explicit staff approval.
        </p>
        {!pending.length && <Blank>No pending requests.</Blank>}
        <ul className="p-request-list">
          {pending.map((request) => (
            <li key={request.uid}>
              <div>
                <strong>{request.displayName}</strong>
                <p>
                  {request.email || 'No verified email available'} ·{' '}
                  {request.emailVerified ? 'Verified' : 'Not verified'}
                </p>
                <p>
                  {request.requestedRole
                    ? `${request.requestedRole} access`
                    : request.teamId
                      ? `Join ${request.teamName}`
                      : `New team: ${request.teamName}`}
                </p>
              </div>
              <button
                className="button secondary"
                disabled={!request.emailVerified || cmd.pending}
                onClick={() =>
                  setConfirmation(
                    request.requestedRole
                      ? {
                          title: `Approve ${request.requestedRole} access`,
                          description: `Grant ${request.displayName} (${request.email}) ${request.requestedRole} permissions for this event?`,
                          command: {
                            type: 'setMemberRole',
                            uid: request.uid,
                            role: request.requestedRole,
                            status: 'approved',
                          },
                        }
                      : {
                          title: 'Approve participant',
                          description: `Approve ${request.displayName} (${request.email}) for ${request.teamName}${request.teamId ? ' as a team member' : ' as the captain of a new team'}?`,
                          command: {
                            type: 'approveMembership',
                            uid: request.uid,
                            role: request.teamId ? 'member' : 'captain',
                            ...(request.teamId ? { teamId: request.teamId } : {}),
                          },
                        },
                  )
                }
              >
                Review approval
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Members and staff">
        <p className="muted">
          Rosters lock when the first funding round opens. To suspend event access after that point,
          pause the event first. Existing team members cannot become judges or organizers.
        </p>
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
              {data.members.map((member) => (
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
      </Panel>
      <ErrorMessage>{cmd.error}</ErrorMessage>
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
