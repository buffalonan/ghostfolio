import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { CreateNetWorthSnapshotDto } from '@ghostfolio/common/dtos';
import {
  NetWorthItem,
  NetWorthResponse,
  NetWorthSnapshotItem
} from '@ghostfolio/common/interfaces';

import { HttpException, Injectable } from '@nestjs/common';
import { NetWorthSnapshot, Prisma } from '@prisma/client';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

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

  /**
   * Gives the snapshots, the suggestion for the next month and the taxes. The
   * monetary values are redacted (null) unless the user may see them, like
   * the RedactValuesInResponseInterceptor does for the accounts
   */
  public async getNetWorth({
    userId,
    withValues
  }: {
    userId: string;
    withValues: boolean;
  }): Promise<NetWorthResponse> {
    const [snapshots, taxes, { accounts }] = await Promise.all([
      this.prismaService.netWorthSnapshot.findMany({
        orderBy: { date: 'asc' },
        where: { userId }
      }),
      this.prismaService.netWorthTax.findMany({
        orderBy: { year: 'desc' },
        select: { amount: true, paidOn: true, year: true },
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

    const response: NetWorthResponse = {
      suggestion,
      taxes: taxes.map(({ amount, paidOn, year }) => {
        return {
          amount,
          year,
          paidOn: paidOn ? paidOn.toISOString().slice(0, 7) : undefined
        };
      }),
      snapshots: snapshots.map((snapshot) => {
        return this.toSnapshotItem(snapshot);
      })
    };

    return withValues ? response : this.redactValues(response);
  }

  /**
   * Updates the snapshot, including its date. Moving it to a day which
   * already has another snapshot is a conflict, as there is one per day
   */
  public async updateSnapshot({
    id,
    snapshot,
    userId
  }: {
    id: string;
    snapshot: CreateNetWorthSnapshotDto;
    userId: string;
  }) {
    const existing = await this.prismaService.netWorthSnapshot.findFirst({
      select: { id: true },
      where: { id, userId }
    });

    if (!existing) {
      return null;
    }

    const { data, day } = this.toData(snapshot);

    try {
      return await this.prismaService.netWorthSnapshot.update({
        data: { ...data, date: day },
        where: { id }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          getReasonPhrase(StatusCodes.CONFLICT),
          StatusCodes.CONFLICT
        );
      }

      throw error;
    }
  }

  public async upsertSnapshots({
    snapshots,
    userId
  }: {
    snapshots: CreateNetWorthSnapshotDto[];
    userId: string;
  }) {
    return this.prismaService.$transaction(
      snapshots.map((snapshot) => {
        const { data, day } = this.toData(snapshot);

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
    paidOn,
    userId,
    year
  }: {
    amount: number;
    paidOn?: string | null;
    userId: string;
    year: number;
  }) {
    // The month of the payment is kept as its first day (UTC midnight)
    const paidOnDate = paidOn ? new Date(`${paidOn}-01T00:00:00.000Z`) : null;

    return this.prismaService.netWorthTax.upsert({
      create: { amount, userId, year, paidOn: paidOnDate },
      update: { amount, paidOn: paidOnDate },
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

  private redactValues({
    snapshots,
    suggestion,
    taxes
  }: NetWorthResponse): NetWorthResponse {
    const redactItem = (item: NetWorthItem): NetWorthItem => {
      return {
        ...item,
        quantity: item.quantity === undefined ? undefined : null,
        unitPrice: item.unitPrice === undefined ? undefined : null,
        value: null
      };
    };

    return {
      snapshots: snapshots.map((snapshot) => {
        return {
          ...snapshot,
          contribution: null,
          items: snapshot.items.map(redactItem)
        };
      }),
      suggestion: suggestion.map(redactItem),
      taxes: taxes.map((tax) => {
        return { ...tax, amount: null };
      })
    };
  }

  private toData({
    contribution = 0,
    date,
    items,
    note
  }: CreateNetWorthSnapshotDto) {
    return {
      data: {
        contribution,
        note: note ?? null,
        items: items.map(({ group, name, quantity, value }) => {
          return { group, name, quantity, value };
        }) as unknown as Prisma.InputJsonValue
      },
      // Snapshots are kept per calendar day (UTC midnight)
      day: new Date(`${date.slice(0, 10)}T00:00:00.000Z`)
    };
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
