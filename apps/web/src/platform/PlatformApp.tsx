import { useEffect, useState } from 'react';
import type { AppSnapshot } from '@robinhacks/core';
import { Dialog } from '../ui/primitives';
import type { AppActions } from '../hooks/useApp';
import { useClock } from '../hooks/useApp';
import { Access } from './Access';
import { Homepage } from './Homepage';
import { Admin } from './Admin';
import { Investments } from './Investments';
import { Judging } from './Judging';
import { Messages } from './Messages';
import { OrganizerNoteDialog } from './OrganizerNote';
import { MyTeam } from './MyTeam';
import { TeamFormation } from './TeamFormation';
import { ProjectDetail, Projects } from './Projects';
import { Results } from './Results';
import { QuickStart, Rules } from './Rules';
import { config, navigate, platform, stamp } from './shared';
import './platform.css';

function readRoute() {
  const [page = '', id = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return {
    page: page === '' ? 'home' : page.startsWith('platform') ? page.slice(8) : 'projects',
    id: safeRouteId(id),
  };
}
function safeRouteId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return '';
  }
}
export function PlatformApp({
  data,
  actions,
  error = '',
  notice = '',
}: {
  data: AppSnapshot;
  actions: AppActions;
  error?: string;
  notice?: string;
}) {
  const [route, setRoute] = useState(readRoute);
  const [modal, setModal] = useState<'account' | 'demo' | 'onboarding' | 'note' | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [localError, setLocalError] = useState('');
  const now = useClock();
  const user = actions.gateway.user;
  const approved = !!user && data.member?.uid === user.uid && data.member.status === 'approved';
  const organizer = approved && data.member?.role === 'organizer';
  const judge = approved && data.member?.role === 'judge';
  const needsTeam = approved && !organizer && !judge && !data.member?.teamId;
  const workspaceReady = approved && !needsTeam;
  const state = platform(data);
  const event = data.event!;
  const showResults = !judge || event.phase === 'FINALIZED';
  const settings = config(data);
  const active = state.rounds.find((round) => round.state === 'open');
  const unread =
    state.conversations.filter((item) => item.unread).length + (state.general.unread ? 1 : 0);
  const messagesLabel = `Messages${unread ? ` (${unread})` : ''}`;
  const onboardingKey = `emergenthacks:onboarding:${event.id}:${user?.uid}`;
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    const connection = () => setOffline(!navigator.onLine);
    window.addEventListener('hashchange', update);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  useEffect(() => {
    if (!approved || !data.member?.teamId) return;
    try {
      if (!localStorage.getItem(onboardingKey)) setModal('onboarding');
    } catch {
      // Team access still works when browser storage is unavailable.
    }
  }, [approved, onboardingKey, data.member?.teamId]);
  function finishOnboarding() {
    try {
      localStorage.setItem(onboardingKey, 'seen');
    } catch {
      /* Optional browser preference. */
    }
    setModal(null);
  }
  async function switchRole(role: 'captain' | 'member' | 'judge' | 'organizer' | 'attendee') {
    try {
      await actions.gateway.switchDemoRole?.(role);
      setModal(null);
      navigate(role === 'organizer' ? 'admin' : role === 'judge' ? 'judging' : 'projects');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not switch demo account.');
    }
  }
  async function reset(phase: 'registration' | 'funding' | 'judging') {
    try {
      await actions.gateway.resetDemo?.(phase);
      setModal(null);
      navigate('projects');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not reset demo.');
    }
  }
  const pages = organizer
    ? [
        ['projects', 'Projects'],
        ['messages', messagesLabel],
        ['admin', 'Admin'],
        ['more', 'More'],
      ]
    : judge
      ? [
          ['projects', 'Projects'],
          ['judging', 'Judging'],
          ['messages', messagesLabel],
          ['more', 'More'],
        ]
      : [
          ['projects', 'Projects'],
          ['investments', 'Investments'],
          ['messages', messagesLabel],
          ['team', 'My team'],
          ['more', 'More'],
        ];
  const deadline = [
    ...(active ? [{ label: active.name, time: active.closesAt }] : []),
    ...(settings.submissionsOpen && settings.submissionClosesAt
      ? [{ label: 'Final submissions', time: settings.submissionClosesAt }]
      : []),
  ]
    .filter((item) => item.time > now)
    .sort((a, b) => a.time - b.time)[0];
  const reminder = workspaceReady && !event.paused && deadline && deadline.time - now <= 5 * 60000;
  return (
    <div className="platform-app">
      <a
        className="skip-link"
        href="#platform-main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('platform-main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="p-header">
        <div className="p-header-inner">
          <button className="p-wordmark" onClick={() => navigate('home')}>
            emergent<span>hacks</span>
          </button>
          {workspaceReady && (
            <nav className="p-desktop-nav" aria-label="Main navigation">
              {pages
                .filter(([page]) => page !== 'more')
                .map(([page, label]) => (
                  <button
                    key={page}
                    aria-current={route.page === page ? 'page' : undefined}
                    onClick={() => navigate(page!)}
                  >
                    {label}
                  </button>
                ))}
              {showResults && (
                <button
                  aria-current={route.page === 'results' ? 'page' : undefined}
                  onClick={() => navigate('results')}
                >
                  Results
                </button>
              )}
              <button
                aria-current={route.page === 'rules' ? 'page' : undefined}
                onClick={() => navigate('rules')}
              >
                Rules
              </button>
            </nav>
          )}
          <div className="p-header-actions">
            {approved && (
              <button
                className="p-notification-button"
                aria-label={
                  unread
                    ? `${unread} unread conversations. Open messages`
                    : 'Open messages: no unread conversations'
                }
                onClick={() => navigate('messages', 'general')}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                </svg>
                {unread > 0 && <span className="p-notification-dot" />}
              </button>
            )}
            {actions.gateway.mode === 'demo' && (
              <button onClick={() => setModal('demo')}>Demo ▾</button>
            )}
            {user ? (
              <button onClick={() => setModal('account')}>
                {user.photoURL && (
                  <img
                    className="p-avatar"
                    src={user.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}{' '}
                {user.displayName?.split(' ')[0] || 'Account'} ▾
              </button>
            ) : (
              <button onClick={() => navigate('access')}>Sign in</button>
            )}
          </div>
        </div>
      </header>
      {workspaceReady && (
        <div className="p-context">
          <strong>{event.name}</strong>
          <span>
            {event.paused
              ? `Paused · ${event.pauseReason}`
              : event.phase === 'FINALIZED'
                ? 'Results published'
                : event.phase === 'CANCELLED'
                  ? 'Event cancelled'
                  : active
                    ? now >= active.closesAt
                      ? `${active.name} · allocations locked`
                      : `${active.name} · closes ${stamp(active.closesAt, settings.details.timeZone)}`
                    : event.phase === 'FROZEN'
                      ? 'Judging in progress'
                      : event.phase === 'FINALIZING'
                        ? 'Results under review'
                        : ['DRAFT', 'REGISTRATION'].includes(event.phase)
                          ? 'Registration'
                          : 'Between funding rounds'}
          </span>
          <div className="p-context-actions">
            {organizer && (
              <button className="p-link" onClick={() => setModal('note')}>
                {event.announcement ? 'Edit note' : 'Post note'}
              </button>
            )}
            <button
              className="p-link"
              disabled={actions.busy}
              onClick={() => void actions.refresh()}
            >
              Refresh
            </button>
          </div>
        </div>
      )}
      {(offline || error || localError) && (
        <div className="p-banner" role="alert">
          {offline ? 'You are offline. Changes require a connection.' : localError || error}
          {!offline && (
            <button
              className="p-link"
              onClick={() => {
                setLocalError('');
                void actions.refresh();
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {event.announcement && approved && (
        <div className="p-banner p-organizer-banner">
          <p>
            <strong>Organizer note:</strong> {event.announcement}
          </p>
          {organizer && (
            <button className="p-link" onClick={() => setModal('note')}>
              Edit note
            </button>
          )}
        </div>
      )}
      {reminder && (
        <div className="p-banner" role="status">
          {deadline.label} closes in {Math.max(1, Math.ceil((deadline.time - now) / 60000))}{' '}
          minutes. Check your saved work.
        </div>
      )}
      <main id="platform-main" tabIndex={-1} className="p-main">
        {!approved ? (
          route.page === 'rules' ? (
            <>
              <h1>Event rules</h1>
              <Rules data={data} />
            </>
          ) : route.page === 'access' || (!!user && route.page !== 'home') ? (
            <Access data={data} actions={actions} />
          ) : (
            <Homepage data={data} actions={actions} onJoin={() => navigate('access')} />
          )
        ) : needsTeam ? (
          <>
            <nav className="p-formation-nav" aria-label="Event access">
              <button
                className="button secondary"
                aria-current={route.page !== 'messages' ? 'page' : undefined}
                onClick={() => navigate('team')}
              >
                Choose your team
              </button>
              <button
                className="button secondary"
                aria-current={route.page === 'messages' ? 'page' : undefined}
                onClick={() => navigate('messages', 'general')}
              >
                #general{state.general.unread ? ' · New messages' : ''}
              </button>
            </nav>
            {route.page === 'messages' ? (
              <Messages data={data} actions={actions} id="general" />
            ) : (
              <TeamFormation data={data} actions={actions} />
            )}
          </>
        ) : route.page === 'home' ? (
          <Homepage data={data} actions={actions} onJoin={() => navigate('team')} />
        ) : route.page === 'projects' ? (
          route.id ? (
            <ProjectDetail data={data} actions={actions} id={route.id} />
          ) : (
            <Projects data={data} actions={actions} />
          )
        ) : route.page === 'investments' && !judge ? (
          <Investments data={data} actions={actions} />
        ) : route.page === 'messages' ? (
          <Messages data={data} actions={actions} id={route.id} />
        ) : route.page === 'team' ? (
          <MyTeam data={data} actions={actions} />
        ) : route.page === 'results' && showResults ? (
          <Results data={data} actions={actions} />
        ) : route.page === 'judging' && judge ? (
          <Judging data={data} actions={actions} />
        ) : route.page === 'admin' && organizer ? (
          <Admin data={data} actions={actions} />
        ) : route.page === 'rules' ? (
          <>
            <h1>Event rules</h1>
            <Rules data={data} />
          </>
        ) : route.page === 'more' ? (
          <>
            <h1>More</h1>
            <div className="p-more-links">
              {showResults && <button onClick={() => navigate('results')}>Results</button>}
              {judge && <button onClick={() => navigate('judging')}>Judging</button>}
              {organizer && <button onClick={() => navigate('admin')}>Admin</button>}
              <button onClick={() => navigate('rules')}>Event rules</button>
              <button onClick={() => navigate('home')}>Event information</button>
              <button onClick={() => setModal('onboarding')}>Replay introduction</button>
              <button onClick={() => setModal('account')}>Your account</button>
            </div>
          </>
        ) : (
          <Projects data={data} actions={actions} />
        )}
      </main>
      <footer className="p-footer">
        <span>{event.name} · Event credits have no cash value.</span>
        {workspaceReady && (
          <button className="p-link" onClick={() => setModal('onboarding')}>
            How it works
          </button>
        )}
      </footer>
      {workspaceReady && (
        <nav className="p-mobile-nav" aria-label="Mobile navigation">
          {pages.map(([page, label]) => (
            <button
              key={page}
              aria-current={
                route.page === page ||
                (page === 'more' && ['results', 'rules', 'home'].includes(route.page))
                  ? 'page'
                  : undefined
              }
              onClick={() => navigate(page!)}
            >
              {page === 'investments' ? 'Invest' : label}
            </button>
          ))}
        </nav>
      )}
      {notice && (
        <div className="p-toast" role="status">
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => actions.notify('')}>
            ×
          </button>
        </div>
      )}
      {modal === 'note' && organizer && (
        <OrganizerNoteDialog data={data} actions={actions} onClose={() => setModal(null)} />
      )}
      {modal === 'account' && (
        <Dialog title="Your account" onClose={() => setModal(null)}>
          {user?.photoURL && (
            <img
              className="p-avatar p-avatar-large"
              src={user.photoURL}
              alt="Your Google profile"
              referrerPolicy="no-referrer"
            />
          )}
          <h2>{user?.displayName || 'Participant'}</h2>
          <p className="p-break">{user?.email}</p>
          <p>
            {data.member?.role === 'trader'
              ? 'Member'
              : data.member?.role || 'Awaiting event access'}
          </p>
          <button
            className="button secondary"
            onClick={() =>
              void actions.gateway
                .signOut()
                .then(() => {
                  setModal(null);
                  navigate('home');
                })
                .catch((e) => setLocalError(e instanceof Error ? e.message : 'Could not sign out.'))
            }
          >
            Sign out
          </button>
        </Dialog>
      )}
      {modal === 'demo' && (
        <Dialog title="Demo event" onClose={() => setModal(null)}>
          <p>Fictional teams and credits. Changes stay in this browser.</p>
          <h3>View as</h3>
          <div className="p-demo-options">
            {(['attendee', 'captain', 'member', 'judge', 'organizer'] as const).map((role) => (
              <button className="button secondary" key={role} onClick={() => void switchRole(role)}>
                {role === 'attendee'
                  ? 'Attendee choosing a team'
                  : role === 'captain'
                    ? 'Team captain'
                    : role === 'member'
                      ? 'Team member'
                      : role === 'judge'
                        ? 'Judge'
                        : 'Organizer'}
              </button>
            ))}
          </div>
          <h3>Reset sample event</h3>
          <p>Replaces local demo activity with the selected checkpoint.</p>
          <div className="p-demo-options">
            <button className="button secondary" onClick={() => void reset('registration')}>
              Before the first round
            </button>
            <button className="button secondary" onClick={() => void reset('funding')}>
              Prototype round
            </button>
            <button className="button secondary" onClick={() => void reset('judging')}>
              Final judging
            </button>
          </div>
        </Dialog>
      )}
      {workspaceReady && modal === 'onboarding' && (
        <QuickStart data={data} onClose={finishOnboarding} />
      )}
    </div>
  );
}
