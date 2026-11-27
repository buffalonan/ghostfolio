#!/bin/sh
# Comprueba que una copia de los datos de Ghostfolio se puede restaurar:
#
#   fork/backup/check-backup.sh ghostfolio-AAAA-MM-DD.tar.gz   (o directamente un ghostfolio.dump)
#
# Restaura el volcado en una base de datos TEMPORAL (gf_restore_check) del mismo Postgres y comprueba que
# tiene usuario, cuentas, actividades y los datos de Net Worth. Nunca toca la base de datos real: solo crea,
# lee y borra gf_restore_check. Sale con 1 si algo falla.
#
# Por defecto usa el contenedor gf-postgres (Docker en el Mac). Para otro Postgres (CI, pruebas):
#   GF_PG_EXEC=""  GF_PG_USER=postgres  PGHOST=...  fork/backup/check-backup.sh copia.tar.gz
set -u
CHECK_DB=gf_restore_check
EXEC="${GF_PG_EXEC-docker exec -i gf-postgres}"
MIN_ACTIVITIES="${GF_MIN_ACTIVITIES:-1}"

fail() { echo "ERROR: $*"; echo "FALLO"; exit 1; }
pg() { $EXEC "$@"; }

[ $# -eq 1 ] || { echo "uso: $0 ghostfolio-AAAA-MM-DD.tar.gz | ghostfolio.dump"; exit 64; }
[ -s "$1" ] || fail "$1 no existe o está vacío"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
case "$1" in
  *.tar.gz | *.tgz)
    tar -xzf "$1" -C "$work" 2> /dev/null || fail "no se puede descomprimir $1"
    dump=$(find "$work" -name ghostfolio.dump ! -name '._*' | head -1)
    [ -n "$dump" ] || fail "la copia no tiene ghostfolio.dump"
    files=$(find "$work" -path '*/ficheros/*' -type f ! -name '._*' | wc -l | tr -d ' ')
    echo "ficheros de origen: $files"
    ;;
  *) dump="$1" ;;
esac
[ -s "$dump" ] || fail "ghostfolio.dump está vacío"

user="${GF_PG_USER:-$(pg printenv POSTGRES_USER 2> /dev/null)}"
[ -n "$user" ] || fail "no se encuentra Postgres (¿está arrancado gf-postgres?)"

pg dropdb -U "$user" --if-exists "$CHECK_DB" > /dev/null 2>&1
pg createdb -U "$user" "$CHECK_DB" || fail "no se puede crear la base de datos temporal"
cleanup() { pg dropdb -U "$user" --if-exists "$CHECK_DB" > /dev/null 2>&1; rm -rf "$work"; }
trap cleanup EXIT

if ! pg pg_restore -U "$user" -d "$CHECK_DB" --no-owner --no-privileges --exit-on-error < "$dump" 2> "$work/restore.log"; then
  tail -3 "$work/restore.log"
  fail "pg_restore no pudo restaurar el volcado"
fi

count() { pg psql -U "$user" -d "$CHECK_DB" -Atc "SELECT count(*) FROM \"$1\"" 2> /dev/null; }
problems=0
for table in User Account Order NetWorthSnapshot NetWorthTax; do
  n=$(count "$table")
  if [ -z "$n" ]; then
    echo "ERROR: falta la tabla $table"; problems=$((problems + 1))
  else
    echo "$table: $n"
  fi
done
[ "$(count User)" -ge 1 ] 2> /dev/null || { echo "ERROR: no hay ningún usuario"; problems=$((problems + 1)); }
[ "$(count Account)" -ge 1 ] 2> /dev/null || { echo "ERROR: no hay ninguna cuenta"; problems=$((problems + 1)); }
[ "$(count Order)" -ge "$MIN_ACTIVITIES" ] 2> /dev/null || { echo "ERROR: menos de $MIN_ACTIVITIES actividades"; problems=$((problems + 1)); }
last=$(pg psql -U "$user" -d "$CHECK_DB" -Atc 'SELECT max(date)::date FROM "Order"' 2> /dev/null)
[ -n "$last" ] && echo "última actividad: $last"

[ "$problems" -eq 0 ] || { echo "FALLO: $problems problemas"; exit 1; }
echo "OK: la copia se puede restaurar"
