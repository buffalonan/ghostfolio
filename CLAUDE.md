# CLAUDE.md

This is Ferran's fork of [Ghostfolio](https://github.com/ghostfolio/ghostfolio) (upstream: `ghostfolio/ghostfolio`, branch `main`). Almost all of the code is upstream's: follow upstream's conventions (`DEVELOPMENT.md`, the skills in `.claude/skills/` and `.agents/skills/`) and keep fork-only changes small and self-contained so syncing with upstream stays easy.

## What the fork adds

**Net worth page** (`/net-worth`, PR #1, October 2026): monthly snapshots of the whole net worth, including things Ghostfolio doesn't track (cash elsewhere, pension, crypto in units), with a yearly tax accrued month by month as a liability.

| Path | What it is |
| --- | --- |
| `apps/api/src/app/endpoints/net-worth/` | `NetWorthModule`: controller (`GET`, `POST` and `POST /import` on `/api/v1/net-worth`, plus `PUT /:id`, `PUT /tax` and `DELETE /:id`; `GET` redacts the values in the restricted view) and service. Routes use `@RequiresScope` + `@Impersonation()` like upstream's account endpoints. |
| `prisma/schema.prisma`, `prisma/migrations/20261028*_added_net_worth_*` | Tables `NetWorthSnapshot` (one per user and UTC day, `items` as JSON) and `NetWorthTax` (one per user and year). |
| `libs/common/src/lib/dtos/create-net-worth-snapshot.dto.ts` | Validation of snapshots, items, tax and import. |
| `libs/common/src/lib/interfaces/net-worth-*.ts` | `NetWorthItem` (groups `CASH`, `CRYPTO`, `INVESTMENTS`, `LIABILITY`, `PENSION`) and `NetWorthResponse`. |
| `apps/client/src/app/pages/net-worth/` | The page: KPIs, charts, monthly table, editor and tax inputs. |
| Small hooks into upstream files | `app.module.ts`, the route snapshot `apps/api/src/app/__snapshots__/app.module.spec.ts.snap` (every new route must be added there), `app.routes.ts`, `routes.ts`, the header (menu link), `data.service.ts`, the `dtos` and `interfaces` index files. |

How it works:
- A snapshot's items are free-form names and values in the base currency. `GET` also returns a `suggestion` for the next month: the latest snapshot's items, refreshed from Ghostfolio accounts **with the same name**, plus accounts not yet listed. Renaming an account breaks that link.
- `CRYPTO` items are entered in units; the value is units × the account's current unit price.
- `LIABILITY` is never stored from the editor: the page derives it from `NetWorthTax` (`getTax` in the page component).
- The month's change, like the "Savings" sheet of xExpenses it replaces, excludes crypto.

## Working on the fork

- Keep new fork code under its own folders (`endpoints/net-worth`, `pages/net-worth`) and touch upstream files only to register it.
- New tables need a Prisma migration in `prisma/migrations/`; run `npx prisma format` after editing the schema.
- Before pushing: `npm run lint`, `npm run format:check`, `npm test` (the same as `.github/workflows/build-code.yml`). GitHub Actions are not enabled on this fork, so nothing runs them automatically.
- Syncing with upstream: merge `ghostfolio/ghostfolio` `main` into this fork's `main`; conflicts will usually be in the hook files listed above.
- Never commit personal financial data (amounts, account names) in code, tests or fixtures.
