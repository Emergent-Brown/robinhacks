import { fromBigInt, invariant, safeInteger } from './errors.js';

/** Immutable credit amount, stored exclusively in integer hundredths. */
export class Credits {
  readonly minor: number;
  constructor(minor: number) {
    this.minor = safeInteger(minor, 'Credits');
  }
  static fromMinor(minor: number): Credits {
    return new Credits(minor);
  }
  static parse(value: string): Credits {
    invariant(
      /^\d+(?:\.\d{1,2})?$/.test(value),
      'INVALID_AMOUNT',
      'Enter credits with at most two decimal places.',
    );
    const [whole = '0', fraction = ''] = value.split('.');
    return new Credits(
      fromBigInt(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')), 'Credits'),
    );
  }
  add(other: Credits): Credits {
    return new Credits(fromBigInt(BigInt(this.minor) + BigInt(other.minor), 'Credits'));
  }
  subtract(other: Credits): Credits {
    invariant(
      this.minor >= other.minor,
      'INSUFFICIENT_FUNDS',
      'There are not enough available credits.',
    );
    return new Credits(this.minor - other.minor);
  }
  multiply(quantity: ShareQuantity): Credits {
    return new Credits(fromBigInt(BigInt(this.minor) * BigInt(quantity.value), 'Credits'));
  }
  toJSON(): number {
    return this.minor;
  }
}

/** Whole game shares; positions can be empty, orders must be positive. */
export class ShareQuantity {
  readonly value: number;
  constructor(value: number) {
    this.value = safeInteger(value, 'Shares');
  }
  static positive(value: number): ShareQuantity {
    safeInteger(value, 'Shares', 1);
    return new ShareQuantity(value);
  }
  toJSON(): number {
    return this.value;
  }
}
