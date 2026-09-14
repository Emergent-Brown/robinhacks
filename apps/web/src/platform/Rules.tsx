import { useState } from 'react';
import type { AppSnapshot } from '@robinhacks/core';
import { Dialog } from '../ui/primitives';
import { config, money, percent, rewardCopy } from './shared';

export function Rules({ data }: { data: AppSnapshot }) {
  const { funding } = config(data);
  return (
    <div className="p-rules">
      <h2>Three sealed funding rounds</h2>
      <p>
        Each team gets {funding.budget} fresh credits in each round. Allocate in steps of{' '}
        {funding.increment}, with at most {funding.maxPerProject} credits in one project. Your team
        cannot back itself. Receiving funding does not add to your budget.
      </p>
      <h2>One private allocation per team</h2>
      <p>
        The captain and designated investor can edit the same allocation until the deadline. Valid
        changes save automatically. Unused credits expire. Current-round allocations and totals stay
        private until the round closes. There is no selling or carryover.
      </p>
      <h2>Each round stands on its own</h2>
      <p>
        After close, your locked entitlement is the round’s reward weight × your credits ÷ the
        larger of {funding.minimumDenominator} or the project’s total credits that round. Later
        rounds cannot dilute that entitlement.
      </p>
      <ul>
        {funding.roundNames.map((name, index) => (
          <li key={name}>
            {name}: {percent(funding.roundWeightsBps[index]! / 10000)} of investor rewards.
          </li>
        ))}
      </ul>
      <h2>Judging and prizes</h2>
      <p>
        Independent judges choose the grand-prize winner without seeing funding totals. Only
        investments in that winner earn investor rewards. Builder prizes and the community award are
        separate.
      </p>
      <p>
        {rewardCopy(funding)}.{' '}
        {funding.investorPoolMinor > 0
          ? 'This is a maximum payout; some funds may remain unallocated.'
          : 'Credits and entitlement percentages are game records, not money or company ownership.'}{' '}
        {funding.reservePolicy}
      </p>
      <p>
        Builder prizes:{' '}
        {funding.builderPrizesMinor.some((amount) => amount > 0)
          ? funding.builderPrizesMinor.map(money).join(' / ')
          : 'not announced'}
        . Community prize:{' '}
        {funding.communityPrizeMinor > 0 ? money(funding.communityPrizeMinor) : 'not announced'}.
      </p>
      <h2>Fair play and final review</h2>
      <p>
        No reciprocal-backing deals, extra team accounts, false project claims, or deliberate
        outcome manipulation. Publish honest evidence, including what is incomplete. Withdrawn,
        disqualified, or unsubmitted projects earn no investor reward. Unused allocations are not
        refunded.
      </p>
      <p>
        Judges resolve ties before a single winner is confirmed. Results remain under review for at
        least {funding.reviewMinutes} minutes before publication. A technical incident can pause a
        round; revealed rounds cannot reopen. A formally voided round awards no entitlement and is
        not replayed.
      </p>
    </div>
  );
}

export function QuickStart({ data, onClose }: { data: AppSnapshot; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const funding = config(data).funding;
  const steps = [
    [
      'Build and show your work',
      'Add your project, introduce the team, and publish a short evidence-backed update before each funding round.',
    ],
    [
      'Back other teams',
      `Your team gets ${funding.budget} credits per round. Read projects, ask questions, and enter amounts on Investments. Your valid allocation saves privately until the deadline.`,
    ],
    [
      'Review the round, then keep building',
      'At close, everyone sees project totals. Your team sees its own locked entitlements. Later rounds are new decisions; previous allocations stay fixed. Judges decide the final winner independently.',
    ],
  ];
  return (
    <Dialog title="How the event works" onClose={onClose}>
      <div className="p-quick-start">
        <p className="muted">
          {step + 1} of {steps.length}
        </p>
        <h2>{steps[step]![0]}</h2>
        <p>{steps[step]![1]}</p>
        <div className="p-actions">
          <button className="button secondary" onClick={onClose}>
            Skip
          </button>
          <button
            className="button primary"
            onClick={() => (step === steps.length - 1 ? onClose() : setStep(step + 1))}
          >
            {step === steps.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
