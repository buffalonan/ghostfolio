# Ghostfolio de Ferran (fork de ghostfolio/ghostfolio)

## Qué es

Instancia personal de [Ghostfolio](https://github.com/ghostfolio/ghostfolio) para que Ferran siga sus inversiones
(DEGIRO, Interactive Brokers, cuentas bancarias, pilares de pensión suizos, bitcoin) y su patrimonio neto mensual.
Corre solo en su Mac; moneda base CHF. Este repo es un fork **público** (AGPL-3.0): aquí no van datos financieros personales.

## Dónde vive

- **Repo:** `buffalonan/ghostfolio`, rama `main`. Upstream: `ghostfolio/ghostfolio` `main`.
- **Mac (MacBook Air, usuario macOS `claude`):**
  - Clon: `~/Documents/ghostfolio`. Docker con Colima + Compose en `~/.local/bin` (sin Homebrew).
  - Override para usar la imagen del fork: `~/Documents/ghostfolio-local/docker-compose.fork.yml` (`image: ghostfolio-fork:local`).
  - Contenedores: `ghostfolio` (puerto 3333), `gf-postgres`, `gf-redis` (`docker/docker-compose.yml`, red `ghostfolio_default`).
  - Proxy nginx `gf-proxy` en el puerto 80: `~/Documents/ghostfolio-local/proxy/` (`docker-compose.yml`, `nginx.conf`, con copias `.bak-*`).
    Rutas: `/` página de enlaces, `/portfolio` → Ghostfolio, `/recetas/` → app de recetas (puerto 8080 del Mac),
    `/fitness/` → Flex & Fit (puerto 3334), `/ha` → redirige a Home Assistant (8123). Ghostfolio ocupa el resto de rutas (`location /`).
  - Scripts de importación (Python, `.venv`): `~/Documents/ghostfolio-import/` (`convert.py` DEGIRO→JSON, `xexpenses_net_worth.py`).
- **URLs:** `http://localhost:3333` en el Mac; en casa `http://<IP fija del Mac>/portfolio`; fuera de casa por Tailscale
  (`http://<IP Tailscale del Mac>:3333`). Las IPs están en la memoria del proyecto de Claude, no aquí.
- **Tareas programadas (LaunchAgents en `~/Library/LaunchAgents`):**
  - `com.ferran.ghostfolio`: al iniciar sesión ejecuta `~/.local/bin/gf-autostart` (arranca Colima, Ghostfolio y el proxy).
    Log: `~/Library/Logs/gf-autostart.log`.
  - `com.ferran.gf-backup`: domingos 21:00 ejecuta `~/.local/bin/gf-backup`. Si el Mac está apagado, se salta.
    Log: `~/Library/Logs/gf-backup.log`.
- **Backups (solo datos):** `gf-backup` hace `pg_dump` + hojas xExpenses/Expenses/pExpenses + CSVs de brokers en un
  `.tar.gz` en `~/Documents/ghostfolio-backups/weekly/` y lo sube con rclone (remote `gdrive`) a Google Drive `Backups/Ghostfolio`.
  Dumps sueltos previos a cambios en `~/Documents/ghostfolio-backups/*.dump`.
- **Datos personales:** en la base de datos de Ghostfolio (Postgres en Docker), las hojas en `~/Downloads` (xExpenses es el
  checkpoint mensual) y la memoria del proyecto de Claude. Credenciales: `.env` del clon (no versionado, contiene las claves
  de Postgres/Redis/JWT) y la config de rclone del Mac.

## Cómo funciona

**Desarrollo:** sigue las convenciones de upstream: `DEVELOPMENT.md` y las skills en `.agents/skills/` y `.claude/skills/`
(Angular, NestJS, karpathy-guidelines). Stack: Angular + NestJS + Prisma + Nx + TypeScript.

- Mantén el código del fork en sus carpetas y toca archivos de upstream solo para registrarlo; así sincronizar con upstream es fácil.
- Tablas nuevas: migración en `prisma/migrations/` y `npx prisma format` tras editar el esquema.
- Antes de subir: `npm run lint`, `npm run format:check`, `npm test` (como `.github/workflows/build-code.yml`).
  GitHub Actions ejecuta ese workflow en cada PR (incluye `format:check` también para `.md`).
- Sincronizar con upstream: merge de `ghostfolio/ghostfolio` `main` en `main` del fork; los conflictos suelen estar en los archivos "gancho" de abajo.
- Nunca subas cifras, nombres de cuentas ni datos personales en código, tests o fixtures.

**Lo que añade el fork: página Net Worth (`/net-worth`)**, instantáneas mensuales del patrimonio completo (incluido lo que
Ghostfolio no sigue: efectivo fuera, pensiones, cripto en unidades) con el impuesto anual como pasivo.

| Ruta                                                                    | Qué es                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/app/endpoints/net-worth/`                                 | `NetWorthModule`: `GET`, `POST`, `POST /import` en `/api/v1/net-worth`, más `PUT /:id`, `PUT /tax`, `DELETE /:id`. `GET` pone a `null` las cifras en la vista restringida o sin permiso de ver valores. Usa `@RequiresScope` + `@Impersonation()` como las cuentas de upstream. |
| `prisma/schema.prisma`, `prisma/migrations/20261028*_added_net_worth_*` | `NetWorthSnapshot` (una por usuario y día UTC, `items` en JSON) y `NetWorthTax` (una por usuario y año).                                                                                                                                                                        |
| `libs/common/src/lib/dtos/create-net-worth-snapshot.dto.ts`             | Validación de instantáneas, items, impuesto e importación.                                                                                                                                                                                                                      |
| `libs/common/src/lib/interfaces/net-worth-*.ts`                         | `NetWorthItem` (grupos `CASH`, `CRYPTO`, `INVESTMENTS`, `LIABILITY`, `PENSION`) y `NetWorthResponse`.                                                                                                                                                                           |
| `apps/client/src/app/pages/net-worth/`                                  | La página: KPIs, gráficos, tabla mensual, editor e impuestos.                                                                                                                                                                                                                   |
| Ganchos en upstream                                                     | `app.module.ts`, snapshot de rutas `apps/api/src/app/__snapshots__/app.module.spec.ts.snap` (toda ruta nueva va ahí), `app.routes.ts`, `routes.ts`, menú del header, `data.service.ts`, índices de `dtos` e `interfaces`.                                                       |

- Los items de una instantánea son nombres libres y valores en moneda base. `GET` devuelve una `suggestion` para el mes
  siguiente: los items del último mes, actualizados con las cuentas de Ghostfolio **del mismo nombre** (renombrar una cuenta rompe el vínculo).
- `CRYPTO` se introduce en unidades (BTC); valor = unidades × precio actual de la cuenta.
- `LIABILITY` (impuesto) no se guarda desde el editor: se deriva de `NetWorthTax` con `getTaxOwed`
  (`pages/net-worth/net-worth-tax.ts`): el importe del año se acumula 1/12 cada mes, se debe entero hasta `paidOn`
  (mes de pago, campo «Paid in» de la página) y deja de contar desde ese mes; los meses anteriores no cambian.
- Tests de Net Worth: `net-worth.service.spec.ts` (editar, redacción, impuesto), `net-worth-suggestion.spec.ts`
  (sugerencia: cuentas por nombre, cripto en unidades, importación) y `pages/net-worth/net-worth-tax.spec.ts` (`getTaxOwed`).
  La página (componente Angular) no tiene tests.
- El cambio mensual excluye cripto (como la hoja "Savings" de xExpenses). VIAC (3a) y ComPlan (2º pilar) son líneas separadas pero se suman como "Pension".

**Desplegar un cambio en el Mac:** construir la imagen `ghostfolio-fork:local` desde el clon con el `Dockerfile` (tarda 5-10 min)
y recrear el contenedor `ghostfolio` con `docker/docker-compose.yml` + el override del fork. Hacer antes un `pg_dump`.
Tras cambiar actividades por base de datos, limpiar la caché (Redis) para que se recalculen.

**Importar datos:** DEGIRO: CSV de Transactions + Account statement. IBKR: Activity Statement CSV. Las compras de VWRA de
DEGIRO están bajo la cuenta "Interactive Brokers" (se traspasó el 2026-09-01). Saldos manuales (bancos, pilares) se actualizan a mano.

**Límites para agentes:**

- Las sesiones de Claude en el Mac no tienen credenciales de GitHub: los cambios se suben desde la nube (p. ej. con `git bundle` en `~/Documents`).
- No pueden usar `sudo` ni crear LaunchAgents: dale a Ferran un bloque para Terminal.
- No cambiar datos de Ghostfolio sin el OK de Ferran. Ferran permite usar la app vía navegador.
- Recetas, Flex & Fit y Home Assistant son otros proyectos; aquí solo importa que comparten el proxy del puerto 80.

## Estado actual (2026-11-27)

- Funciona: Ghostfolio con la imagen del fork, arranque automático, proxy en el 80, acceso por Tailscale, backup semanal a Drive (último: 2026-11-22).
- Datos al día hasta el 2026-11-24 (compras de VT de noviembre añadidas, efectivo IBKR actualizado, DEGIRO cuadrado).
- Main incluye PR #1 (Net Worth), PR #3 (mover mes sin duplicar, redacción en API) y PR #4 (impuesto con mes de pago).
- La app de recetas (8080) no arranca sola tras reiniciar el Mac.
- rclone usa el cliente compartido de Google, que puede dejar de funcionar en 2026.
- Las sesiones de Claude no suelen poder ejecutar `npm test`/`npm run lint` en local (sin acceso a instalar paquetes); el CI de GitHub sí los ejecuta.

## Decisiones

- 2026-10-23: Ghostfolio autoalojado en el Mac con Docker vía Colima, porque no hay acceso a Homebrew ni Docker Desktop.
- 2026-10-23: modificar un fork propio en vez de usar Ghostfolio tal cual, para añadir páginas a medida.
- 2026-10-23: compras de VWRA de DEGIRO bajo la cuenta "Interactive Brokers", para mantener la historia tras el traspaso.
- 2026-10-28: patrimonio neto dentro de Ghostfolio (página Net Worth) para sustituir los gráficos de xExpenses.
- 2026-10-28: bitcoin en unidades y impuesto anual prorrateado, porque Ferran no compra más BTC y paga impuestos una vez al año.
- 2026-10-28: backup semanal solo de datos (no del código), porque el código está en GitHub.
- 2026-11-22: arranque automático con LaunchAgent, porque tras reiniciar Colima quedaba parado.
- 2026-11-24: proxy nginx en el puerto 80 con `/portfolio`, para tener una dirección fija en casa; recetas pasó al 8080. IP del Mac reservada en el router.
- 2026-11-27: un solo archivo de contexto (`AGENTS.md`); `CLAUDE.md` solo lo importa.

## Pendiente

- Tras mergear PR #4: poner el mes de pago de los años ya pagados y volver a poner el importe real en los años dejados a 0.
- Cerrar PR #2 (CLAUDE.md antiguo): su contenido está ahora en este archivo.
- Comprobar que el CI de GitHub pasa en `main` tras PR #3.
- Cuando rclone deje de funcionar con Google: crear un client ID propio en Google Cloud.
- Ferran puede poner el nombre Bonjour "portfolio" (`portfolio.local`) y renombrar el Mac a "portfolio" en Tailscale; no consta que lo haya hecho.
- Pregunta para Ferran: ¿cantidad real de BTC? Ghostfolio da 0,67 con operaciones supuestas; Ferran mencionó "0,4 o no recuerdo".
- Pregunta para Ferran: ¿la imagen desplegada en el Mac incluye ya PR #3 (y #4)? No consta un redespliegue tras el 2026-10-28.
- Pregunta para Ferran: ¿quiere que recetas arranque sola? (es de otro proyecto).
- Pregunta para Ferran: comando exacto de build/deploy de la imagen; no está escrito en ningún script versionado.

## Historial

- 2026-10: instalación local (23), importación DEGIRO desde jun-2022 e IBKR 2026, cuentas manuales y asignaciones a mano (24),
  revisión de cartera, página Net Worth y PR #1 mergeado, imagen del fork en local, backup semanal a Drive (28).
- 2026-11-22: arreglo de gf-backup y LaunchAgent de arranque automático; acceso por Tailscale verificado.
- 2026-11-24: proxy en el puerto 80 (`/portfolio`, recetas, fitness, HA); revisión de VT y alta de compras de noviembre.
- 2026-11-26: PR #2 (CLAUDE.md), PR #3 mergeado (mover mes, redacción), PR #4 abierto (impuesto con mes de pago).
- 2026-11-27: AGENTS.md como fuente única de contexto.
