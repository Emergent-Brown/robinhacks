import type { AppGateway } from './app/gateway';
import { useApp, type AppActions } from './hooks/useApp';
import { PlatformApp } from './platform/PlatformApp';
import './styles.css';

/** Loads one sealed-funding event and hands all routing to the current platform. */
export default function App({ gateway }: { gateway: AppGateway }) {
  const { data, error, busy, notice, refresh, execute, notify } = useApp(gateway);
  const actions: AppActions = { gateway, refresh, execute, busy, notify };
  if (data?.event?.platform?.version === 2)
    return <PlatformApp data={data} actions={actions} error={error} notice={notice} />;

  const message = error || (data ? 'The organizer is setting up this event.' : 'Loading event…');
  return (
    <div className="platform-app">
      <header className="p-header">
        <div className="p-header-inner">
          <span className="p-wordmark">
            emergent<span>hacks</span>
          </span>
        </div>
      </header>
      <main className="p-main" aria-busy={!data && !error}>
        <p role={error ? 'alert' : 'status'}>{message}</p>
        {(error || data) && (
          <button className="button secondary" onClick={() => void refresh()}>
            Try again
          </button>
        )}
      </main>
    </div>
  );
}
