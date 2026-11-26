#!/bin/sh
# Prueba las migraciones y los tests SQL en un Postgres LOCAL (nunca en la base real).
#
# Uso:
#   supabase/tests/local/probar_migraciones.sh <base_nueva> [puerto]
#   ej.: supabase/tests/local/probar_migraciones.sh durey_prueba_029 54329
#
# 1. Crea una base NUEVA con ese nombre en 127.0.0.1 (falla si ya existe; no borra nada).
# 2. Carga la simulación de Supabase (stub_supabase.sql).
# 3. Aplica supabase/migrations/002..último en orden (000 y 001 son anteriores a la línea base 002).
# 4. Corre supabase/tests/*.sql (cada test corre en una transacción que se revierte).
# 5. Si la última migración NNN tiene supabase/scripts/revertir_NNN.sql: lo ejecuta, comprueba
#    que el test de la NNN ahora FALLA (la reversión deshizo el cambio), reaplica la NNN y
#    comprueba que el test vuelve a pasar.
#
# Salida: 0 = todo en verde · 1 = algún test o la prueba de reversión falló · 2 = no se pudo montar la base.

set -u
DB=${1:?"Indica el nombre de una base nueva, ej. durey_prueba_029"}
PORT=${2:-54329}
HOST=127.0.0.1   # fijo: este script nunca apunta a otra máquina
RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
PSQL="psql -h $HOST -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

$PSQL -c "CREATE DATABASE \"$DB\"" || exit 2
$PSQL -d "$DB" -v db="$DB" -f "$RAIZ/supabase/tests/local/stub_supabase.sql" >/dev/null || exit 2

ultima=""
for f in "$RAIZ"/supabase/migrations/0*.sql; do
  case "$f" in *000_*|*001_*) continue ;; esac
  if ! salida=$($PSQL -d "$DB" -f "$f" 2>&1); then
    echo "FALLA migración $(basename "$f"): $(echo "$salida" | grep -m2 -E 'ERROR|FATAL')"
    exit 2
  fi
  ultima=$f
done
echo "Migraciones aplicadas en $DB"

fallos=0
for t in "$RAIZ"/supabase/tests/*.sql; do
  if salida=$($PSQL -d "$DB" -f "$t" 2>&1); then
    echo "PASA $(basename "$t")"
  else
    echo "FALLA $(basename "$t"): $(echo "$salida" | grep -m2 -E 'ERROR|FALLO')"
    fallos=1
  fi
done

# Prueba de la reversión de la última migración, si tiene script y test
num=$(basename "$ultima" | cut -c1-3)
revertir="$RAIZ/supabase/scripts/revertir_$num.sql"
test_ultima=$(ls "$RAIZ"/supabase/tests/"$num"_*.test.sql 2>/dev/null | head -1)
if [ -f "$revertir" ] && [ -n "$test_ultima" ]; then
  if ! $PSQL -d "$DB" -f "$revertir" >/dev/null 2>&1; then
    echo "FALLA reversión $num: el script revertir_$num.sql dio error"; fallos=1
  elif $PSQL -d "$DB" -f "$test_ultima" >/dev/null 2>&1; then
    echo "FALLA reversión $num: tras revertir, el test de la $num sigue pasando (no deshizo el cambio)"; fallos=1
  elif ! $PSQL -d "$DB" -f "$ultima" >/dev/null 2>&1 || ! $PSQL -d "$DB" -f "$test_ultima" >/dev/null 2>&1; then
    echo "FALLA reversión $num: no se pudo reaplicar la $num después de revertir"; fallos=1
  else
    echo "PASA reversión $num (revierte, el test falla, se reaplica y vuelve a pasar)"
  fi
fi
exit $fallos
