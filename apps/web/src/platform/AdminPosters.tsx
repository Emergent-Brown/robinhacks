import { useEffect, useState } from 'react';
import type { PosterStatsPage } from '@robinhacks/core';
import { Blank, ErrorMessage, Panel, stamp, type PageProps } from './shared';

export function AdminPosters({ actions }: PageProps) {
  const gateway = actions.gateway;
  const [page, setPage] = useState<PosterStatsPage>({ items: [], nextCursor: null });
  const [after, setAfter] = useState(0);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPending(true);
    setError('');
    if (!gateway.posterStats) {
      setPending(false);
      return;
    }
    gateway
      .posterStats(after)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load poster counts.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [gateway, after, revision]);
  return (
    <Panel title="Poster visits">
      <p>
        Give each NFC tag a different link: <strong>https://emergenthacks.com/1</strong>, /2, /3,
        and so on. Links work immediately. A poster appears here after its first visit.
      </p>
      <p>
        Each visit adds one to the count, then opens the homepage. Repeat visits count again. These
        are visits, not unique people. Keep a list of where you put each numbered poster.
      </p>
      {gateway.mode === 'demo' ? (
        <Blank>Live poster counts are available on the production site.</Blank>
      ) : (
        <>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh counts
          </button>
          <ErrorMessage>{error}</ErrorMessage>
          {pending ? (
            <p role="status">Loading counts…</p>
          ) : (
            !error &&
            (page.items.length ? (
              <>
                <div className="p-table-wrap">
                  <table className="p-table">
                    <thead>
                      <tr>
                        <th>Poster</th>
                        <th>NFC link</th>
                        <th>Visits</th>
                        <th>Last visit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((poster) => (
                        <tr key={poster.number}>
                          <td>{poster.number}</td>
                          <td>
                            <code>https://emergenthacks.com/{poster.number}</code>
                          </td>
                          <td>{poster.visits.toLocaleString()}</td>
                          <td>{stamp(poster.lastVisitedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Blank>No poster visits on this page yet.</Blank>
            ))
          )}
          <div className="p-inline-form">
            {after > 0 && (
              <button className="p-link" disabled={pending} onClick={() => setAfter(0)}>
                Back to first page
              </button>
            )}
            {!error && page.nextCursor !== null && (
              <button
                className="p-link"
                disabled={pending}
                onClick={() => setAfter(page.nextCursor!)}
              >
                Next 100 posters
              </button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
