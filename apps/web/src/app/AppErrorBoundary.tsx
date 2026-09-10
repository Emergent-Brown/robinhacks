import { Component, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="empty-state" style={{ maxWidth: 600, margin: '12vh auto', padding: 24 }}>
        <h1>Something went wrong.</h1>
        <p>
          Reload the page to try again. If a trade was in progress, check its receipt after
          reloading.
        </p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
