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
    const [snapshots, { accounts }] = await Promise.all([
      this.prismaService.netWorthSnapshot.findMany({
        orderBy: { date: 'asc' },
        where: { userId }
      }),
      this.portfolioService.getAccountsWithAggregations({
        userId,
        withExcludedAccounts: true
      })
    ]);

    const latestItems: NetWorthItem[] =
      snapshots.length > 0
        ? this.toSnapshotItem(snapshots.at(-1)).items
        : [];

    const valueByAccountName = new Map(
      accounts.map(({ name, valueInBaseCurrency }) => {
        return [name, valueInBaseCurrency] as const;
      })
    );

    // Carry over the latest items and refresh the ones which match an account
    const suggestion: NetWorthItem[] = latestItems.map((item) => {
      return valueByAccountName.has(item.name)
        ? { ...item, value: valueByAccountName.get(item.name) }
        : item;
    });

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
          items: items.map(({ group, name, value }) => {
            return { group, name, value };
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
