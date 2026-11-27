import type { NetWorthTaxItem } from '@ghostfolio/common/interfaces';

/**
 * Gives the tax which is owed at the given date (a liability). The tax of a
 * year accrues over its 12 months, stays owed in full afterwards and is no
 * longer owed from the month in which it was paid (paidOn, YYYY-MM), because
 * the payment has left the accounts by then. Past months keep the tax which
 * was owed at their date, hence paying a tax never changes them
 */
export function getTaxOwed({
  date,
  taxes
}: {
  date: Date;
  taxes: NetWorthTaxItem[];
}) {
  const month = date.getUTCFullYear() * 12 + date.getUTCMonth();
  let taxOwed = 0;

  for (const { amount, paidOn, year } of taxes) {
    if (!amount) {
      continue;
    }

    if (paidOn) {
      const [paidYear, paidMonth] = paidOn.split('-').map(Number);

      if (month >= paidYear * 12 + paidMonth - 1) {
        continue;
      }
    }

    const monthsAccrued = Math.min(Math.max(month - year * 12 + 1, 0), 12);

    taxOwed += (amount * monthsAccrued) / 12;
  }

  return taxOwed;
}
