import { useEffect, useState } from 'react';
import type { AppSnapshot } from '@robinhacks/core';
import { Dialog } from '../ui/primitives';
import type { AppActions } from '../hooks/useApp';
import { useClock } from '../hooks/useApp';
import { Access, Homepage } from './Access';
import { Admin } from './Admin';
import { Investments } from './Investments';
import { Judging } from './Judging';
import { Messages } from './Messages';
import { MyTeam } from './MyTeam';
import { ProjectDetail, Projects } from './Projects';
import { Results } from './Results';
import { QuickStart, Rules } from './Rules';
import { config, navigate, platform, stamp } from './shared';
import './platform.css';

function readRoute() {
  const [page = '', id = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return {
    page: page.startsWith('platform') ? page.slice(8) : 'projects',
    id: decodeURIComponent(id),
  };
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
  const [modal, setModal] = useState<'account' | 'demo' | 'onboarding' | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [localError, setLocalError] = useState('');
  const now = useClock();
  const user = actions.gateway.user;
  const approved = !!user && data.member?.uid === user.uid && data.member.status === 'approved';
  const organizer = approved && data.member?.role === 'organizer';
  const judge = approved && data.member?.role === 'judge';
  const state = platform(data);
  const event = data.event!;
  const showResults = !judge || event.phase === 'FINALIZED';
  const settings = config(data);
  const active = state.rounds.find((round) => round.state === 'open');
  const unread = state.conversations.filter((item) => item.unread).length;
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
    if (approved && data.member?.teamId && !localStorage.getItem(onboardingKey))
      setModal('onboarding');
  }, [approved, onboardingKey]);
  function finishOnboarding() {
    localStorage.setItem(onboardingKey, 'seen');
    setModal(null);
  }
  async function switchRole(role: 'captain' | 'member' | 'judge' | 'organizer') {
    try {
      await actions.gateway.switchDemoRole?.(role);
      setModal(null);
      navigate(role === 'organizer' ? 'admin' : role === 'judge' ? 'judging' : 'projects');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not switch demo account.');
    }
  }
  async function reset(phase: 'seed' | 'trading' | 'judging') {
    try {
      await actions.gateway.resetDemo?.(phase);
      setModal(null);
      navigate('projects');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not reset demo.');
    }
  }
  const pages = judge
    ? [
        ['projects', 'Projects'],
        ['judging', 'Judging'],
        ['more', 'More'],
      ]
    : [
        ['projects', 'Projects'],
        ['investments', 'Investments'],
        ['messages', `Messages${unread ? ` (${unread})` : ''}`],
        ['team', 'My team'],
        ['more', 'More'],
      ];
  const deadline = [
    ...(active ? [{ label: active.name, time: active.closesAt }] : []),
    ...(settings.submissionsOpen && settings.submissionClosesAt
      ? [{ label: 'Final submissions', time: settings.submissionClosesAt }]
      : []),
    ...(settings.ballotOpen && settings.ballotClosesAt
      ? [{ label: 'Community ballots', time: settings.ballotClosesAt }]
      : []),
  ]
    .filter((item) => item.time > now)
    .sort((a, b) => a.time - b.time)[0];
  const reminder = approved && !event.paused && deadline && deadline.time - now <= 5 * 60000;
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
          {approved && (
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
              {organizer && (
                <button
                  aria-current={route.page === 'admin' ? 'page' : undefined}
                  onClick={() => navigate('admin')}
                >
                  Admin
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
            {actions.gateway.mode === 'demo' && (
              <button onClick={() => setModal('demo')}>Demo ▾</button>
            )}
            {user ? (
              <button onClick={() => setModal('account')}>
                {user.displayName?.split(' ')[0] || 'Account'} ▾
              </button>
            ) : (
              <button onClick={() => navigate('access')}>Sign in</button>
            )}
          </div>
        </div>
      </header>
      {approved && (
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
          <button className="p-link" disabled={actions.busy} onClick={() => void actions.refresh()}>
            Refresh
          </button>
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
        <div className="p-banner">
          <strong>Organizer note:</strong> {event.announcement}
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
          ) : route.page === 'access' || !!user ? (
            <Access data={data} actions={actions} />
          ) : (
            <Homepage data={data} actions={actions} onJoin={() => navigate('access')} />
          )
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
        ) : route.page === 'messages' && !judge ? (
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
        {approved && (
          <button className="p-link" onClick={() => setModal('onboarding')}>
            How it works
          </button>
        )}
      </footer>
      {approved && (
        <nav className="p-mobile-nav" aria-label="Mobile navigation">
          {pages.map(([page, label]) => (
            <button
              key={page}
              aria-current={
                route.page === page ||
                (page === 'more' && ['admin', 'results', 'rules', 'home'].includes(route.page))
                  ? 'page'
                  : undefined
              }
              onClick={() => navigate(page!)}
            >
              {label}
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
      {modal === 'account' && (
        <Dialog title="Your account" onClose={() => setModal(null)}>
          <h2>{user?.displayName || 'Participant'}</h2>
          <p className="p-break">{user?.email}</p>
          <p>
            {data.member?.role === 'trader'
              ? 'Designated investor'
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
            {(['captain', 'member', 'judge', 'organizer'] as const).map((role) => (
              <button className="button secondary" key={role} onClick={() => void switchRole(role)}>
                {role === 'captain'
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
            <button className="button secondary" onClick={() => void reset('seed')}>
              Before the first round
            </button>
            <button className="button secondary" onClick={() => void reset('trading')}>
              Prototype round
            </button>
            <button className="button secondary" onClick={() => void reset('judging')}>
              Final judging
            </button>
          </div>
        </Dialog>
      )}
      {modal === 'onboarding' && <QuickStart data={data} onClose={finishOnboarding} />}
    </div>
  );
}
