import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { CreateNetWorthSnapshotDto } from '@ghostfolio/common/dtos';
import {
  NetWorthItem,
  NetWorthResponse,
  NetWorthSnapshotItem
} from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import { NetWorthSnapshot, Prisma } from '@prisma/client';

@Injectable()
export class NetWorthService {
  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly prismaService: PrismaService
  ) {}

  public async deleteSnapshot({ id, userId }: { id: string; userId: string }) {
    const { count } = await this.prismaService.netWorthSnapshot.deleteMany({
      where: { id, userId }
    });

    return count > 0;
  }

  public async getNetWorth(userId: string): Promise<NetWorthResponse> {
    const [snapshots, taxes, { accounts }] = await Promise.all([
      this.prismaService.netWorthSnapshot.findMany({
        orderBy: { date: 'asc' },
        where: { userId }
      }),
      this.prismaService.netWorthTax.findMany({
        orderBy: { year: 'desc' },
        select: { amount: true, year: true },
        where: { userId }
      }),
      this.portfolioService.getAccountsWithAggregations({
        userId,
        withExcludedAccounts: true
      })
    ]);

    // The tax is derived from the yearly amounts, hence it is not suggested
    const latestItems: NetWorthItem[] =
      snapshots.length > 0
        ? this.toSnapshotItem(snapshots.at(-1)).items.filter(({ group }) => {
            return group !== 'LIABILITY';
          })
        : [];

    const accountByName = new Map(
      accounts.map((account) => {
        return [account.name, account] as const;
      })
    );

    // Carry over the latest items and refresh the ones which match an account
    const suggestion: NetWorthItem[] = await Promise.all(
      latestItems.map(async (item) => {
        const account = accountByName.get(item.name);

        if (!account) {
          return item;
        }

        if (item.group === 'CRYPTO') {
          const quantity = await this.getQuantityOfAccount({
            userId,
            accountId: account.id
          });

          if (quantity > 0) {
            return {
              ...item,
              quantity,
              unitPrice: account.valueInBaseCurrency / quantity,
              value: account.valueInBaseCurrency
            };
          }
        }

        return { ...item, value: account.valueInBaseCurrency };
      })
    );

    // Add the accounts which are not yet part of the snapshots
    for (const { activitiesCount, name, valueInBaseCurrency } of accounts) {
      if (
        valueInBaseCurrency > 0 &&
        !suggestion.some((item) => {
          return item.name === name;
        })
      ) {
        suggestion.push({
          name,
          group: activitiesCount > 0 ? 'INVESTMENTS' : 'CASH',
          value: valueInBaseCurrency
        });
      }
    }

    return {
      suggestion,
      taxes,
      snapshots: snapshots.map((snapshot) => {
        return this.toSnapshotItem(snapshot);
      })
    };
  }

  public async upsertSnapshots({
    snapshots,
    userId
  }: {
    snapshots: CreateNetWorthSnapshotDto[];
    userId: string;
  }) {
    return this.prismaService.$transaction(
      snapshots.map(({ contribution = 0, date, items, note }) => {
        const data = {
          contribution,
          note,
          items: items.map(({ group, name, quantity, value }) => {
            return { group, name, quantity, value };
          }) as unknown as Prisma.InputJsonValue
        };

        // Snapshots are kept per calendar day (UTC midnight)
        const day = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);

        return this.prismaService.netWorthSnapshot.upsert({
          create: { ...data, userId, date: day },
          update: data,
          where: { userId_date: { userId, date: day } }
        });
      })
    );
  }

  public async upsertTax({
    amount,
    userId,
    year
  }: {
    amount: number;
    userId: string;
    year: number;
  }) {
    return this.prismaService.netWorthTax.upsert({
      create: { amount, userId, year },
      update: { amount },
      where: { userId_year: { userId, year } }
    });
  }

  private async getQuantityOfAccount({
    accountId,
    userId
  }: {
    accountId: string;
    userId: string;
  }) {
    const activities = await this.prismaService.order.findMany({
      select: { quantity: true, type: true },
      where: {
        accountId,
        userId,
        type: { in: ['BUY', 'SELL'] }
      }
    });

    return activities.reduce((sum, { quantity, type }) => {
      return type === 'SELL' ? sum - quantity : sum + quantity;
    }, 0);
  }

  private toSnapshotItem({
    contribution,
    date,
    id,
    items,
    note
  }: NetWorthSnapshot): NetWorthSnapshotItem {
    return {
      contribution,
      id,
      date: date.toISOString(),
      items: (items as unknown as NetWorthItem[]) ?? [],
      note: note ?? undefined
    };
  }
}
