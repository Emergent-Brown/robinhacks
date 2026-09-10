export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export function safeInteger(value: number, label: string, min = 0): number {
  invariant(
    Number.isSafeInteger(value) && value >= min,
    'INVALID_AMOUNT',
    `${label} must be a safe whole number of at least ${min}.`,
  );
  return value;
}

export function fromBigInt(value: bigint, label: string, allowNegative = false): number {
  invariant(
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(allowNegative ? Number.MIN_SAFE_INTEGER : 0),
    'AMOUNT_OVERFLOW',
    `${label} is outside the supported range.`,
  );
  return Number(value);
}
