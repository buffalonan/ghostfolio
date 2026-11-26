import { getTaxOwed } from './net-worth-tax';

describe('getTaxOwed', () => {
  const endOfMonth = (aYear: number, aMonth: number) => {
    return new Date(Date.UTC(aYear, aMonth, 0));
  };

  it('accrues the tax of a year over its 12 months', () => {
    const taxes = [{ amount: 12000, year: 2025 }];

    expect(getTaxOwed({ taxes, date: endOfMonth(2024, 12) })).toBe(0);
    expect(getTaxOwed({ taxes, date: endOfMonth(2025, 1) })).toBe(1000);
    expect(getTaxOwed({ taxes, date: endOfMonth(2025, 6) })).toBe(6000);
    expect(getTaxOwed({ taxes, date: endOfMonth(2025, 12) })).toBe(12000);
  });

  it('keeps the tax owed in full until it is paid', () => {
    const taxes = [{ amount: 12000, year: 2025 }];

    expect(getTaxOwed({ taxes, date: endOfMonth(2026, 4) })).toBe(12000);
    expect(getTaxOwed({ taxes, date: endOfMonth(2030, 1) })).toBe(12000);
  });

  it('no longer owes the tax from the month in which it was paid', () => {
    const taxes = [{ amount: 12000, paidOn: '2026-05', year: 2025 }];

    expect(getTaxOwed({ taxes, date: endOfMonth(2025, 12) })).toBe(12000);
    expect(getTaxOwed({ taxes, date: endOfMonth(2026, 4) })).toBe(12000);
    expect(getTaxOwed({ taxes, date: endOfMonth(2026, 5) })).toBe(0);
    expect(getTaxOwed({ taxes, date: endOfMonth(2028, 1) })).toBe(0);
  });

  it('adds the tax of the previous year to the one of the current year', () => {
    const taxes = [
      { amount: 12000, paidOn: '2026-05', year: 2025 },
      { amount: 24000, year: 2026 }
    ];

    // March 2026: 2025 in full and 3 months of 2026
    expect(getTaxOwed({ taxes, date: endOfMonth(2026, 3) })).toBe(18000);

    // June 2026: 2025 is paid, 6 months of 2026
    expect(getTaxOwed({ taxes, date: endOfMonth(2026, 6) })).toBe(12000);
  });

  it('ignores years without an amount', () => {
    expect(
      getTaxOwed({
        date: endOfMonth(2026, 6),
        taxes: [{ amount: 0, year: 2026 }]
      })
    ).toBe(0);
  });
});
