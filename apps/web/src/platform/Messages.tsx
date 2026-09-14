import { useEffect, useRef, useState } from 'react';
import type { TeamConversation, TeamMessage } from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import {
  Blank,
  ErrorMessage,
  navigate,
  Panel,
  platform,
  stamp,
  teamName,
  teams,
  useCommand,
  type PageProps,
} from './shared';

export function Messages({ data, actions, id }: PageProps & { id: string }) {
  const [conversation, setConversation] = useState<TeamConversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [body, setBody] = useState('');
  const [report, setReport] = useState<TeamMessage | null>(null);
  const [reason, setReason] = useState('');
  const cmd = useCommand(actions);
  const loadSequence = useRef(0);
  const own = data.member?.teamId;
  const other = teams(data).find((team) => team.id === id && team.id !== own);
  const summary = platform(data).conversations.find((item) => item.otherTeamId === id);
  async function load() {
    if (!other) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      const next = await actions.gateway.conversation!(other.id);
      if (sequence !== loadSequence.current) return;
      setConversation(next);
      if (summary?.unread) await cmd.run({ type: 'readConversation', otherTeamId: other.id });
    } catch (e) {
      if (sequence === loadSequence.current)
        setLoadError(e instanceof Error ? e.message : 'Could not load messages.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setConversation(null);
    setBody('');
  }, [id]);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [id, summary?.updatedAt]);
  if (!own)
    return (
      <>
        <h1>Messages</h1>
        <Panel>
          <p>
            Team conversations are available to participants. Organizers review only reported
            messages in Admin.
          </p>
        </Panel>
      </>
    );
  const blocked = !!conversation?.blockedBy.length;
  const blockedByUs = conversation?.blockedBy.includes(own) || false;
  return (
    <>
      <div className="p-page-heading">
        <h1>Messages</h1>
        <span className="muted">Shared team inbox</span>
      </div>
      <div className={`p-inbox ${other ? 'conversation-open' : ''}`}>
        <aside className="p-inbox-list">
          <label className="field">
            <span>Start a conversation</span>
            <select
              value={other?.id || ''}
              onChange={(event) => navigate('messages', event.target.value)}
            >
              <option value="">Choose a team</option>
              {teams(data)
                .filter((team) => team.id !== own)
                .map((team) => (
                  <option value={team.id} key={team.id}>
                    {team.name}
                  </option>
                ))}
            </select>
          </label>
          <ul>
            {platform(data).conversations.map((item) => (
              <li key={item.id}>
                <button
                  aria-current={item.otherTeamId === id ? 'page' : undefined}
                  onClick={() => navigate('messages', item.otherTeamId)}
                >
                  <strong>
                    {teamName(data, item.otherTeamId)}
                    {item.unread && <span className="p-unread">Unread</span>}
                  </strong>
                  <span>{item.lastMessage}</span>
                  <small>
                    {stamp(item.updatedAt)}
                    {item.blocked ? ' · Blocked' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {!platform(data).conversations.length && (
            <Blank>No conversations yet. Open a project to ask the team a question.</Blank>
          )}
        </aside>
        <section className="p-conversation">
          {other ? (
            <>
              <div className="p-section-heading">
                <div>
                  <button className="p-link p-mobile-only" onClick={() => navigate('messages')}>
                    ← Inbox
                  </button>
                  <h2>{other.name}</h2>
                </div>
                <div className="p-actions">
                  <button className="p-link" onClick={() => navigate('projects', other.id)}>
                    Project
                  </button>
                  <button
                    className="p-link"
                    disabled={cmd.pending}
                    onClick={() =>
                      void cmd.run(
                        { type: 'blockConversation', otherTeamId: other.id, blocked: !blockedByUs },
                        () => void load(),
                      )
                    }
                  >
                    {blockedByUs ? 'Unblock' : 'Block'}
                  </button>
                </div>
              </div>
              <p className="muted">
                Visible to both teams. Keep questions about the project; do not arrange reciprocal
                investments.
              </p>
              <div className="p-message-list" aria-live="polite">
                {conversation?.messages.map((message) => (
                  <article key={message.id} className={message.fromTeamId === own ? 'own' : ''}>
                    <header>
                      <strong>{message.authorName}</strong>
                      <time>{stamp(message.createdAt)}</time>
                    </header>
                    <p>{message.body}</p>
                    {message.fromTeamId !== own && (
                      <button
                        className="p-link"
                        onClick={() => {
                          setReport(message);
                          setReason('');
                        }}
                      >
                        Report
                      </button>
                    )}
                  </article>
                ))}
                {!conversation?.messages.length && !loading && (
                  <Blank>No messages yet. Introduce your team or ask to see the demo.</Blank>
                )}
                {loading && <p role="status">Loading conversation…</p>}
              </div>
              {blocked ? (
                <p className="p-note">
                  {blockedByUs
                    ? 'Your team has blocked this conversation.'
                    : 'This conversation is blocked.'}
                </p>
              ) : (
                <form
                  className="p-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void cmd.run(
                      { type: 'sendMessage', toTeamId: other.id, body: body.trim() },
                      () => {
                        setBody('');
                        void load();
                      },
                    );
                  }}
                >
                  <Field label="Message">
                    <textarea
                      required
                      rows={3}
                      maxLength={1000}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                    />
                  </Field>
                  <button className="button primary" disabled={cmd.pending || !body.trim()}>
                    Send message
                  </button>
                </form>
              )}
            </>
          ) : (
            <Blank>Choose a team conversation.</Blank>
          )}
          <ErrorMessage>{loadError || cmd.error}</ErrorMessage>
          {loadError && (
            <button className="button secondary" onClick={() => void load()}>
              Retry
            </button>
          )}
        </section>
      </div>
      {report && other && (
        <Dialog title="Report message" onClose={() => setReport(null)}>
          <blockquote className="p-prose">{report.body}</blockquote>
          <p>Only this message and your reason are sent to the organizers.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void cmd.run(
                { type: 'reportMessage', otherTeamId: other.id, messageId: report.id, reason },
                () => setReport(null),
              );
            }}
          >
            <Field label="Reason">
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <ErrorMessage>{cmd.error}</ErrorMessage>
            <button className="button primary" disabled={cmd.pending}>
              Send report
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
