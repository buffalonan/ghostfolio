import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { GfNetWorthPageComponent } from './net-worth-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    component: GfNetWorthPageComponent,
    path: '',
    title: internalRoutes.netWorth.title
  }
];
