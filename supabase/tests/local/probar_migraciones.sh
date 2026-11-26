#!/bin/sh
# Prueba las migraciones y los tests SQL en un Postgres LOCAL (nunca en la base real).
#
# Uso:
#   supabase/tests/local/probar_migraciones.sh <base_nueva> [host] [puerto]
#   ej.: supabase/tests/local/probar_migraciones.sh durey_prueba_029 127.0.0.1 54329
#
# Crea una base NUEVA con ese nombre (falla si ya existe; no borra nada), carga la
# simulación de Supabase (stub_supabase.sql), aplica supabase/migrations/002..último
# en orden (000 y 001 son anteriores a la línea base 002) y corre supabase/tests/*.sql.
# Cada test corre en una transacción que se revierte.

set -u
DB=${1:?"Indica el nombre de una base nueva, ej. durey_prueba_029"}
HOST=${2:-127.0.0.1}
PORT=${3:-54329}
RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
PSQL="psql -h $HOST -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

$PSQL -c "CREATE DATABASE \"$DB\"" || exit 1
$PSQL -d "$DB" -v db="$DB" -f "$RAIZ/supabase/tests/local/stub_supabase.sql" >/dev/null || exit 1

for f in "$RAIZ"/supabase/migrations/0*.sql; do
  case "$f" in *000_*|*001_*) continue ;; esac
  if ! salida=$($PSQL -d "$DB" -f "$f" 2>&1); then
    echo "FALLA migración $(basename "$f"): $(echo "$salida" | grep -m2 -E 'ERROR|FATAL')"
    exit 1
  fi
done
echo "Migraciones aplicadas en $DB"

fallos=0
for t in "$RAIZ"/supabase/tests/*.sql; do
  if salida=$($PSQL -d "$DB" -f "$t" 2>&1); then
    echo "PASA $(basename "$t")"
  else
    echo "FALLA $(basename "$t"): $(echo "$salida" | grep -m2 -E 'ERROR|FALLO')"
    fallos=$((fallos + 1))
  fi
done
exit $fallos
