import { UserService } from '@ghostfolio/client/services/user/user.service';
import {
  getChartBorderColor,
  getChartElementsOptions,
  getTimeAxisOptions,
  getValueAxisOptions,
  getVerticalHoverLinePlugin,
  getZeroLineAnnotation,
  transformTickToAbbreviation
} from '@ghostfolio/common/chart-helper';
import { primaryColorRgb } from '@ghostfolio/common/config';
import { getLocale, getTextColor } from '@ghostfolio/common/helper';
import {
  NetWorthGroup,
  NetWorthItem,
  NetWorthSnapshotItem,
  User
} from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { hasScope, scopes } from '@ghostfolio/common/scopes';
import { ColorScheme } from '@ghostfolio/common/types';
import {
  getTimeSeriesTooltipOptions,
  onPrefersColorSchemeChange,
  registerChartConfiguration
} from '@ghostfolio/ui/chart';
import { DataService } from '@ghostfolio/ui/services';
import { GfValueComponent } from '@ghostfolio/ui/value';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  OnDestroy,
  OnInit,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format } from 'date-fns';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import OpenColor from 'open-color';

const { blue, grape, green, orange, red, teal } = OpenColor;

interface DraftItem {
  group: NetWorthGroup;
  name: string;
  previousValue: number;

  /**
   * Units like bitcoins, in which case the value is quantity × unit price
   */
  unit?: string;
  unitPrice?: number;
  value: number | null;
}

interface NetWorthRow {
  byGroup: Record<NetWorthGroup, number>;
  change?: number;
  contribution: number;
  contributionCumulative: number;
  date: Date;
  investments: number;
  marketGain?: number;
  netWorth: number;
  netWorthExcludingCrypto: number;
  otherChange?: number;
  snapshot: NetWorthSnapshotItem;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    GfValueComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    NgxSkeletonLoaderModule
  ],
  selector: 'gf-net-worth-page',
  styleUrls: ['./net-worth-page.scss'],
  templateUrl: './net-worth-page.html'
})
export class GfNetWorthPageComponent implements OnDestroy, OnInit {
  protected readonly groups: { color: string; id: NetWorthGroup; label: string }[] =
    [
      { color: blue[5], id: 'CASH', label: $localize`Cash` },
      { color: teal[5], id: 'INVESTMENTS', label: $localize`Investments` },
      { color: grape[5], id: 'PENSION', label: $localize`Pension` },
      { color: orange[5], id: 'CRYPTO', label: $localize`Crypto` },
      { color: red[5], id: 'LIABILITY', label: $localize`Tax` }
    ];

  protected draft: {
    contribution: number | null;
    date: string;
    items: DraftItem[];
    note: string;
  };
  protected hasPermissionToShowValues = false;
  protected hasPermissionToUpdate = false;
  protected isEditorOpen = false;
  protected isLoading = true;
  protected kpis?: {
    changeMonth: number;
    changeYearToDate: number;
    contributionYearToDate: number;
    liabilities: number;
    marketGainYearToDate: number;
    netWorth: number;
    netWorthExcludingCrypto: number;
  };
  protected rows: NetWorthRow[] = [];
  protected user: User;

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly charts: Chart<'bar' | 'line'>[] = [];
  private readonly compositionCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('compositionCanvas');
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly investmentsCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('investmentsCanvas');
  private readonly monthlyCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('monthlyCanvas');
  private suggestion: NetWorthItem[] = [];
  private taxByYear = new Map<number, number>();
  protected taxInputs: { amount: number | null; year: number }[] = [];
  private readonly userService = inject(UserService);
  private readonly yearlyCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('yearlyCanvas');

  public constructor() {
    Chart.register(
      BarController,
      BarElement,
      CategoryScale,
      Filler,
      Legend,
      LinearScale,
      LineController,
      LineElement,
      PointElement,
      TimeScale,
      Tooltip
    );

    registerChartConfiguration();

    onPrefersColorSchemeChange(() => {
      this.renderCharts();
    });
  }

  protected get baseCurrency() {
    return this.user?.settings?.baseCurrency;
  }

  protected get colorScheme(): ColorScheme | undefined {
    return this.user?.settings?.colorScheme;
  }

  protected get locale() {
    return this.user?.settings?.locale ?? getLocale();
  }

  public ngOnInit() {
    this.userService.stateChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state?.user) {
          this.user = state.user;

          this.hasPermissionToShowValues =
            hasScope(this.user.scopes, scopes.portfolioReadValues) &&
            !this.user.settings.isRestrictedView;

          this.hasPermissionToUpdate =
            hasPermission(this.user.permissions, permissions.updateAccount) &&
            hasScope(this.user.scopes, scopes.accountUpdate);

          if (!this.isLoading) {
            this.changeDetectorRef.detectChanges();

            this.renderCharts();
          }

          this.changeDetectorRef.markForCheck();
        }
      });

    this.fetchNetWorth();
  }

  public ngOnDestroy() {
    this.destroyCharts();
  }

  protected getGroupLabel(aGroup: NetWorthGroup) {
    return this.groups.find(({ id }) => {
      return id === aGroup;
    })?.label;
  }

  protected onCancel() {
    this.isEditorOpen = false;
  }

  protected onDeleteSnapshot(aSnapshot: NetWorthSnapshotItem) {
    const confirmation = confirm(
      $localize`Do you really want to delete this month?`
    );

    if (!confirmation) {
      return;
    }

    this.dataService
      .deleteNetWorthSnapshot(aSnapshot.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.fetchNetWorth();
      });
  }

  protected onEditSnapshot(aSnapshot?: NetWorthSnapshotItem) {
    if (aSnapshot) {
      this.draft = {
        contribution: aSnapshot.contribution,
        date: aSnapshot.date.slice(0, 10),
        items: aSnapshot.items
          .filter(({ group }) => {
            return group !== 'LIABILITY';
          })
          .map((item) => {
            return this.toDraftItem(item);
          }),
        note: aSnapshot.note ?? ''
      };
    } else {
      this.draft = {
        contribution: 0,
        date: format(new Date(), 'yyyy-MM-dd'),
        items: this.suggestion.map((item) => {
          return this.toDraftItem(item);
        }),
        note: ''
      };
    }

    this.isEditorOpen = true;
  }

  // Keep the previous value unless a new one is entered
  protected onValueBlur(aItem: { previousValue: number; value: number | null }) {
    if (aItem.value === null || `${aItem.value}` === '') {
      aItem.value = aItem.previousValue;
    }
  }

  // Clear the previous value to type the new one right away
  protected onValueFocus(aItem: {
    previousValue: number;
    value: number | null;
  }) {
    if (aItem.value === aItem.previousValue) {
      aItem.value = null;
    }
  }

  protected onSave() {
    this.dataService
      .postNetWorthSnapshot({
        contribution: Number(this.draft.contribution) || 0,
        date: this.draft.date,
        items: this.draft.items.map(
          ({ group, name, previousValue, unitPrice, value }) => {
            const input =
              value === null || `${value}` === ''
                ? previousValue
                : Number(value) || 0;

            return unitPrice
              ? { group, name, quantity: input, value: input * unitPrice }
              : { group, name, value: input };
          }
        ),
        note: this.draft.note || undefined
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.isEditorOpen = false;

        this.fetchNetWorth();
      });
  }

  protected onTaxChange(aTaxInput: { amount: number | null; year: number }) {
    const amount = Number(aTaxInput.amount) || 0;

    if (amount === (this.taxByYear.get(aTaxInput.year) ?? 0)) {
      return;
    }

    this.dataService
      .putNetWorthTax({ amount, year: aTaxInput.year })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.fetchNetWorth();
      });
  }

  protected trackByIndex(index: number) {
    return index;
  }

  /**
   * Tax accrued until the given date: the amount of each previous year in full
   * and the amount of the current year prorated by month
   */
  private getTax(aDate: Date) {
    const year = aDate.getUTCFullYear();
    let tax = 0;

    for (const [taxYear, amount] of this.taxByYear) {
      if (taxYear < year) {
        tax += amount;
      } else if (taxYear === year) {
        tax += (amount * (aDate.getUTCMonth() + 1)) / 12;
      }
    }

    return tax;
  }

  private toDraftItem({ group, name, quantity, unitPrice, value }: NetWorthItem) {
    const price = unitPrice ?? (quantity ? value / quantity : undefined);

    if (group === 'CRYPTO' && quantity && price) {
      return {
        group,
        name,
        previousValue: quantity,
        unit: 'BTC',
        unitPrice: price,
        value: quantity
      };
    }

    return {
      group,
      name,
      previousValue: Math.round(value),
      value: Math.round(value)
    };
  }

  private buildRows(aSnapshots: NetWorthSnapshotItem[]) {
    let contributionCumulative = 0;
    let previous: NetWorthRow | undefined;

    this.rows = aSnapshots.map((snapshot) => {
      const byGroup: Record<NetWorthGroup, number> = {
        CASH: 0,
        CRYPTO: 0,
        INVESTMENTS: 0,
        LIABILITY: 0,
        PENSION: 0
      };

      for (const { group, value } of snapshot.items) {
        // The tax is derived from the yearly amounts
        if (group !== 'LIABILITY') {
          byGroup[group] = (byGroup[group] ?? 0) + value;
        }
      }

      byGroup.LIABILITY = this.getTax(new Date(snapshot.date));

      contributionCumulative += snapshot.contribution;

      const netWorth =
        byGroup.CASH +
        byGroup.CRYPTO +
        byGroup.INVESTMENTS +
        byGroup.PENSION -
        byGroup.LIABILITY;

      const row: NetWorthRow = {
        byGroup,
        contributionCumulative,
        netWorth,
        snapshot,
        contribution: snapshot.contribution,
        date: new Date(snapshot.date),
        investments: byGroup.INVESTMENTS,
        netWorthExcludingCrypto: netWorth - byGroup.CRYPTO
      };

      if (previous) {
        // The change excludes crypto like the "Savings" sheet of xExpenses
        row.change =
          row.netWorthExcludingCrypto - previous.netWorthExcludingCrypto;
        row.marketGain =
          row.investments - previous.investments - row.contribution;
        row.otherChange = row.change - row.marketGain;
      }

      previous = row;

      return row;
    });

    const latest = this.rows.at(-1);

    if (!latest) {
      this.kpis = undefined;
      return;
    }

    const lastYear = latest.date.getUTCFullYear();
    const endOfLastYear = [...this.rows].reverse().find(({ date }) => {
      return date.getUTCFullYear() < lastYear;
    });
    const rowsOfYear = this.rows.filter(({ date }) => {
      return date.getUTCFullYear() === lastYear;
    });

    this.kpis = {
      changeMonth: latest.change ?? 0,
      changeYearToDate: endOfLastYear
        ? latest.netWorthExcludingCrypto - endOfLastYear.netWorthExcludingCrypto
        : 0,
      contributionYearToDate: rowsOfYear.reduce((sum, { contribution }) => {
        return sum + contribution;
      }, 0),
      liabilities: latest.byGroup.LIABILITY,
      marketGainYearToDate: rowsOfYear.reduce((sum, { marketGain }) => {
        return sum + (marketGain ?? 0);
      }, 0),
      netWorth: latest.netWorth,
      netWorthExcludingCrypto: latest.netWorthExcludingCrypto
    };
  }

  private createChart(
    aCanvas: ElementRef<HTMLCanvasElement> | undefined,
    aConfiguration: ChartConfiguration<'bar' | 'line'>
  ) {
    if (aCanvas) {
      this.charts.push(
        new Chart<'bar' | 'line'>(aCanvas.nativeElement, {
          ...aConfiguration,
          plugins: [getVerticalHoverLinePlugin(aCanvas, this.colorScheme)]
        })
      );
    }
  }

  private destroyCharts() {
    for (const chart of this.charts) {
      chart.destroy();
    }

    this.charts.length = 0;
  }

  private fetchNetWorth() {
    this.isLoading = true;

    this.dataService
      .fetchNetWorth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ snapshots, suggestion, taxes }) => {
        this.suggestion = suggestion;
        this.taxByYear = new Map(
          taxes.map(({ amount, year }) => {
            return [year, amount];
          })
        );

        const years = new Set([
          new Date().getFullYear(),
          ...snapshots.map(({ date }) => {
            return new Date(date).getUTCFullYear();
          })
        ]);

        this.taxInputs = [...years]
          .sort((a, b) => {
            return b - a;
          })
          .map((year) => {
            return { year, amount: this.taxByYear.get(year) ?? null };
          });

        this.buildRows(snapshots);

        this.isLoading = false;

        this.changeDetectorRef.detectChanges();

        this.renderCharts();
      });
  }

  private getTimeSeriesOptions({
    isStacked = false,
    showLegend = true
  }: {
    isStacked?: boolean;
    showLegend?: boolean;
  } = {}): ChartConfiguration<'bar' | 'line'>['options'] {
    return {
      animation: false,
      elements: getChartElementsOptions(this.colorScheme),
      interaction: { intersect: false, mode: 'index' },
      maintainAspectRatio: false,
      plugins: {
        annotation: {
          annotations: {
            yAxis: getZeroLineAnnotation(this.colorScheme)
          }
        },
        legend: {
          display: showLegend,
          labels: {
            boxHeight: 8,
            boxWidth: 8,
            color: `rgb(${getTextColor(this.colorScheme)})`,
            usePointStyle: true
          },
          position: 'bottom'
        },
        tooltip: getTimeSeriesTooltipOptions<'bar' | 'line'>({
          colorScheme: this.colorScheme,
          currency: this.baseCurrency,
          groupBy: 'month',
          locale: this.locale
        }),
        verticalHoverLine: {
          color: getChartBorderColor(this.colorScheme)
        }
      },
      responsive: true,
      scales: {
        x: {
          ...getTimeAxisOptions({
            colorScheme: this.colorScheme,
            locale: this.locale
          }),
          stacked: isStacked
        },
        y: {
          ...getValueAxisOptions({
            colorScheme: this.colorScheme,
            tickCallback: (tickValue) => {
              return transformTickToAbbreviation(Number(tickValue));
            }
          }),
          stacked: isStacked
        }
      }
    } as ChartConfiguration<'bar' | 'line'>['options'];
  }

  private renderCharts() {
    this.destroyCharts();

    if (this.rows.length === 0 || !this.hasPermissionToShowValues) {
      return;
    }

    const x = (row: NetWorthRow) => {
      return row.date.getTime();
    };

    // 1. Net worth by component
    this.createChart(this.compositionCanvas(), {
      data: {
        datasets: [
          ...this.groups.map(({ color, id, label }, index) => {
            const isLiability = id === 'LIABILITY';

            return {
              label,
              backgroundColor: `${color}99`,
              borderColor: color,
              borderWidth: 1,
              data: this.rows.map((row) => {
                return {
                  x: x(row),
                  y: isLiability ? -row.byGroup[id] : row.byGroup[id]
                };
              }),
              // Stack the assets on top of each other, the liabilities below zero
              fill: index === 0 || isLiability ? 'origin' : '-1',
              pointRadius: 0,
              stack: isLiability ? 'liabilities' : 'assets',
              type: 'line' as const
            };
          }),
          {
            borderColor: `rgb(${getTextColor(this.colorScheme)})`,
            borderDash: [4, 2],
            borderWidth: 1.5,
            data: this.rows.map((row) => {
              return { x: x(row), y: row.netWorth };
            }),
            fill: false,
            label: $localize`Net Worth`,
            pointRadius: 0,
            stack: 'total',
            type: 'line' as const
          }
        ]
      },
      options: this.getTimeSeriesOptions({ isStacked: true }),
      type: 'line'
    });

    // 2. Contributions vs. value of the investments
    const firstInvestmentIndex = this.rows.findIndex(
      ({ contributionCumulative, investments }) => {
        return contributionCumulative > 0 || investments > 0;
      }
    );
    const investmentRows =
      firstInvestmentIndex >= 0
        ? this.rows.slice(Math.max(firstInvestmentIndex - 1, 0))
        : [];

    this.createChart(this.investmentsCanvas(), {
      data: {
        datasets: [
          {
            backgroundColor: `${green[5]}33`,
            borderColor: `rgb(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b})`,
            borderWidth: 2,
            data: investmentRows.map((row) => {
              return { x: x(row), y: row.investments };
            }),
            fill: { below: `${red[5]}33`, target: 1, above: `${green[5]}33` },
            label: $localize`Value`,
            pointRadius: 0
          },
          {
            borderColor: blue[5],
            borderWidth: 1.5,
            data: investmentRows.map((row) => {
              return { x: x(row), y: row.contributionCumulative };
            }),
            label: $localize`Contributed`,
            pointRadius: 0,
            stepped: true
          }
        ]
      },
      options: this.getTimeSeriesOptions(),
      type: 'line'
    });

    // 3. Monthly change split into market gain and savings
    const changeRows = this.rows.filter(({ change }) => {
      return change !== undefined;
    });

    // The records are not evenly spaced, hence derive the bar width from the
    // available space instead of the smallest gap between two records
    const barThickness = Math.max(
      Math.floor(
        ((this.monthlyCanvas()?.nativeElement.clientWidth ?? 600) * 0.8) /
          Math.max(changeRows.length, 1)
      ),
      1
    );

    this.createChart(this.monthlyCanvas(), {
      data: {
        datasets: [
          {
            backgroundColor: changeRows.map(({ marketGain }) => {
              return (marketGain ?? 0) < 0 ? red[5] : green[6];
            }),
            data: changeRows.map((row) => {
              return { x: x(row), y: row.marketGain ?? 0 };
            }),
            label: $localize`Market gain`,
            barThickness,
            stack: 'change',
            type: 'bar' as const
          },
          {
            backgroundColor: changeRows.map(({ otherChange }) => {
              return (otherChange ?? 0) < 0 ? orange[4] : blue[4];
            }),
            data: changeRows.map((row) => {
              return { x: x(row), y: row.otherChange ?? 0 };
            }),
            label: $localize`Savings and other`,
            barThickness,
            stack: 'change',
            type: 'bar' as const
          },
          {
            borderColor: `rgb(${getTextColor(this.colorScheme)})`,
            borderWidth: 1.5,
            data: changeRows.map((row, index) => {
              const window = changeRows.slice(Math.max(index - 11, 0), index + 1);

              return {
                x: x(row),
                y:
                  window.reduce((sum, { change }) => {
                    return sum + (change ?? 0);
                  }, 0) / window.length
              };
            }),
            label: $localize`12-month average`,
            pointRadius: 0,
            stack: 'average',
            type: 'line' as const
          }
        ]
      },
      options: this.getTimeSeriesOptions({ isStacked: true }),
      type: 'bar'
    });

    // 4. Net worth at the end of each year
    const yearEndRows = new Map<number, NetWorthRow>();

    for (const row of this.rows) {
      yearEndRows.set(row.date.getUTCFullYear(), row);
    }

    const years = [...yearEndRows.keys()];

    this.createChart(this.yearlyCanvas(), {
      data: {
        datasets: [
          {
            backgroundColor: `rgb(${primaryColorRgb.r}, ${primaryColorRgb.g}, ${primaryColorRgb.b})`,
            data: years.map((year) => {
              return yearEndRows.get(year)!.netWorth;
            }),
            label: $localize`Net Worth`
          },
          {
            backgroundColor: years.map((year) => {
              const previousRow = yearEndRows.get(year - 1);

              return previousRow &&
                yearEndRows.get(year)!.netWorth < previousRow.netWorth
                ? red[5]
                : teal[3];
            }),
            data: years.map((year) => {
              const previousRow = yearEndRows.get(year - 1);

              return previousRow
                ? yearEndRows.get(year)!.netWorth - previousRow.netWorth
                : 0;
            }),
            label: $localize`Change vs. previous year`
          }
        ],
        labels: years.map((year) => {
          return year === new Date().getFullYear() ? `${year} YTD` : `${year}`;
        })
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          annotation: {
            annotations: {
              yAxis: getZeroLineAnnotation(this.colorScheme)
            }
          },
          legend: {
            labels: {
              boxHeight: 8,
              boxWidth: 8,
              color: `rgb(${getTextColor(this.colorScheme)})`,
              usePointStyle: true
            },
            position: 'bottom'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${Number(
                  context.parsed.y
                ).toLocaleString(this.locale, {
                  maximumFractionDigits: 0
                })} ${this.baseCurrency}`;
              }
            }
          }
        },
        responsive: true,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: `rgb(${getTextColor(this.colorScheme)})` }
          },
          y: getValueAxisOptions({
            colorScheme: this.colorScheme,
            tickCallback: (tickValue) => {
              return transformTickToAbbreviation(Number(tickValue));
            }
          })
        }
      } as ChartConfiguration<'bar' | 'line'>['options'],
      type: 'bar'
    });
  }
}
