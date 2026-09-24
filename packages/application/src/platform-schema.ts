import { z } from 'zod';
import { JUDGING_SCORE_MAX } from '@robinhacks/core';
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const commandId = id.min(8);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().max(max);
const url = z.union([
  z.literal(''),
  z
    .string()
    .max(500)
    .url()
    .refine((value) => /^https:\/\//i.test(value), 'Use an HTTPS URL.'),
]);
const email = z.union([z.literal(''), z.string().email().max(254)]);
const map = <T extends z.ZodTypeAny>(value: T) =>
  z
    .record(id, value)
    .refine(
      (values) =>
        Object.keys(values).length <= 30 &&
        !Object.keys(values).some((key) => ['__proto__', 'constructor', 'prototype'].includes(key)),
      'Use at most 30 valid projects.',
    );
const money = z.number().int().min(0).max(100_000_000);
const deadline = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
const timeZone = text(80)
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid time zone, such as America/New_York.');
const plannedWindow = z
  .object({
    startsAt: z.number().int().positive().max(253402300799999),
    closesAt: z.number().int().positive().max(253402300799999),
  })
  .strict();
const details = z
  .object({
    theme: text(80),
    about: text(1500),
    dateLabel: text(150),
    timeZone,
    eligibility: text(1000),
    registrationUrl: url,
    contactEmail: email,
    logistics: z
      .object({
        gettingThere: text(1000),
        meals: text(500),
        overnight: text(1000),
        bring: text(500),
      })
      .strict()
      .optional(),
    organization: z
      .object({ about: text(1000), url })
      .strict()
      .optional(),
    schedule: z
      .array(
        z
          .object({
            time: text(100),
            title: text(100),
            description: text(500),
            window: z.enum(['round1', 'round2', 'round3', 'submissions', 'ballot']).optional(),
          })
          .strict(),
      )
      .max(32),
    timing: z
      .object({
        rounds: z.array(plannedWindow).length(3),
        submissions: plannedWindow,
        ballot: plannedWindow,
      })
      .strict()
      .optional(),
  })
  .strict();
const funding = z
  .object({
    budget: z.number().int().min(10).max(10000),
    increment: z.number().int().min(1).max(1000),
    maxPerProject: z.number().int().min(1).max(10000),
    minimumDenominator: z.number().int().min(1).max(1_000_000),
    roundNames: z.array(text(60).min(1)).length(3),
    roundWeightsBps: z.array(z.number().int().min(1).max(10000)).length(3),
    investorPoolMinor: money,
    builderPrizesMinor: z.array(money).length(3),
    communityPrizeMinor: money,
    currency: z.literal('USD'),
    reservePolicy: text(500).min(10),
    reviewMinutes: z.number().int().min(1).max(1440),
    rubric: z
      .array(
        z.object({ id, label: text(80).min(1), weight: z.number().int().min(1).max(100) }).strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
const entry = z
  .object({
    scores: z.record(id, z.number().int().min(0).max(JUDGING_SCORE_MAX)),
    note: text(1500),
    conflict: z.boolean(),
  })
  .strict();
export const platformCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('configurePlatform'),
      commandId,
      details,
      funding,
      name: text(80).min(2),
      venue: text(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('openFundingRound'),
      commandId,
      expectedPhaseVersion: version,
      durationMinutes: z.number().int().min(1).max(1440),
      closesAt: z.number().int().positive().max(253402300799999).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('saveAllocation'),
      commandId,
      roundId: id,
      amounts: map(z.number().int().min(0).max(10000)),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('closeFundingRound'),
      commandId,
      roundId: id,
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('voidFundingRound'),
      commandId,
      roundId: id,
      reason: text(500).min(5),
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('publishUpdate'),
      commandId,
      round: z.number().int().min(1).max(3),
      works: text(600).min(5),
      changed: text(600),
      evidenceUrl: url,
      incomplete: text(600).min(3),
    })
    .strict(),
  z
    .object({
      type: z.literal('setSubmissionWindow'),
      commandId,
      open: z.boolean(),
      closesAt: deadline,
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('submitProject'),
      commandId,
      expectedTeamVersion: version,
      commitSha: z
        .string()
        .regex(
          /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/,
          'Use a full 40- or 64-character commit hash.',
        ),
      techStack: text(300),
    })
    .strict(),
  z.object({ type: z.literal('sendGeneralMessage'), commandId, body: text(1000).min(1) }).strict(),
  z
    .object({
      type: z.literal('readGeneral'),
      commandId,
      throughSequence: z.number().int().min(0).max(100000),
    })
    .strict(),
  z
    .object({
      type: z.literal('removeChatMessage'),
      commandId,
      kind: z.enum(['general', 'team']),
      id,
      messageId: id,
      sequence: z.number().int().min(1).max(100000).optional(),
      reason: text(500).min(5),
    })
    .strict(),
  z
    .object({ type: z.literal('sendMessage'), commandId, toTeamId: id, body: text(1000).min(1) })
    .strict(),
  z.object({ type: z.literal('readConversation'), commandId, otherTeamId: id }).strict(),
  z
    .object({
      type: z.literal('blockConversation'),
      commandId,
      otherTeamId: id,
      blocked: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('reportMessage'),
      commandId,
      otherTeamId: id,
      messageId: id,
      reason: text(500).min(5),
    })
    .strict(),
  z
    .object({
      type: z.literal('assignJudge'),
      commandId,
      uid: id,
      projectIds: z.array(id).max(30),
      conflictIds: z.array(id).max(30),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('saveJudgingSheet'),
      commandId,
      entries: map(entry),
      expectedVersion: version,
      submit: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('setBallotWindow'),
      commandId,
      open: z.boolean(),
      closesAt: deadline,
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('saveBallot'),
      commandId,
      rankedProjectIds: z.array(id).max(3),
      expectedVersion: version,
    })
    .strict(),
  z.object({ type: z.literal('beginJudging'), commandId, expectedPhaseVersion: version }).strict(),
  z
    .object({
      type: z.literal('prepareAwards'),
      commandId,
      winnerId: z.union([id, z.literal('')]),
      tiebreakReason: text(500),
      expectedPhaseVersion: version,
    })
    .strict(),
  z
    .object({
      type: z.literal('discardAwards'),
      commandId,
      reason: text(500).min(5),
      expectedPhaseVersion: version,
    })
    .strict(),
  z.object({ type: z.literal('publishAwards'), commandId, expectedPhaseVersion: version }).strict(),
]);
export const fundingCommandTypes = new Set([
  'configurePlatform',
  'openFundingRound',
  'saveAllocation',
  'closeFundingRound',
  'voidFundingRound',
]);
export const platformCommandTypes = new Set<string>(
  platformCommandSchema.options.map((option) => option.shape.type.value),
);
