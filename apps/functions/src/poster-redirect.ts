import type { Request, Response } from 'express';
import { posterNumber } from '@robinhacks/core';
import type { PosterStore } from '@robinhacks/application';

type BurstLimiter = { check(key: string, action: string, limit: number): void };

export class PosterRedirect {
  constructor(
    private readonly store: PosterStore,
    private readonly limiter: BurstLimiter,
    private readonly onFailure: () => void,
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    // Never cache a counting redirect: every new navigation must reach the server.
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.set('Allow', 'GET, HEAD');
      res.status(405).end();
      return;
    }
    const number = posterNumber(req.path);
    const preview =
      /bot|crawler|spider|slurp|facebookexternalhit|WhatsApp|Slack|Discord|Telegram/i.test(
        req.get('user-agent') || '',
      ) ||
      /prefetch|prerender/i.test(`${req.get('purpose') || ''} ${req.get('sec-purpose') || ''}`);
    if (number !== null && req.method === 'GET' && !preview) {
      try {
        this.limiter.check(req.ip || 'unknown', 'poster', 120);
        this.limiter.check('all', 'poster-total', 600);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Let the visitor through if Firestore is unavailable or slow. A pending
          // atomic write may still finish; do not retry it and risk double-counting.
          await Promise.race([
            this.store.recordVisit(number),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Counter timeout')), 4000);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'resource-exhausted'
        ))
          this.onFailure();
      }
    }
    // Fixed destination prevents open redirects and drops the poster path and query.
    res.redirect(302, 'https://emergenthacks.com/');
  }
}
