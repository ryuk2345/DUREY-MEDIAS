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
#    Justo antes de la última migración NNN guarda una huella del esquema public
#    (opciones de tablas y vistas, RLS, permisos —ordenados, el orden interno no importa—,
#    funciones con su configuración, políticas).
# 4. Corre supabase/tests/*.sql (cada test corre en una transacción que se revierte).
# 5. Si existe supabase/scripts/revertir_NNN.sql: lo ejecuta y exige que la huella vuelva a ser
#    EXACTAMENTE la de antes de la NNN (la reversión deshace todo, no solo una parte); luego
#    reaplica la NNN y exige que su test vuelva a pasar.
#
# Salida: 0 = todo en verde · 1 = algún test o la prueba de reversión falló · 2 = no se pudo montar la base.

set -u
DB=${1:?"Indica el nombre de una base nueva, ej. durey_prueba_029"}
PORT=${2:-54329}
case "$DB" in *[!a-z0-9_]*|"") echo "Nombre de base inválido (solo minúsculas, dígitos y _): $DB"; exit 2 ;; esac
case "$PORT" in *[!0-9]*|"") echo "Puerto inválido: $PORT"; exit 2 ;; esac
# Fijo en esta máquina: ninguna variable de entorno de libpq puede redirigir la conexión
unset PGHOSTADDR PGHOST PGSERVICE PGSERVICEFILE PGOPTIONS PGDATABASE PGUSER PGPORT
HOST=127.0.0.1
RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
PSQL="psql -h $HOST -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

HUELLA_SQL="SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
  SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || COALESCE(array_to_string(c.reloptions, ','), '-')
         || ' rls=' || c.relrowsecurity || ' acl=' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a), '-') AS x
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  SELECT 'fn ' || p.oid::regprocedure::text || ' secdef=' || p.prosecdef || ' cfg=' || COALESCE(array_to_string(p.proconfig, ','), '-')
         || ' acl=' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), '-') || ' src=' || md5(p.prosrc)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') FROM pg_policies WHERE schemaname = 'public'
) s"
huella() { $PSQL -d "$DB" -Atc "$HUELLA_SQL"; }

$PSQL -c "CREATE DATABASE $DB" || exit 2
$PSQL -d "$DB" -v db="$DB" -f "$RAIZ/supabase/tests/local/stub_supabase.sql" >/dev/null || exit 2

ultima=$(ls "$RAIZ"/supabase/migrations/0*.sql | tail -1)
huella_antes=""
for f in "$RAIZ"/supabase/migrations/0*.sql; do
  case "$f" in *000_*|*001_*) continue ;; esac
  if [ "$f" = "$ultima" ]; then
    huella_antes=$(huella) || exit 2
    [ -n "$huella_antes" ] || { echo "FALLA: no se pudo calcular la huella del esquema"; exit 2; }
  fi
  if ! salida=$($PSQL -d "$DB" -f "$f" 2>&1); then
    echo "FALLA migración $(basename "$f"): $(echo "$salida" | grep -m2 -E 'ERROR|FATAL')"
    exit 2
  fi
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

# Prueba de la reversión de la última migración, si tiene script
num=$(basename "$ultima" | cut -c1-3)
revertir="$RAIZ/supabase/scripts/revertir_$num.sql"
test_ultima=$(ls "$RAIZ"/supabase/tests/"$num"_*.test.sql 2>/dev/null | head -1)
if [ -f "$revertir" ]; then
  if ! $PSQL -d "$DB" -f "$revertir" >/dev/null 2>&1; then
    echo "FALLA reversión $num: el script revertir_$num.sql dio error"; fallos=1
  elif [ -z "$huella_antes" ] || [ "$(huella)" != "$huella_antes" ]; then
    echo "FALLA reversión $num: tras revertir, el esquema no quedó igual que antes de la $num (reversión incompleta)"; fallos=1
  elif ! $PSQL -d "$DB" -f "$ultima" >/dev/null 2>&1; then
    echo "FALLA reversión $num: no se pudo reaplicar la $num después de revertir"; fallos=1
  elif [ -n "$test_ultima" ] && ! $PSQL -d "$DB" -f "$test_ultima" >/dev/null 2>&1; then
    echo "FALLA reversión $num: tras reaplicar la $num, su test no pasa"; fallos=1
  else
    echo "PASA reversión $num (el esquema vuelve exactamente al de antes, se reaplica y su test pasa)"
  fi
fi
exit $fallos
