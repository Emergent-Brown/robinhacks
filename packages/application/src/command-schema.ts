import { z } from 'zod';
import type { Command } from '@robinhacks/core';
import { platformCommandSchema } from './platform-schema';

export const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const commandId = identifier.min(8);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const line = (max: number) => z.string().trim().max(max);
const name = line(60).min(2);
const url = z.union([
  z.literal(''),
  z
    .string()
    .max(500)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS URL.'),
]);
const phase = z.enum([
  'DRAFT',
  'REGISTRATION',
  'SEED_OPEN',
  'SEED_SETTLING',
  'INTERMISSION',
  'TRADING_OPEN',
  'FROZEN',
  'FINALIZING',
  'FINALIZED',
  'CANCELLED',
  'ARCHIVED',
]);
const role = z.enum(['organizer', 'judge', 'captain', 'trader', 'member']);
const status = z.enum(['approved', 'pending', 'suspended']);
const boundedMap = (value: z.ZodTypeAny) =>
  z
    .record(identifier, value)
    .refine(
      (map) =>
        Object.keys(map).length <= 30 &&
        !Object.keys(map).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)),
      'At most 30 valid project entries are permitted.',
    );

const legacyCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('executeTrade'),
      commandId,
      issuerId: identifier,
      side: z.enum(['BUY', 'SELL']),
      shares: z.number().int().min(1).max(25),
      expectedPoolVersion: version,
      expectedWalletVersion: version,
      expectedPhaseVersion: version,
      maxDebitMinor: minor.optional(),
      minCreditMinor: minor.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('requestMembership'),
      commandId,
      staffRole: z.enum(['judge', 'organizer']).optional(),
      displayName: name,
      teamName: name.optional(),
      teamId: identifier.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('approveMembership'),
      commandId,
      uid: identifier,
      role: z.enum(['captain', 'member', 'trader']),
      teamId: identifier.optional(),
      teamName: name.optional(),
    })
    .strict(),
  z.object({ type: z.literal('setMemberRole'), commandId, uid: identifier, role, status }).strict(),
  z
    .object({
      type: z.literal('updateTeam'),
      commandId,
      expectedVersion: version,
      patch: z
        .object({
          name: name.optional(),
          pitch: line(140).optional(),
          category: line(40).optional(),
          problem: line(1200).optional(),
          building: line(1200).optional(),
          demoUrl: url.optional(),
          repoUrl: url.optional(),
          update: line(500).optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'Include a profile change.'),
    })
    .strict(),
  z
    .object({
      type: z.literal('setSeedCommitments'),
      commandId,
      shares: boundedMap(z.number().int().min(0).max(25)),
      expectedWalletVersion: version,
      expectedCommitmentVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('saveNote'),
      commandId,
      issuerId: identifier,
      thesis: line(1200),
      reconsider: line(1200),
      nextCheck: line(200),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('transitionEvent'),
      commandId,
      target: phase,
      expectedPhaseVersion: version,
      durationMinutes: z.number().int().min(1).max(240).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('setPause'),
      commandId,
      paused: z.boolean(),
      reason: line(200),
      expectedPhaseVersion: version,
    })
    .strict(),
  z.object({ type: z.literal('setAnnouncement'), commandId, announcement: line(500) }).strict(),
  z
    .object({
      type: z.literal('haltIssuer'),
      commandId,
      issuerId: identifier,
      eligibility: z.enum(['active', 'withdrawn', 'disqualified']),
      reason: line(200).min(3),
    })
    .strict(),
  z.object({ type: z.literal('continueOperation'), commandId }).strict(),
  z
    .object({
      type: z.literal('prepareResults'),
      commandId,
      scores: boundedMap(
        z
          .number()
          .min(0)
          .max(100)
          .refine(
            (value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)),
            'Use at most two decimal places.',
          ),
      ),
    })
    .strict(),
  z
    .object({ type: z.literal('publishResults'), commandId, expectedPhaseVersion: version })
    .strict(),
  z.object({ type: z.literal('refreshMarket'), commandId }).strict(),
]);
export const commandSchema = z.union([platformCommandSchema, legacyCommandSchema]);

export function parseCommand(value: unknown): Command {
  return commandSchema.parse(value) as Command;
}

/** Stable canonical payloads are compared for replay safety; no cryptographic claim. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
