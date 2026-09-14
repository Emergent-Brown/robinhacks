import { describe, expect, it } from 'vitest';
import { defaultPlatformConfig } from '@robinhacks/core';
import { parseCommand } from '../packages/application/src/command-schema';

const settings = () => ({
  type: 'configurePlatform',
  commandId: 'settings-check',
  name: 'Emergent Hacks',
  venue: '',
  details: defaultPlatformConfig().details,
  funding: defaultPlatformConfig().funding,
});

describe('platform transport configuration', () => {
  it('rejects a time zone that would break every rendered deadline', () => {
    const command = settings();
    command.details.timeZone = 'Eastern-ish';
    expect(() => parseCommand(command)).toThrow();
    command.details.timeZone = 'America/New_York';
    expect(parseCommand(command)).toEqual(command);
  });

  it('requires exactly three builder prize places', () => {
    const command = settings();
    command.funding.builderPrizesMinor = [100];
    expect(() => parseCommand(command)).toThrow();
  });

  it('accepts the documented maximum funding duration and rejects longer windows', () => {
    const command = {
      type: 'openFundingRound',
      commandId: 'duration-check',
      expectedPhaseVersion: 1,
      durationMinutes: 1440,
    };
    expect(parseCommand(command)).toEqual(command);
    expect(() => parseCommand({ ...command, durationMinutes: 1441 })).toThrow();
  });

  it('lets the service choose the sole highest-scoring winner', () => {
    const command = {
      type: 'prepareAwards',
      commandId: 'winner-check',
      expectedPhaseVersion: 1,
      winnerId: '',
      tiebreakReason: '',
    };
    expect(parseCommand(command)).toEqual(command);
  });
});
