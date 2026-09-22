import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { posterNumber } from '@robinhacks/core';
import { PosterService, type PosterStore } from '@robinhacks/application';
import { MemoryRepository } from '../packages/application/src/memory-repository';
import { PosterRedirect } from '../apps/functions/src/poster-redirect';

function fixture(path = '/12', method = 'GET', headers: Record<string, string> = {}) {
  const store: PosterStore = {
    recordVisit: vi.fn(async () => {}),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const limiter = { check: vi.fn() };
  const failed = vi.fn();
  const response = { set: vi.fn(), redirect: vi.fn(), status: vi.fn(), end: vi.fn() };
  response.status.mockReturnValue(response);
  const request = { path, method, ip: 'test', get: (key: string) => headers[key] } as Request;
  const handler = new PosterRedirect(store, limiter, failed);
  return {
    store,
    limiter,
    failed,
    response,
    run: () => handler.handle(request, response as unknown as Response),
  };
}

describe('Poster links', () => {
  it.each(['/1', '/2', '/99999', '/27/'])('recognizes canonical numbered path %s', (path) => {
    expect(posterNumber(path)).toBe(Number(path.split('/')[1]));
  });
  it.each(['/', '/0', '/01', '/100000', '/-1', '/1/2', '/1.json', '/1?poster=2', '/%31'])(
    'rejects malformed path %s',
    (path) => {
      expect(posterNumber(path)).toBeNull();
    },
  );
  it('waits for the atomic write before sending a non-cacheable redirect', async () => {
    const f = fixture();
    let finish!: () => void;
    vi.mocked(f.store.recordVisit).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const task = f.run();
    expect(f.response.redirect).not.toHaveBeenCalled();
    expect(f.store.recordVisit).toHaveBeenCalledWith(12);
    finish();
    await task;
    expect(f.response.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(f.response.redirect).toHaveBeenCalledWith(302, 'https://emergenthacks.com/');
  });
  it('counts repeat navigations separately', async () => {
    const f = fixture();
    await f.run();
    await f.run();
    expect(f.store.recordVisit).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['HEAD', {}],
    ['GET', { 'user-agent': 'Googlebot' }],
    ['GET', { purpose: 'prefetch' }],
    ['GET', { 'sec-purpose': 'prefetch;prerender' }],
    ['GET', { 'user-agent': 'facebookexternalhit/1.1' }],
  ])('redirects %s preview requests without counting', async (method, headers) => {
    const f = fixture('/12', method as string, headers as Record<string, string>);
    await f.run();
    expect(f.store.recordVisit).not.toHaveBeenCalled();
    expect(f.response.redirect).toHaveBeenCalledWith(302, 'https://emergenthacks.com/');
  });
  it('rejects writes submitted with POST', async () => {
    const f = fixture('/12', 'POST');
    await f.run();
    expect(f.store.recordVisit).not.toHaveBeenCalled();
    expect(f.response.status).toHaveBeenCalledWith(405);
  });
  it('invalid paths never write', async () => {
    const f = fixture('/bad');
    await f.run();
    expect(f.store.recordVisit).not.toHaveBeenCalled();
  });
  it('still redirects when Firestore fails', async () => {
    const f = fixture();
    vi.mocked(f.store.recordVisit).mockRejectedValue(new Error('Offline'));
    await f.run();
    expect(f.failed).toHaveBeenCalledOnce();
    expect(f.response.redirect).toHaveBeenCalledOnce();
  });
  it('redirects after four seconds if Firestore stalls', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      vi.mocked(f.store.recordVisit).mockImplementation(() => new Promise(() => {}));
      const task = f.run();
      await vi.advanceTimersByTimeAsync(4000);
      await task;
      expect(f.failed).toHaveBeenCalledOnce();
      expect(f.response.redirect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('limits bursts without blocking the homepage', async () => {
    const f = fixture();
    f.limiter.check.mockImplementation(() => {
      throw { code: 'resource-exhausted' };
    });
    await f.run();
    expect(f.store.recordVisit).not.toHaveBeenCalled();
    expect(f.response.redirect).toHaveBeenCalledOnce();
  });
});

describe('Organizer poster access', () => {
  it.each([
    ['organizer', 'approved', null, true],
    ['organizer', 'pending', null, false],
    ['organizer', 'suspended', null, false],
    ['organizer', 'approved', 'team', false],
    ['captain', 'approved', 'team', false],
    ['judge', 'approved', null, false],
    ['member', 'approved', 'team', false],
  ])('%s / %s / %s access is %s', async (role, status, teamId, allowed) => {
    const f = fixture();
    const repo = new MemoryRepository({ 'events/main/members/user': { role, status, teamId } });
    const service = new PosterService(repo, f.store, 'main');
    if (allowed) {
      await service.stats('user', 10);
      expect(f.store.list).toHaveBeenCalledWith(10);
    } else {
      await expect(service.stats('user')).rejects.toThrow();
      expect(f.store.list).not.toHaveBeenCalled();
    }
  });
  it('rejects organizers from other events and missing members', async () => {
    const f = fixture();
    const repo = new MemoryRepository({
      'events/other/members/user': { role: 'organizer', status: 'approved', teamId: null },
    });
    await expect(new PosterService(repo, f.store, 'main').stats('user')).rejects.toThrow();
    expect(f.store.list).not.toHaveBeenCalled();
  });
});
