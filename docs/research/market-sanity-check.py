"""Reproducible arithmetic checks for the proposed rulebook, not app tests.

Run: python3 docs/research/market-sanity-check.py
No external dependencies, network, credentials, or persisted game state.
"""

from fractions import Fraction
import json
from random import Random


def buy(x, y, q):
    return (y * q + x - q - 1) // (x - q)


def sell(x, y, q):
    return y * q // (x + q)


def allocate(demands, capacity=100):
    total = sum(demands)
    if total <= capacity:
        return list(demands)
    allocations = [capacity * d // total for d in demands]
    # Array order represents the precommitted immutable team tie order.
    order = sorted(range(len(demands)),
                   key=lambda i: (-(capacity * demands[i] % total), i))
    for i in order[:capacity - sum(allocations)]:
        allocations[i] += 1
    return allocations


def final_share_value(n, a, b):
    if n == 1:
        return 10_000
    den = 2 * (n - 1)
    num = 17_500 * den - 15_000 * (a + b - 2)
    return (2 * num + den) // (2 * den)


def main():
    rng = Random(20260908)
    assert buy(400, 4_000_000, 5) == 50_633
    assert buy(400, 4_000_000, 10) == 102_565
    assert sell(390, 4_102_565, 10) == 102_564
    assert buy(400, 4_000_000, 25) == 266_667
    assert sell(375, 4_266_667, 25) == 266_666
    assert allocate([25] * 5) == [20] * 5

    roundtrips = 20_000
    for _ in range(roundtrips):
        x = rng.randint(2, 500)
        y = rng.randint(100, 100_000_000)
        q = rng.randint(1, min(25, x - 1))
        debit = buy(x, y, q)
        nx, ny = x - q, y + debit
        credit = sell(nx, ny, q)
        assert nx * ny >= x * y
        assert 0 <= credit <= debit
        assert y + debit - credit >= y
        assert (nx + q) * (ny - credit) >= nx * ny
        assert debit - credit in (0, 1)

    allocation_cases = 10_000
    for _ in range(allocation_cases):
        requests = [rng.randint(0, 25) for _ in range(rng.randint(9, 29))]
        result = allocate(requests)
        assert sum(result) == min(100, sum(requests))
        assert all(0 <= a <= d for a, d in zip(result, requests))
        assert result == allocate(requests)

    basis_cases = 10_000
    for _ in range(basis_cases):
        shares = rng.randint(1, 25)
        original = basis = rng.randint(1, 10_000_000)
        removed = 0
        while shares:
            q = rng.randint(1, shares)
            portion = basis if q == shares else basis * q // shares
            basis -= portion
            removed += portion
            shares -= q
            assert basis >= 0
        assert basis == 0 and removed == original

    rank_cases = 0
    for n in range(1, 31):
        for a in range(1, n + 1):
            for b in range(a, n + 1):
                exact = (Fraction(10_000) if n == 1 else
                         Fraction(17_500) - Fraction(15_000 * (a + b - 2),
                                                    2 * (n - 1)))
                independent_round = (exact + Fraction(1, 2)).numerator // (
                    exact + Fraction(1, 2)).denominator
                assert final_share_value(n, a, b) == independent_round
                rank_cases += 1
        assert final_share_value(n, 1, n) == 10_000
    assert final_share_value(3, 1, 2) == 13_750
    assert 600_000 + 20 * 17_500 + 10 * 10_000 == 1_050_000

    print(json.dumps({
        "status": "passed",
        "seed": 20260908,
        "random_roundtrips": roundtrips,
        "allocation_cases": allocation_cases,
        "cost_basis_sequences": basis_cases,
        "rank_and_tie_cases": rank_cases,
        "scope": "Specification arithmetic only; no application or load tests",
    }, indent=2))


if __name__ == "__main__":
    main()
