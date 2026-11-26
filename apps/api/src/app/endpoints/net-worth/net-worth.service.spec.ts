import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { CreateNetWorthSnapshotDto } from '@ghostfolio/common/dtos';

import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';

import { NetWorthService } from './net-worth.service';

describe('NetWorthService', () => {
  let findFirst: jest.Mock;
  let findManySnapshots: jest.Mock;
  let findManyTaxes: jest.Mock;
  let getAccountsWithAggregations: jest.Mock;
  let netWorthService: NetWorthService;
  let update: jest.Mock;
  let upsertTax: jest.Mock;

  const snapshot: CreateNetWorthSnapshotDto = {
    contribution: 500,
    date: '2026-10-31T13:45:00.000Z',
    items: [
      { group: 'CASH', name: 'Bank', value: 1000 },
      { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
    ],
    note: 'October'
  };

  beforeEach(() => {
    findFirst = jest.fn();
    findManySnapshots = jest.fn().mockResolvedValue([]);
    findManyTaxes = jest.fn().mockResolvedValue([]);
    getAccountsWithAggregations = jest.fn().mockResolvedValue({ accounts: [] });
    update = jest.fn();
    upsertTax = jest.fn();

    netWorthService = new NetWorthService(
      { getAccountsWithAggregations } as unknown as PortfolioService,
      {
        netWorthSnapshot: { findFirst, findMany: findManySnapshots, update },
        netWorthTax: { findMany: findManyTaxes, upsert: upsertTax }
      } as unknown as PrismaService
    );
  });

  describe('updateSnapshot', () => {
    it('updates the snapshot of the user, including its date', async () => {
      findFirst.mockResolvedValue({ id: 'snapshot-id' });
      update.mockResolvedValue({ id: 'snapshot-id' });

      const result = await netWorthService.updateSnapshot({
        snapshot,
        id: 'snapshot-id',
        userId: 'user-id'
      });

      expect(result).toEqual({ id: 'snapshot-id' });
      expect(findFirst).toHaveBeenCalledWith({
        select: { id: true },
        where: { id: 'snapshot-id', userId: 'user-id' }
      });
      expect(update).toHaveBeenCalledWith({
        data: {
          contribution: 500,
          date: new Date('2026-10-31T00:00:00.000Z'),
          items: [
            { group: 'CASH', name: 'Bank', quantity: undefined, value: 1000 },
            { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
          ],
          note: 'October'
        },
        where: { id: 'snapshot-id' }
      });
    });

    it('returns null when the snapshot belongs to another user', async () => {
      findFirst.mockResolvedValue(null);

      const result = await netWorthService.updateSnapshot({
        snapshot,
        id: 'snapshot-id',
        userId: 'other-user-id'
      });

      expect(result).toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('clears the note when it is removed', async () => {
      findFirst.mockResolvedValue({ id: 'snapshot-id' });

      await netWorthService.updateSnapshot({
        id: 'snapshot-id',
        snapshot: { ...snapshot, note: undefined },
        userId: 'user-id'
      });

      expect(update.mock.calls[0][0].data.note).toBeNull();
    });

    it('throws a conflict when another snapshot has the same date', async () => {
      findFirst.mockResolvedValue({ id: 'snapshot-id' });
      update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          clientVersion: 'test',
          code: 'P2002'
        })
      );

      const promise = netWorthService.updateSnapshot({
        snapshot,
        id: 'snapshot-id',
        userId: 'user-id'
      });

      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toMatchObject({
        status: StatusCodes.CONFLICT
      });
    });
  });

  describe('getNetWorth', () => {
    beforeEach(() => {
      findManySnapshots.mockResolvedValue([
        {
          contribution: 500,
          date: new Date('2026-10-31T00:00:00.000Z'),
          id: 'snapshot-id',
          items: [
            { group: 'CASH', name: 'Bank', value: 1000 },
            { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
          ],
          note: 'October'
        }
      ]);
      findManyTaxes.mockResolvedValue([
        {
          amount: 12000,
          paidOn: new Date('2027-05-01T00:00:00.000Z'),
          year: 2026
        }
      ]);
    });

    it('returns the values when the user may see them', async () => {
      const { snapshots, suggestion, taxes } =
        await netWorthService.getNetWorth({
          userId: 'user-id',
          withValues: true
        });

      expect(snapshots[0].contribution).toBe(500);
      expect(snapshots[0].items[0].value).toBe(1000);
      expect(suggestion).toEqual([
        { group: 'CASH', name: 'Bank', value: 1000 },
        { group: 'CRYPTO', name: 'Wallet', quantity: 0.5, value: 30000 }
      ]);
      expect(taxes).toEqual([{ amount: 12000, paidOn: '2027-05', year: 2026 }]);
    });

    it('redacts every monetary value otherwise', async () => {
      const { snapshots, suggestion, taxes } =
        await netWorthService.getNetWorth({
          userId: 'user-id',
          withValues: false
        });

      expect(snapshots).toEqual([
        {
          contribution: null,
          date: '2026-10-31T00:00:00.000Z',
          id: 'snapshot-id',
          items: [
            {
              group: 'CASH',
              name: 'Bank',
              quantity: undefined,
              unitPrice: undefined,
              value: null
            },
            {
              group: 'CRYPTO',
              name: 'Wallet',
              quantity: null,
              unitPrice: undefined,
              value: null
            }
          ],
          note: 'October'
        }
      ]);
      expect(
        suggestion.every(({ value }) => {
          return value === null;
        })
      ).toBe(true);
      expect(taxes).toEqual([{ amount: null, paidOn: '2027-05', year: 2026 }]);
    });
  });

  describe('upsertTax', () => {
    it('keeps the month of the payment as its first day', async () => {
      await netWorthService.upsertTax({
        amount: 12000,
        paidOn: '2027-05',
        userId: 'user-id',
        year: 2026
      });

      const paidOn = new Date('2027-05-01T00:00:00.000Z');

      expect(upsertTax).toHaveBeenCalledWith({
        create: { paidOn, amount: 12000, userId: 'user-id', year: 2026 },
        update: { paidOn, amount: 12000 },
        where: { userId_year: { userId: 'user-id', year: 2026 } }
      });
    });

    it('clears the month of the payment while the tax is owed', async () => {
      await netWorthService.upsertTax({
        amount: 12000,
        paidOn: null,
        userId: 'user-id',
        year: 2026
      });

      expect(upsertTax.mock.calls[0][0].update).toEqual({
        amount: 12000,
        paidOn: null
      });
    });
  });
});
