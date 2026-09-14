import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  LogOut,
  RefreshCw,
  Shield,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import { RULES } from '@robinhacks/core';
import type { AppGateway } from './app/gateway';
import { useApp, useClock, type AppActions } from './hooks/useApp';
import { date, Dialog, Loading, Logo } from './ui/primitives';
import { Explore, ProjectDetail } from './features/Explore';
import { Portfolio } from './features/Portfolio';
import { Standings } from './features/Standings';
import { AccessScreen, Team } from './features/Team';
import { Admin, phaseNames } from './features/Admin';
import './styles.css';

import { AppNavigation, type Tab } from './ui/AppNavigation';
import { PlatformApp } from './platform/PlatformApp';

function readRoute() {
  const path = location.hash.replace(/^#\/?/, '').split('/');
  return {
    tab: (['explore', 'portfolio', 'standings', 'team', 'admin'].includes(path[0])
      ? path[0]
      : 'explore') as Tab,
    project: path[0] === 'projects' ? decodeURIComponent(path[1] || '') : '',
  };
}
export default function App({ gateway }: { gateway: AppGateway }) {
  const { data, error, busy, notice, refresh, execute, notify } = useApp(gateway);
  const now = useClock();
  const [route, setRoute] = useState(readRoute);
  const [dialog, setDialog] = useState<'rules' | 'account' | 'demo' | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [localError, setLocalError] = useState('');
  const actions: AppActions = { gateway, refresh, execute, busy, notify };
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
  function navigate(tab: Tab) {
    location.hash = `/${tab}`;
  }
  function project(id: string) {
    location.hash = `/projects/${encodeURIComponent(id)}`;
  }
  async function signOut() {
    try {
      await gateway.signOut();
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith('robinhacks:pending:')) sessionStorage.removeItem(key);
      setDialog(null);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not sign out.');
    }
  }
  async function switchRole(role: 'captain' | 'organizer' | 'member') {
    try {
      await gateway.switchDemoRole?.(role);
      navigate(role === 'organizer' ? 'admin' : 'explore');
      setDialog(null);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not change demo role.');
    }
  }
  async function resetDemo(phase: 'seed' | 'trading') {
    try {
      await gateway.resetDemo?.(phase);
      setDialog(null);
      navigate('explore');
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Could not reset the demo.');
    }
  }
  const signedIn = !!gateway.user;
  const approved = data?.member?.status === 'approved';
  const organizer = data?.member?.role === 'organizer';
  const own = data?.market.entries.find((entry) => entry.team.id === data.member?.teamId)?.team;
  const entry = data?.market.entries.find((item) => item.team.id === route.project);
  const event = data?.event;
  const expired = !!event?.closesAt && now >= event.closesAt;
  const phaseOpen =
    event && ['TRADING_OPEN', 'SEED_OPEN'].includes(event.phase) && !event.paused && !expired;
  const deadline = event?.closesAt ? Math.max(0, Math.ceil((event.closesAt - now) / 1000)) : 0;
  const deadlineText =
    deadline >= 3600
      ? `${Math.floor(deadline / 3600)}h ${Math.floor((deadline % 3600) / 60)}m left`
      : `${Math.floor(deadline / 60)}:${String(deadline % 60).padStart(2, '0')} left`;
  const phaseText = event
    ? event.paused
      ? 'Trading paused'
      : expired && ['TRADING_OPEN', 'SEED_OPEN'].includes(event.phase)
        ? 'Window closed'
        : phaseNames[event.phase]
    : 'Event';
  if (!data)
    return (
      <div className="platform-app">
        <header className="p-header">
          <div className="p-header-inner">
            <span className="p-wordmark">
              emergent<span>hacks</span>
            </span>
          </div>
        </header>
        <main className="p-main" aria-busy={!error}>
          <p role={error ? 'alert' : 'status'}>{error || 'Loading event…'}</p>
          {error && (
            <button className="button secondary" onClick={() => void refresh()}>
              Try again
            </button>
          )}
        </main>
      </div>
    );
  if (data.event?.platform)
    return <PlatformApp data={data} actions={actions} error={error} notice={notice} />;
  return (
    <div className={`app ${approved ? 'authenticated' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-inner">
            <button
              className="brand"
              onClick={() => navigate('explore')}
              aria-label="RobinHacks home"
            >
              <Logo />
              <span>robinhacks</span>
            </button>
            {approved && (
              <AppNavigation
                active={route.project ? 'explore' : route.tab}
                organizer={organizer}
                navigate={navigate}
              />
            )}
            <div className="header-actions">
              {gateway.mode === 'demo' && (
                <button className="demo-badge" onClick={() => setDialog('demo')}>
                  Demo <ChevronDown size={12} />
                </button>
              )}
              {gateway.mode === 'emulator' && <span className="demo-badge">Emulator</span>}
              {approved && (
                <>
                  <button
                    className="icon-button refresh-button"
                    onClick={() => void refresh()}
                    title="Refresh event"
                    aria-label="Refresh event"
                  >
                    <RefreshCw size={15} className={busy ? 'spin' : ''} />
                  </button>
                  <button
                    className="account-button"
                    onClick={() => setDialog('account')}
                    aria-label="Your account"
                  >
                    <span>{gateway.user?.displayName?.split(' ')[0] || 'Account'}</span>
                    <ChevronDown size={12} />
                  </button>
                  {organizer && (
                    <button
                      className="icon-button mobile-admin"
                      onClick={() => navigate('admin')}
                      aria-label="Admin console"
                    >
                      <Shield size={19} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </header>
        {approved && event && (
          <div className="event-context">
            <div className="event-identification">
              <strong>{event.name}</strong>
              {event.venue && <span>{event.venue}</span>}
            </div>
            <button className="phase-context-button" onClick={() => setDialog('rules')}>
              <span
                className={`phase-pill ${event.paused || expired ? 'paused' : !phaseOpen ? 'neutral' : ''}`}
              >
                <span />
                {phaseText}
                {event.phase === 'TRADING_OPEN' && !expired && !event.paused
                  ? ` · ${event.windowId} of 3`
                  : ''}
              </span>
              <span className="phase-context-copy">
                {phaseOpen
                  ? deadlineText
                  : event.paused
                    ? event.pauseReason || 'Updates from the organizer'
                    : event.phase === 'FINALIZED'
                      ? 'Results published'
                      : ['FROZEN', 'FINALIZING'].includes(event.phase)
                        ? 'Trading has ended. Results are being prepared.'
                        : event.phase === 'SEED_SETTLING'
                          ? 'Allocations are being prepared.'
                          : ['CANCELLED', 'ARCHIVED'].includes(event.phase)
                            ? 'This event has ended.'
                            : 'The organizer will open the next round.'}
              </span>
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {(offline || error || localError) && (
          <div className="global-alert" role="alert">
            {offline ? (
              <>
                <WifiOff size={17} />
                You’re offline. Displayed data may be outdated. Trades require a connection.
              </>
            ) : (
              <>
                {localError || error}
                <button
                  onClick={() => {
                    setLocalError('');
                    void refresh();
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        )}
        {event?.announcement && approved && (
          <div className="announcement">
            <strong>Announcement</strong>
            <p>{event.announcement}</p>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={approved ? 'main-content' : 'main-content guest'}
        >
          {!signedIn || (data && !approved) ? (
            <AccessScreen actions={actions} data={data} />
          ) : !data ? (
            <Loading label="Loading your event…" />
          ) : !event ? (
            <div className="empty-state">
              <h1>Event not ready</h1>
              <p>The organizer is setting up this event. Check again in a few minutes.</p>
              <button className="button secondary" onClick={() => void refresh()}>
                Check again
              </button>
            </div>
          ) : route.project ? (
            entry ? (
              <ProjectDetail
                entry={entry}
                data={data}
                actions={actions}
                onBack={() => navigate('explore')}
                onEdit={() => navigate('team')}
              />
            ) : (
              <div className="empty-state">
                <h2>Project not found</h2>
                <button className="button primary" onClick={() => navigate('explore')}>
                  Projects
                </button>
              </div>
            )
          ) : route.tab === 'portfolio' ? (
            <Portfolio data={data} actions={actions} onProject={project} />
          ) : route.tab === 'standings' ? (
            <Standings data={data} onProject={project} />
          ) : route.tab === 'team' ? (
            <Team data={data} actions={actions} />
          ) : route.tab === 'admin' && organizer ? (
            <Admin data={data} actions={actions} />
          ) : (
            <Explore data={data} actions={actions} onProject={project} />
          )}
        </main>
        {approved && (
          <footer className="app-footer">
            <span>RobinHacks · Event credits have no cash value.</span>
            <button onClick={() => setDialog('rules')}>
              Game rules
              <ArrowRight size={14} />
            </button>
          </footer>
        )}
      </div>
      {approved && (
        <AppNavigation
          active={route.project ? 'explore' : route.tab}
          organizer={organizer}
          navigate={navigate}
          mobile
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span className="toast-dot" />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => notify('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog === 'account' && (
        <Dialog title="Your account" onClose={() => setDialog(null)}>
          <div className="account-summary">
            <span className="avatar large">
              {(gateway.user?.displayName || 'You').slice(0, 2).toUpperCase()}
            </span>
            <h3>{gateway.user?.displayName}</h3>
            <p>{gateway.user?.email}</p>
            <span className="role-tag">{data?.member?.role}</span>
          </div>
          <button className="button secondary full" onClick={() => void signOut()}>
            <LogOut size={16} />
            Sign out
          </button>
        </Dialog>
      )}
      {dialog === 'demo' && (
        <Dialog title="Demo accounts" onClose={() => setDialog(null)}>
          <p className="muted">Sample event. Changes are saved in this browser only.</p>
          <div className="demo-roles">
            <button className="button secondary" onClick={() => void switchRole('captain')}>
              <Wallet size={19} />
              <span>
                Team captain<small>Trade and manage a project</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button className="button secondary" onClick={() => void switchRole('member')}>
              <Users size={19} />
              <span>
                Team member<small>View the shared portfolio</small>
              </span>
              <ArrowRight size={17} />
            </button>
            <button className="button secondary" onClick={() => void switchRole('organizer')}>
              <Shield size={19} />
              <span>
                Organizer<small>Run phases and publish results</small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="demo-reset">
            <p className="fine-print">Resetting replaces your local demo activity.</p>
            <button className="text-link" onClick={() => void resetDemo('trading')}>
              Reset trading demo
            </button>
            <button className="text-link" onClick={() => void resetDemo('seed')}>
              Start seed demo
            </button>
          </div>
        </Dialog>
      )}
      {dialog === 'rules' && (
        <Dialog title="Game rules" onClose={() => setDialog(null)} wide>
          <div className="rules-current">
            <span className="eyebrow">{event?.name || 'ROBINHACKS'}</span>
            <h3>{phaseText}</h3>
            {event?.closesAt && (
              <p>
                {expired ? 'Window ended' : 'Closes'} {date(event.closesAt)} (
                {Intl.DateTimeFormat().resolvedOptions().timeZone})
              </p>
            )}
          </div>
          <ol className="rules-list">
            <li>
              <span>01</span>
              <div>
                <h3>Starting balance</h3>
                <p>
                  Each team gets 10,000 fictional credits and one shared portfolio. Captains and
                  designated traders can place orders.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Seed funding</h3>
                <p>
                  Reserve up to 5,000 credits at 100 credits per share. Request up to 25 shares in
                  another project, and 50 shares total. Commitments are private and editable until
                  close. Oversubscribed projects allocate shares fairly.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Trading windows</h3>
                <p>
                  There are up to three trading windows. Buy or sell whole shares at the quoted
                  price. Hold up to 25 shares per project, with 15 successful trades per window and
                  10 seconds between trades. Teams cannot buy their own shares.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h3>Final results</h3>
                <p>
                  Judges set the final project rankings. Final share values range from{' '}
                  {RULES.firstPlaceMinor / 100} credits for first place to{' '}
                  {RULES.lastPlaceMinor / 100} for last place, with tied ranks sharing the average.
                  Your final result is frozen cash plus the judged value of your holdings.
                </p>
              </div>
            </li>
          </ol>
          <p className="notice-inline">
            Organizers open each phase manually. Seed funding raised, portfolio results, and judged
            project rankings are separate standings.
          </p>
          <button className="button primary full" onClick={() => setDialog(null)}>
            Got it
          </button>
        </Dialog>
      )}
    </div>
  );
}
