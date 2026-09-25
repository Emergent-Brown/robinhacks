import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ConversationDirectoryEntry,
  GeneralMessage,
  MessagePage,
  MessageRequest,
  TeamMessage,
} from '@robinhacks/core';
import { Dialog, Field } from '../ui/primitives';
import { newCommandId } from '../app/gateway';
import {
  Blank,
  ErrorMessage,
  navigate,
  platform,
  stamp,
  teamName,
  teams,
  useCommand,
  type PageProps,
} from './shared';
import './messaging.css';
import { mergeMessagePages } from './message-history';

type ChatMessage = TeamMessage | GeneralMessage;

export function Messages({ data, actions, id }: PageProps & { id: string }) {
  const organizer = data.member?.role === 'organizer';
  const own = data.member?.teamId;
  const filterShortcut = organizer && (id.startsWith('team:') || id.startsWith('person:'));
  const accessContext = `${data.member?.uid}:${data.member?.role}:${data.member?.teamId}:${data.member?.status}:${data.member?.version}`;
  const selected = filterShortcut ? 'general' : id || 'general';
  const [showInbox, setShowInbox] = useState(false);
  const [directory, setDirectory] = useState<ConversationDirectoryEntry[]>([]);
  const [directoryError, setDirectoryError] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(organizer);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const directorySequence = useRef(0);
  async function loadDirectory() {
    if (!organizer) return;
    const sequence = ++directorySequence.current;
    setDirectoryLoading(true);
    try {
      const next = await actions.gateway.conversationDirectory();
      if (sequence !== directorySequence.current) return;
      setDirectory(next);
      setDirectoryError('');
    } catch (error) {
      if (sequence === directorySequence.current) {
        setDirectory([]);
        setDirectoryError(error instanceof Error ? error.message : 'Could not load conversations.');
      }
    } finally {
      if (sequence === directorySequence.current) setDirectoryLoading(false);
    }
  }
  useEffect(() => {
    setDirectory([]);
    setDirectoryError('');
    void loadDirectory();
    const timer = organizer
      ? setInterval(() => {
          if (document.visibilityState === 'visible') void loadDirectory();
        }, 45000)
      : undefined;
    return () => {
      clearInterval(timer);
      directorySequence.current++;
    };
  }, [organizer, actions.gateway, accessContext]);
  useEffect(() => {
    if (organizer && id.startsWith('team:')) {
      setTeamFilter(id.slice(5));
      setPersonFilter('');
    }
    if (organizer && id.startsWith('person:')) {
      setPersonFilter(id.slice(7));
      setTeamFilter('');
    }
    setShowInbox(!!filterShortcut);
  }, [id, organizer]);
  function choose(next: string) {
    setShowInbox(false);
    navigate('messages', next);
  }
  const titleOf = (item: ConversationDirectoryEntry) =>
    item.teamIds
      .map(
        (teamId, index) =>
          teams(data).find((team) => team.id === teamId)?.name ||
          item.teamNames[index] ||
          'Removed team',
      )
      .join(' ↔ ');
  const selectedReview = directory.find((item) => `review:${item.id}` === selected);
  const other = teams(data).find((team) => team.id === selected && team.id !== own);
  const general = platform(data).general;
  const teamSummary = platform(data).conversations.find((item) => item.otherTeamId === selected);
  const request: MessageRequest =
    selected === 'general'
      ? { kind: 'general' }
      : selected.startsWith('review:')
        ? { kind: 'review', id: selected.slice(7) }
        : { kind: 'team', id: selected };
  const people = new Map<string, string>();
  directory.forEach((item) =>
    Object.entries(item.participantNames ?? {}).forEach(([uid, name]) => people.set(uid, name)),
  );
  data.members.forEach((person) => people.set(person.uid, person.displayName));
  const filterPerson = data.members.find((person) => person.uid === personFilter);
  const filtered = directory.filter(
    (item) =>
      (!teamFilter || item.teamIds.includes(teamFilter)) &&
      (!personFilter ||
        item.participantUids.includes(personFilter) ||
        (!!filterPerson?.teamId && item.teamIds.includes(filterPerson.teamId))) &&
      (!search.trim() ||
        `${titleOf(item)} ${item.lastMessage}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase())),
  );
  const reviewTeams = new Map<string, string>(teams(data).map((team) => [team.id, team.name]));
  directory.forEach((item) =>
    item.teamIds.forEach((teamId, index) => {
      if (!reviewTeams.has(teamId))
        reviewTeams.set(teamId, `${item.teamNames[index] || 'Team'} (removed)`);
    }),
  );
  return (
    <div className="p-messaging">
      <div className="p-page-heading">
        <h1>Messages</h1>
        <span className="muted">
          {organizer ? 'Event chat & conversation review' : 'Event chat & your team inbox'}
        </span>
      </div>
      <div className={`p-inbox ${!showInbox ? 'conversation-open' : ''}`}>
        <aside className="p-inbox-list">
          <ul className="p-general-pinned">
            <li>
              <button
                aria-current={selected === 'general' ? 'page' : undefined}
                onClick={() => choose('general')}
              >
                <strong>
                  #general <small className="p-pin-label">Pinned</small>
                  {general.unread && <span className="p-unread">Unread</span>}
                </strong>
                <span>{general.lastMessage || 'Announcements, questions, and help.'}</span>
                <small>Everyone at the event</small>
              </button>
            </li>
          </ul>
          {organizer ? (
            <>
              <div className="p-review-title">
                <h2>Team conversations</h2>
                <button
                  className="p-link"
                  disabled={directoryLoading}
                  onClick={() => void loadDirectory()}
                >
                  {directoryLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              <p className="p-chat-help">
                Read any team thread. Choose a person to see their current team’s threads and
                conversations they previously took part in.
              </p>
              <Field label="Search conversations">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Team or latest message"
                />
              </Field>
              <Field label="Team">
                <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="">All teams</option>
                  {[...reviewTeams].map(([teamId, name]) => (
                    <option key={teamId} value={teamId}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Participant">
                <select
                  value={personFilter}
                  onChange={(event) => setPersonFilter(event.target.value)}
                >
                  <option value="">All participants</option>
                  {[...people]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([uid, name]) => (
                      <option key={uid} value={uid}>
                        {name}
                      </option>
                    ))}
                </select>
              </Field>
              <ErrorMessage>{directoryError}</ErrorMessage>
              <ul>
                {filtered.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-current={selected === `review:${item.id}` ? 'page' : undefined}
                      onClick={() => choose(`review:${item.id}`)}
                    >
                      <strong>{titleOf(item)}</strong>
                      <span>{item.lastMessage || 'No messages yet'}</span>
                      <small>
                        {item.messageCount} messages · {stamp(item.updatedAt)}
                        {item.blocked ? ' · Blocked' : ''}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {!filtered.length && !directoryLoading && (
                <Blank>
                  {directory.length
                    ? 'No conversations match these filters.'
                    : 'Team conversations will appear here when someone starts one.'}
                </Blank>
              )}
            </>
          ) : own ? (
            <>
              <Field label="Message another team">
                <select
                  value={other?.id || ''}
                  onChange={(event) => {
                    if (event.target.value) choose(event.target.value);
                  }}
                >
                  <option value="">Choose a team</option>
                  {teams(data)
                    .filter((team) => team.id !== own && team.eligibility === 'active')
                    .map((team) => (
                      <option value={team.id} key={team.id}>
                        {team.name}
                      </option>
                    ))}
                </select>
              </Field>
              <ul>
                {platform(data).conversations.map((item) => (
                  <li key={item.id}>
                    <button
                      aria-current={item.otherTeamId === selected ? 'page' : undefined}
                      onClick={() => choose(item.otherTeamId)}
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
                <Blank>No team messages yet. Choose a team above to start a conversation.</Blank>
              )}
            </>
          ) : (
            <p className="p-chat-help">
              #general is open to every approved participant. Your team inbox appears after you
              choose a team.
            </p>
          )}
        </aside>
        <ConversationView
          key={`${accessContext}:${selected}`}
          {...{ data, actions, request }}
          title={
            selected === 'general'
              ? '#general'
              : selectedReview
                ? titleOf(selectedReview)
                : other?.name || 'Team conversation'
          }
          refreshToken={
            selected === 'general'
              ? `${general.latestSequence}:${general.updatedAt}:${general.moderationVersion}`
              : String(
                  request.kind === 'review'
                    ? (selectedReview?.updatedAt ?? 0)
                    : (teamSummary?.updatedAt ?? 0),
                )
          }
          unread={selected === 'general' ? general.unread : (teamSummary?.unread ?? false)}
          onInbox={() => setShowInbox(true)}
          onModerated={() => void loadDirectory()}
        />
      </div>
    </div>
  );
}

function ConversationView({
  data,
  actions,
  request,
  title,
  refreshToken,
  unread,
  onInbox,
  onModerated,
}: PageProps & {
  request: MessageRequest;
  title: string;
  refreshToken: string;
  unread: boolean;
  onInbox: () => void;
  onModerated: () => void;
}) {
  const [page, setPage] = useState<MessagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [body, setBody] = useState('');
  const [report, setReport] = useState<ChatMessage | null>(null);
  const [removal, setRemoval] = useState<ChatMessage | null>(null);
  const [reason, setReason] = useState('');
  const cmd = useCommand(actions);
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  const readThrough = useRef(0);
  const lastFetchAt = useRef(0);
  const messageList = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const olderScroll = useRef<{ height: number; top: number } | null>(null);
  const own = data.member?.teamId;
  const general = request.kind === 'general';
  const review = request.kind === 'review';
  const organizer = data.member?.role === 'organizer';
  const terminal = ['FINALIZING', 'FINALIZED', 'ARCHIVED', 'CANCELLED'].includes(
    data.event?.phase ?? '',
  );
  const blockedByUs = !!own && !!page?.blockedBy.includes(own);
  const blocked = !!page?.blockedBy.length;
  async function markRead(next: MessagePage) {
    if (review) return;
    if (general && next.latestSequence > readThrough.current) {
      readThrough.current = next.latestSequence;
      try {
        await actions.gateway.command({
          type: 'readGeneral',
          throughSequence: next.latestSequence,
          commandId: newCommandId(),
        });
      } catch {
        readThrough.current = 0; /* A failed read marker never hides the messages. */
      }
    } else if (!general && unread && request.id) {
      try {
        await actions.gateway.command({
          type: 'readConversation',
          otherTeamId: request.id,
          commandId: newCommandId(),
        });
      } catch {
        /* Retry on the next refresh. */
      }
    }
  }
  async function load(older = false) {
    if (older && (page?.nextBefore == null || olderLoading)) return;
    const sequence = ++loadSequence.current;
    if (!older) lastFetchAt.current = Date.now();
    if (older) {
      setOlderLoading(true);
      if (messageList.current)
        olderScroll.current = {
          height: messageList.current.scrollHeight,
          top: messageList.current.scrollTop,
        };
    } else setLoading(true);
    setLoadError('');
    try {
      const next = await actions.gateway.messages({
        ...request,
        ...(older ? { before: page!.nextBefore! } : {}),
      });
      if (!mounted.current || sequence !== loadSequence.current) return;
      setPage((previous) => mergeMessagePages(previous, next, older));
      if (!older) await markRead(next);
    } catch (error) {
      if (mounted.current && sequence === loadSequence.current) {
        // Keep already loaded history during a transient failure. Access changes remount this view.
        const failure = error as { code?: string };
        if (
          ![
            'RATE_LIMITED',
            'functions/resource-exhausted',
            'functions/unavailable',
            'functions/internal',
          ].includes(failure.code || '')
        )
          setPage(null);
        setLoadError(error instanceof Error ? error.message : 'Could not load messages.');
      }
    } finally {
      if (mounted.current && sequence === loadSequence.current) {
        setLoading(false);
        setOlderLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current++;
    };
  }, []);
  useEffect(() => {
    // Coalesce busy-channel updates without delaying the first load or polling when hidden.
    const delay = Math.max(0, 3000 - (Date.now() - lastFetchAt.current));
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void load();
    }, delay);
    return () => clearTimeout(timer);
  }, [refreshToken]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);
  useLayoutEffect(() => {
    const element = messageList.current;
    if (!element) return;
    if (olderScroll.current) {
      element.scrollTop =
        olderScroll.current.top + element.scrollHeight - olderScroll.current.height;
      olderScroll.current = null;
    } else if (followLatest.current) element.scrollTop = element.scrollHeight;
  }, [page]);
  const canSend = !review && !blocked && (!terminal || (general && organizer));
  return (
    <section className="p-conversation">
      <div className="p-section-heading">
        <div>
          <button className="p-link p-mobile-only" onClick={onInbox}>
            ← All conversations
          </button>
          <h2>{title}</h2>
        </div>
        <div className="p-actions">
          <button className="p-link" disabled={loading || olderLoading} onClick={() => void load()}>
            Refresh
          </button>
          {!general && !review && (
            <>
              <button className="p-link" onClick={() => navigate('projects', request.id!)}>
                Project
              </button>
              <button
                className="p-link"
                disabled={cmd.pending}
                onClick={() =>
                  void cmd.run(
                    { type: 'blockConversation', otherTeamId: request.id!, blocked: !blockedByUs },
                    () => void load(),
                  )
                }
              >
                {blockedByUs ? 'Unblock' : 'Block'}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="p-chat-disclosure">
        {general
          ? 'Everyone approved for the event can read and post here. Organizer messages are labeled.'
          : review
            ? 'Organizer review · Read-only. Participants are told organizers can read these conversations.'
            : 'Shared with both teams and visible to event organizers. Keep investment decisions independent.'}
      </p>
      {page?.nextBefore != null && (
        <button
          className="p-load-older button secondary"
          disabled={olderLoading || loading}
          onClick={() => void load(true)}
        >
          {olderLoading ? 'Loading…' : 'Load earlier messages'}
        </button>
      )}
      <div
        ref={messageList}
        className="p-message-list"
        aria-live="polite"
        aria-busy={loading}
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatest.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
      >
        {page?.messages.map((message) => (
          <article
            key={message.id}
            className={`${message.authorUid === data.member?.uid || (!general && message.fromTeamId === own) ? 'own' : ''} ${message.removedAt ? 'p-message-removed' : ''}`}
          >
            <header>
              <span>
                <strong>{message.authorName}</strong>
                {message.authorRole === 'organizer' && (
                  <small className="p-organizer-badge">Organizer</small>
                )}
                {!!message.fromTeamId && (
                  <small className="p-message-team">
                    {teamName(data, message.fromTeamId || '')}
                  </small>
                )}
              </span>
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {stamp(message.createdAt)}
              </time>
            </header>
            <p>{message.body}</p>
            {message.removedAt && <small>{message.removalReason}</small>}
            {!message.removedAt && (
              <div className="p-message-actions">
                {organizer ? (
                  <button
                    className="p-link"
                    onClick={() => {
                      setRemoval(message);
                      setReason('');
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  !general &&
                  message.fromTeamId !== own && (
                    <button
                      className="p-link"
                      onClick={() => {
                        setReport(message);
                        setReason('');
                      }}
                    >
                      Report
                    </button>
                  )
                )}
              </div>
            )}
          </article>
        ))}
        {!page?.messages.length && !loading && !loadError && (
          <Blank>
            {general
              ? 'No messages yet. Ask a question or say hello.'
              : 'No messages yet. Introduce your team or ask about the project.'}
          </Blank>
        )}
        {loading && !page && <p role="status">Loading messages…</p>}
      </div>
      <ErrorMessage>{loadError || cmd.error}</ErrorMessage>
      {canSend ? (
        <form
          className="p-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void cmd.run(
              general
                ? { type: 'sendGeneralMessage', body: body.trim() }
                : { type: 'sendMessage', toTeamId: request.id!, body: body.trim() },
              () => {
                if (mounted.current) {
                  setBody('');
                  void load();
                }
              },
            );
          }}
        >
          <Field label={general ? 'Message everyone' : 'Message from your team'}>
            <textarea
              required
              rows={3}
              maxLength={1000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                general && organizer ? 'Post an update for everyone…' : 'Write a message…'
              }
            />
          </Field>
          <div className="p-compose-footer">
            <small>{body.length}/1,000</small>
            <button className="button primary" disabled={cmd.pending || !body.trim()}>
              {cmd.pending ? 'Sending…' : general ? 'Post to #general' : 'Send message'}
            </button>
          </div>
        </form>
      ) : (
        <p className="p-chat-disclosure">
          {review
            ? 'To reach everyone, post in #general.'
            : blocked
              ? blockedByUs
                ? 'Your team has blocked this conversation.'
                : 'This conversation is blocked.'
              : 'The event has ended. Messages remain available to read.'}
        </p>
      )}
      {(report || removal) && (
        <Dialog
          title={removal ? 'Remove message' : 'Report message'}
          onClose={() => {
            setReport(null);
            setRemoval(null);
          }}
        >
          <blockquote className="p-prose">{(removal || report)!.body}</blockquote>
          <p>
            {removal
              ? 'The message will be replaced with a removal notice. Your reason is visible in the conversation, and the original is kept in the moderation record.'
              : 'Organizers can review the conversation. Include why this message needs their attention.'}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const message = (removal || report)!;
              void cmd.run(
                removal
                  ? {
                      type: 'removeChatMessage',
                      kind: general ? 'general' : 'team',
                      id: general ? 'general' : page!.id,
                      messageId: message.id,
                      ...('sequence' in message ? { sequence: message.sequence } : {}),
                      reason,
                    }
                  : {
                      type: 'reportMessage',
                      otherTeamId: request.id!,
                      messageId: message.id,
                      reason,
                    },
                () => {
                  if (removal) setPage(null);
                  setReport(null);
                  setRemoval(null);
                  void load();
                  onModerated();
                },
              );
            }}
          >
            <Field label="Reason">
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <ErrorMessage>{cmd.error}</ErrorMessage>
            <button className="button primary" disabled={cmd.pending}>
              {removal ? 'Remove message' : 'Send report'}
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
