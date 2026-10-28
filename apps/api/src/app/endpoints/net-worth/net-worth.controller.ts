import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { Impersonation } from '@ghostfolio/api/decorators/impersonation.decorator';
import { RequiresScope } from '@ghostfolio/api/decorators/requires-scope.decorator';
import {
  CreateNetWorthSnapshotDto,
  ImportNetWorthSnapshotsDto
} from '@ghostfolio/common/dtos';
import { NetWorthResponse } from '@ghostfolio/common/interfaces';
import { permissions } from '@ghostfolio/common/permissions';
import { scopes } from '@ghostfolio/common/scopes';
import type { ImpersonationContext } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post
} from '@nestjs/common';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { NetWorthService } from './net-worth.service';

@Controller('net-worth')
export class NetWorthController {
  public constructor(private readonly netWorthService: NetWorthService) {}

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
    @Impersonation() { userId }: ImpersonationContext
  ): Promise<NetWorthResponse> {
    return this.netWorthService.getNetWorth(userId);
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
