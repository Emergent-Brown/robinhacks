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
const role = z.enum(['organizer', 'judge', 'captain', 'trader', 'member']);
const status = z.enum(['approved', 'pending', 'suspended']);
const eventCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('requestMembership'),
      commandId,
      staffRole: z.literal('judge').optional(),
      displayName: name,
    })
    .strict(),
  z
    .object({
      type: z.literal('approveMembership'),
      commandId,
      uid: identifier,
    })
    .strict(),
  z.object({ type: z.literal('setMemberRole'), commandId, uid: identifier, role, status }).strict(),
  z.object({ type: z.literal('updateProfile'), commandId, bio: line(280) }).strict(),
  z
    .object({
      type: z.literal('setTeamFormation'),
      commandId,
      open: z.boolean(),
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('createFormationTeam'),
      commandId,
      name,
      role: z.enum(['captain', 'trader', 'member']),
    })
    .strict(),
  z
    .object({
      type: z.literal('joinFormationTeam'),
      commandId,
      teamId: identifier,
      role: z.enum(['captain', 'trader', 'member']),
    })
    .strict(),
  z.object({ type: z.literal('removeMember'), commandId, uid: identifier }).strict(),
  z
    .object({
      type: z.literal('addOrganizerEmail'),
      commandId,
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
  z
    .object({
      type: z.literal('removeOrganizerEmail'),
      commandId,
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
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
      type: z.literal('transitionEvent'),
      commandId,
      target: z.literal('CANCELLED'),
      expectedPhaseVersion: version,
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
]);
export const commandSchema = z.union([platformCommandSchema, eventCommandSchema]);

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
