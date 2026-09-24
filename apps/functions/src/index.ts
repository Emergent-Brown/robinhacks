import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  ApplicationError,
  GameService,
  SystemClock,
  identifier,
  parseCommand,
  PosterService,
} from '@robinhacks/application';
import { DomainError } from '@robinhacks/core';
import { FirestoreRepository } from './firestore-repository';
import { RequestLimiter } from './request-limiter';
import { FirestorePosterStore } from './firestore-poster-store';
import { PosterRedirect } from './poster-redirect';

initializeApp();
const repository = new FirestoreRepository(getFirestore());
const clock = new SystemClock();
const limiter = new RequestLimiter();
const posters = new FirestorePosterStore(getFirestore());
const posterEventId = process.env.POSTER_EVENT_ID || 'robinhacks-2026';
const posterRedirect = new PosterRedirect(posters, limiter, () => {
  logger.warn('Poster counter unavailable; visitor redirected without confirmation.');
});
const envelope = z.object({ eventId: identifier }).strict();
const commandEnvelope = z.object({ eventId: identifier, command: z.unknown() }).strict();
const conversationEnvelope = z.object({ eventId: identifier, otherTeamId: identifier }).strict();
const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const options = {
  region: process.env.FUNCTION_REGION || 'us-west1',
  minInstances: 0,
  maxInstances: 2,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
  cors: configuredOrigins?.length
    ? configuredOrigins
    : [
        'https://emergenthacks.com',
        'https://www.emergenthacks.com',
        /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/,
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
      ],
};

async function actor(request: CallableRequest, action: string, rate = 60) {
  if (!request.auth)
    throw new HttpsError('unauthenticated', 'Sign in before opening this event.', {
      code: 'SIGN_IN_REQUIRED',
    });
  if (
    request.auth.token.firebase?.sign_in_provider !== 'google.com' ||
    request.auth.token.email_verified !== true
  )
    throw new HttpsError('permission-denied', 'Use a verified Google account to sign in.', {
      code: 'GOOGLE_SIGN_IN_REQUIRED',
    });
  limiter.check(request.auth.uid, action, rate);
  // Callable signature verification alone does not revoke deleted or disabled
  // accounts. Check the current Auth record before granting any event access.
  const bearer = request.rawRequest.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  try {
    if (!bearer) throw new Error('Missing token');
    await getAuth().verifyIdToken(bearer, true);
  } catch {
    throw new HttpsError(
      'unauthenticated',
      'Your sign-in has expired. Sign in with Google again.',
      { code: 'SIGN_IN_REQUIRED' },
    );
  }
  return {
    uid: request.auth.uid,
    displayName: typeof request.auth.token.name === 'string' ? request.auth.token.name : undefined,
    email: typeof request.auth.token.email === 'string' ? request.auth.token.email : undefined,
    emailVerified: request.auth.token.email_verified === true,
  };
}

function requireSmallPayload(data: unknown) {
  const type = (data as { command?: { type?: string } } | null)?.command?.type;
  const limit = type === 'saveJudgingSheet' ? 192 : type === 'configurePlatform' ? 64 : 16;
  if (Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8') > limit * 1024)
    throw new HttpsError(
      'invalid-argument',
      `This request exceeds the ${limit} KiB command limit.`,
      {
        code: 'PAYLOAD_TOO_LARGE',
      },
    );
}

async function transport<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof z.ZodError)
      throw new HttpsError(
        'invalid-argument',
        error.issues[0]?.message ?? 'The request is invalid.',
        { code: 'INVALID_ARGUMENT' },
      );
    if (error instanceof ApplicationError || error instanceof DomainError) {
      const permissions = /REQUIRED|CANNOT_COMPETE|ALREADY_REGISTERED/.test(error.code);
      throw new HttpsError(
        permissions ? 'permission-denied' : 'failed-precondition',
        error.message,
        { code: error.code },
      );
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 10 || error.code === 'aborted')
    )
      throw new HttpsError(
        'aborted',
        'The shared state changed too often. Retry this same request after refreshing.',
        { code: 'RETRYABLE_CONTENTION' },
      );
    // Never log input, identity tokens, credentials, private notes, or command payloads.
    logger.error('Unhandled game service error', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new HttpsError(
      'internal',
      'The request could not be completed. Keep its request ID when retrying.',
      { code: 'INTERNAL_ERROR' },
    );
  }
}

export const gameCommand = onCall(options, (request) =>
  transport(async () => {
    const identity = await actor(request, 'command', 90);
    requireSmallPayload(request.data);
    const data = commandEnvelope.parse(request.data);
    return new GameService(repository, data.eventId, clock).execute(
      identity,
      parseCommand(data.command),
    );
  }),
);

export const gameSnapshot = onCall(options, (request) =>
  transport(async () => {
    const identity = await actor(request, 'snapshot', 60);
    const data = envelope.parse(request.data);
    return new GameService(repository, data.eventId, clock).snapshot(identity.uid, identity);
  }),
);

export const gamePublic = onCall({ ...options, enforceAppCheck: false }, (request) =>
  transport(async () => {
    // A room of 150 attendees can share one public IP and load the homepage together.
    limiter.check(request.rawRequest.ip || 'public', 'public', 600);
    const data = envelope.parse(request.data);
    return new GameService(repository, data.eventId, clock).publicSnapshot();
  }),
);

export const gameConversation = onCall(options, (request) =>
  transport(async () => {
    const identity = await actor(request, 'conversation', 30);
    const data = conversationEnvelope.parse(request.data);
    return new GameService(repository, data.eventId, clock).conversation(
      identity.uid,
      data.otherTeamId,
    );
  }),
);

export const gameExport = onCall(options, (request) =>
  transport(async () => {
    const identity = await actor(request, 'export', 2);
    const data = envelope.parse(request.data);
    return new GameService(repository, data.eventId, clock).exportEvent(identity.uid);
  }),
);

export const posterVisit = onRequest(
  {
    region: options.region,
    minInstances: 0,
    maxInstances: 2,
    memory: '256MiB',
    timeoutSeconds: 15,
    invoker: 'public',
  },
  (req, res) => posterRedirect.handle(req, res),
);

export const posterStats = onCall(options, (request) =>
  transport(async () => {
    const identity = await actor(request, 'poster-stats', 20);
    const data = z
      .object({
        eventId: identifier,
        after: z.number().int().min(0).max(99999).default(0),
      })
      .strict()
      .parse(request.data);
    if (data.eventId !== posterEventId)
      throw new HttpsError('permission-denied', 'Poster counts belong to the main event.');
    return new PosterService(repository, posters, posterEventId).stats(identity.uid, data.after);
  }),
);
