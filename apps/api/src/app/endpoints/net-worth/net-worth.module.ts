import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { NetWorthController } from './net-worth.controller';
import { NetWorthService } from './net-worth.service';

@Module({
  controllers: [NetWorthController],
  imports: [ImpersonationModule, PortfolioModule, PrismaModule],
  providers: [NetWorthService]
})
export class NetWorthModule {}
