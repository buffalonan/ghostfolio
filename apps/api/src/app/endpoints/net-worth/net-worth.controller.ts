import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import {
  CreateNetWorthSnapshotDto,
  ImportNetWorthSnapshotsDto,
  UpdateNetWorthTaxDto
} from '@ghostfolio/common/dtos';
import { NetWorthResponse } from '@ghostfolio/common/interfaces';
import { isRestrictedView, permissions } from '@ghostfolio/common/permissions';
import { hasScope, scopes } from '@ghostfolio/common/scopes';
import type {
  ImpersonationContext,
  RequestWithUser
} from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { NetWorthService } from './net-worth.service';

@Controller('net-worth')
export class NetWorthController {
  public constructor(
    private readonly netWorthService: NetWorthService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Delete(':id')
  @HasPermission(permissions.updateAccount)
  @RequiresScope(scopes.accountUpdate)
  public async deleteSnapshot(
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    const isDeleted = await this.netWorthService.deleteSnapshot({
      id,
      userId
    });

    if (!isDeleted) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.NOT_FOUND),
        StatusCodes.NOT_FOUND
      );
    }
  }

  @Get()
  @RequiresScope(scopes.accountRead, scopes.portfolioReadValues)
  public async getNetWorth(
    @Impersonation() impersonation: ImpersonationContext
  ): Promise<NetWorthResponse> {
    return this.netWorthService.getNetWorth({
      userId: impersonation.userId,
      withValues:
        hasScope(impersonation.scopes, scopes.portfolioReadValues) &&
        !isRestrictedView(this.request.user)
    });
  }

  @HasPermission(permissions.updateAccount)
  @Post('import')
  @RequiresScope(scopes.accountUpdate)
  public async importSnapshots(
    @Body() { snapshots }: ImportNetWorthSnapshotsDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    await this.netWorthService.upsertSnapshots({ snapshots, userId });

    return { count: snapshots.length };
  }

  @HasPermission(permissions.updateAccount)
  @Put('tax')
  @RequiresScope(scopes.accountUpdate)
  public async updateTax(
    @Body() { amount, paidOn, year }: UpdateNetWorthTaxDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    return this.netWorthService.upsertTax({ amount, paidOn, userId, year });
  }

  @HasPermission(permissions.updateAccount)
  @Put(':id')
  @RequiresScope(scopes.accountUpdate)
  public async updateSnapshot(
    @Body() data: CreateNetWorthSnapshotDto,
    @Impersonation() { userId }: ImpersonationContext,
    @Param('id') id: string
  ) {
    const snapshot = await this.netWorthService.updateSnapshot({
      id,
      userId,
      snapshot: data
    });

    if (!snapshot) {
      throw new HttpException(
        getReasonPhrase(StatusCodes.NOT_FOUND),
        StatusCodes.NOT_FOUND
      );
    }

    return snapshot;
  }

  @HasPermission(permissions.updateAccount)
  @Post()
  @RequiresScope(scopes.accountUpdate)
  public async upsertSnapshot(
    @Body() data: CreateNetWorthSnapshotDto,
    @Impersonation() { userId }: ImpersonationContext
  ) {
    const [snapshot] = await this.netWorthService.upsertSnapshots({
      userId,
      snapshots: [data]
    });

    return snapshot;
  }
}
