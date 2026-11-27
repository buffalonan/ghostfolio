#!/bin/sh
# Tests de check-backup.sh contra un Postgres de pruebas.
#  - Como en el Mac (y en CI, workflow fork-backup-check.yml): un contenedor Postgres 15 y
#      GF_PG_EXEC="docker exec -i -e PGUSER=<usuario> <contenedor>" fork/backup/test-check-backup.sh
#  - Con un Postgres local: GF_PG_EXEC="" GF_PG_USER=postgres PGHOST=... fork/backup/test-check-backup.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
export GF_PG_EXEC="${GF_PG_EXEC-}"
# Todas las herramientas de Postgres pasan por el mismo sitio que usa check-backup.sh (versión 15 en el contenedor)
pgx() { $GF_PG_EXEC "$@"; }
work=$(mktemp -d)
trap 'rm -rf "$work"; pgx dropdb --if-exists gf_fixture > /dev/null 2>&1' EXIT
failures=0

expect() { # expect <código> <texto> -- comando…
  code=$1 text=$2; shift 3
  out=$("$@" 2>&1); got=$?
  if [ "$got" -ne "$code" ] || ! printf '%s' "$out" | grep -q -- "$text"; then
    echo "FAIL: $* (código $got, esperaba $code y \"$text\")"; printf '%s\n' "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  else
    echo "ok: $text"
  fi
}

# Una base de datos con la forma de la de Ghostfolio (solo las tablas que mira la comprobación)
fixture() { # fixture <actividades>
  pgx dropdb --if-exists gf_fixture > /dev/null 2>&1; pgx createdb gf_fixture
  pgx psql -q -d gf_fixture -c 'CREATE TABLE "User" (id text); CREATE TABLE "Account" (id text);
    CREATE TABLE "Order" (id text, date timestamp); CREATE TABLE "NetWorthSnapshot" (id text); CREATE TABLE "NetWorthTax" (id text);
    INSERT INTO "User" VALUES ($$u$$); INSERT INTO "Account" VALUES ($$a$$); INSERT INTO "NetWorthTax" VALUES ($$t$$);'
  i=0; while [ "$i" -lt "$1" ]; do pgx psql -q -d gf_fixture -c "INSERT INTO \"Order\" VALUES ('o$i', '2026-11-0$((i + 1))')"; i=$((i + 1)); done
}
archive() { # archive <nombre> : tar.gz como el de gf-backup
  mkdir -p "$work/$1/ghostfolio-2026-11-29/ficheros"
  pgx pg_dump -Fc -d gf_fixture > "$work/$1/ghostfolio-2026-11-29/ghostfolio.dump"
  echo x > "$work/$1/ghostfolio-2026-11-29/ficheros/xExpenses.xlsx"
  tar -czf "$work/$1.tar.gz" -C "$work/$1" ghostfolio-2026-11-29
  echo "$work/$1.tar.gz"
}

fixture 2
good=$(archive buena)
expect 0 "OK: la copia se puede restaurar" -- "$here/check-backup.sh" "$good"
expect 0 "Order: 2" -- "$here/check-backup.sh" "$good"
expect 0 "última actividad: 2026-11-02" -- "$here/check-backup.sh" "$good"
expect 0 "ficheros de origen: 1" -- "$here/check-backup.sh" "$good"
expect 0 "OK" -- "$here/check-backup.sh" "$work/buena/ghostfolio-2026-11-29/ghostfolio.dump"
expect 1 "menos de 5 actividades" -- env GF_MIN_ACTIVITIES=5 "$here/check-backup.sh" "$good"

# La base de datos temporal se borra y la de origen no se toca
[ -z "$(pgx psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'gf_restore_check'")" ] \
  && echo "ok: gf_restore_check borrada" || { echo "FAIL: gf_restore_check sigue ahí"; failures=$((failures + 1)); }
[ "$(pgx psql -d gf_fixture -Atc 'SELECT count(*) FROM "Order"')" = 2 ] \
  && echo "ok: la base de datos original sigue igual" || { echo "FAIL: la original cambió"; failures=$((failures + 1)); }

fixture 0
expect 1 "menos de 1 actividades" -- "$here/check-backup.sh" "$(archive sin-actividades)"

pgx psql -q -d gf_fixture -c 'DROP TABLE "NetWorthSnapshot"'
expect 1 "falta la tabla NetWorthSnapshot" -- "$here/check-backup.sh" "$(archive sin-tabla)"

: > "$work/vacio.tar.gz"
expect 1 "no existe o está vacío" -- "$here/check-backup.sh" "$work/vacio.tar.gz"
echo "no es un tar" > "$work/roto.tar.gz"
expect 1 "no se puede descomprimir" -- "$here/check-backup.sh" "$work/roto.tar.gz"
mkdir -p "$work/sin-dump/x" && echo y > "$work/sin-dump/x/otra.txt" && tar -czf "$work/sin-dump.tar.gz" -C "$work/sin-dump" x
expect 1 "no tiene ghostfolio.dump" -- "$here/check-backup.sh" "$work/sin-dump.tar.gz"
echo "basura" > "$work/basura.dump"
expect 1 "pg_restore no pudo restaurar" -- "$here/check-backup.sh" "$work/basura.dump"

[ "$failures" -eq 0 ] && echo "Todos los tests pasan" || { echo "$failures tests fallan"; exit 1; }
