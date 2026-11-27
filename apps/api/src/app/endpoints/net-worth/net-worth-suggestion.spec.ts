import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import type { NetWorthItem } from '@ghostfolio/common/interfaces';

import { NetWorthService } from './net-worth.service';

/**
 * The suggestion for the next month and the import, which turn Ghostfolio's
 * accounts and the user's files into the numbers of the net worth page
 */
describe('NetWorthService suggestion and import', () => {
  let findManyOrders: jest.Mock;
  let findManySnapshots: jest.Mock;
  let getAccountsWithAggregations: jest.Mock;
  let netWorthService: NetWorthService;
  let transaction: jest.Mock;
  let upsertSnapshot: jest.Mock;

  const account = ({
    activitiesCount = 0,
    id,
    name,
    valueInBaseCurrency
  }: {
    activitiesCount?: number;
    id: string;
    name: string;
    valueInBaseCurrency: number;
  }) => {
    return { activitiesCount, id, name, valueInBaseCurrency };
  };

  const snapshotWith = (aDate: string, aItems: NetWorthItem[]) => {
    return {
      contribution: 0,
      date: new Date(aDate),
      id: `snapshot-${aDate}`,
      items: aItems,
      note: null
    };
  };

  const getSuggestion = async () => {
    const { suggestion } = await netWorthService.getNetWorth({
      userId: 'user-id',
      withValues: true
    });

    return suggestion;
  };

  beforeEach(() => {
    findManyOrders = jest.fn().mockResolvedValue([]);
    findManySnapshots = jest.fn().mockResolvedValue([]);
    getAccountsWithAggregations = jest.fn().mockResolvedValue({ accounts: [] });
    upsertSnapshot = jest.fn((args) => {
      return args;
    });
    transaction = jest.fn((operations) => {
      return Promise.all(operations);
    });

    netWorthService = new NetWorthService(
      { getAccountsWithAggregations } as unknown as PortfolioService,
      {
        $transaction: transaction,
        netWorthSnapshot: {
          findMany: findManySnapshots,
          upsert: upsertSnapshot
        },
        netWorthTax: { findMany: jest.fn().mockResolvedValue([]) },
        order: { findMany: findManyOrders }
      } as unknown as PrismaService
    );
  });

  describe('suggestion', () => {
    it('starts from the accounts when there is no snapshot yet', async () => {
      getAccountsWithAggregations.mockResolvedValue({
        accounts: [
          account({ id: 'a1', name: 'Bank', valueInBaseCurrency: 1000 }),
          account({
            activitiesCount: 3,
            id: 'a2',
            name: 'Broker',
            valueInBaseCurrency: 5000
          }),
          account({ id: 'a3', name: 'Empty', valueInBaseCurrency: 0 })
        ]
      });

      expect(await getSuggestion()).toEqual([
        { group: 'CASH', name: 'Bank', value: 1000 },
        { group: 'INVESTMENTS', name: 'Broker', value: 5000 }
      ]);
    });

    it('carries over the latest snapshot, without the tax', async () => {
      findManySnapshots.mockResolvedValue([
        snapshotWith('2026-09-30', [
          { group: 'CASH', name: 'Old bank', value: 1 }
        ]),
        snapshotWith('2026-10-31', [
          { group: 'PENSION', name: 'Pension', value: 20000 },
          { group: 'LIABILITY', name: 'Tax', value: 3000 }
        ])
      ]);

      expect(await getSuggestion()).toEqual([
        { group: 'PENSION', name: 'Pension', value: 20000 }
      ]);
    });

    it('refreshes the items which match an account by name', async () => {
      findManySnapshots.mockResolvedValue([
        snapshotWith('2026-10-31', [
          { group: 'INVESTMENTS', name: 'Broker', value: 5000 },
          { group: 'PENSION', name: 'Pension', value: 20000 }
        ])
      ]);
      getAccountsWithAggregations.mockResolvedValue({
        accounts: [
          account({
            activitiesCount: 3,
            id: 'a2',
            name: 'Broker',
            valueInBaseCurrency: 5500
          })
        ]
      });

      expect(await getSuggestion()).toEqual([
        { group: 'INVESTMENTS', name: 'Broker', value: 5500 },
        { group: 'PENSION', name: 'Pension', value: 20000 }
      ]);
    });

    it('values crypto as its units at the account price', async () => {
      findManySnapshots.mockResolvedValue([
        snapshotWith('2026-10-31', [
          { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
        ])
      ]);
      getAccountsWithAggregations.mockResolvedValue({
        accounts: [
          account({
            activitiesCount: 2,
            id: 'wallet-id',
            name: 'Wallet',
            valueInBaseCurrency: 32000
          })
        ]
      });
      findManyOrders.mockResolvedValue([
        { quantity: 0.75, type: 'BUY' },
        { quantity: 0.25, type: 'SELL' }
      ]);

      expect(await getSuggestion()).toEqual([
        {
          group: 'CRYPTO',
          name: 'Wallet',
          quantity: 0.5,
          unitPrice: 64000,
          value: 32000
        }
      ]);
      expect(findManyOrders).toHaveBeenCalledWith({
        select: { quantity: true, type: true },
        where: {
          accountId: 'wallet-id',
          type: { in: ['BUY', 'SELL'] },
          userId: 'user-id'
        }
      });
    });

    it('keeps the units of crypto when the account has none left', async () => {
      findManySnapshots.mockResolvedValue([
        snapshotWith('2026-10-31', [
          { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
        ])
      ]);
      getAccountsWithAggregations.mockResolvedValue({
        accounts: [
          account({ id: 'wallet-id', name: 'Wallet', valueInBaseCurrency: 0 })
        ]
      });
      findManyOrders.mockResolvedValue([
        { quantity: 0.5, type: 'BUY' },
        { quantity: 0.5, type: 'SELL' }
      ]);

      expect(await getSuggestion()).toEqual([
        { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 0 }
      ]);
    });

    it('treats a renamed account as a new one and keeps the old item', async () => {
      findManySnapshots.mockResolvedValue([
        snapshotWith('2026-10-31', [
          { group: 'CASH', name: 'Bank', value: 1000 }
        ])
      ]);
      getAccountsWithAggregations.mockResolvedValue({
        accounts: [
          account({
            id: 'a1',
            name: 'Bank (savings)',
            valueInBaseCurrency: 1200
          })
        ]
      });

      expect(await getSuggestion()).toEqual([
        { group: 'CASH', name: 'Bank', value: 1000 },
        { group: 'CASH', name: 'Bank (savings)', value: 1200 }
      ]);
    });
  });

  describe('import', () => {
    it('upserts every snapshot of the user by its UTC day, in one transaction', async () => {
      await netWorthService.upsertSnapshots({
        snapshots: [
          {
            date: '2026-09-30T22:15:00.000Z',
            items: [{ group: 'CASH', name: 'Bank', value: 900 }]
          },
          {
            contribution: 500,
            date: '2026-10-31',
            items: [
              { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
            ],
            note: 'October'
          }
        ],
        userId: 'user-id'
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(upsertSnapshot.mock.calls.map(([args]) => args)).toEqual([
        {
          create: {
            contribution: 0,
            date: new Date('2026-09-30T00:00:00.000Z'),
            items: [{ group: 'CASH', name: 'Bank', value: 900 }],
            note: null,
            userId: 'user-id'
          },
          update: {
            contribution: 0,
            items: [{ group: 'CASH', name: 'Bank', value: 900 }],
            note: null
          },
          where: {
            userId_date: {
              date: new Date('2026-09-30T00:00:00.000Z'),
              userId: 'user-id'
            }
          }
        },
        {
          create: {
            contribution: 500,
            date: new Date('2026-10-31T00:00:00.000Z'),
            items: [
              { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
            ],
            note: 'October',
            userId: 'user-id'
          },
          update: {
            contribution: 500,
            items: [
              { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
            ],
            note: 'October'
          },
          where: {
            userId_date: {
              date: new Date('2026-10-31T00:00:00.000Z'),
              userId: 'user-id'
            }
          }
        }
      ]);
    });

    it('keeps only the known fields of each item', async () => {
      await netWorthService.upsertSnapshots({
        snapshots: [
          {
            date: '2026-10-31',
            items: [
              {
                group: 'CASH',
                name: 'Bank',
                unitPrice: 1,
                value: 900
              } as NetWorthItem
            ]
          }
        ],
        userId: 'user-id'
      });

      expect(upsertSnapshot.mock.calls[0][0].create.items).toEqual([
        { group: 'CASH', name: 'Bank', quantity: undefined, value: 900 }
      ]);
      expect(
        upsertSnapshot.mock.calls[0][0].create.items[0]
      ).not.toHaveProperty('unitPrice');
    });
  });
});
