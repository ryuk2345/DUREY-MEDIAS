-- ==============================================================================
-- Migración 028: avisos de seguridad pendientes de Supabase (advisors)
--
-- 1. vista_stock_medias era SECURITY DEFINER: consultaba con los permisos de su
--    dueño (postgres) y se saltaba el RLS de `paquetes`. Ahora consulta con los
--    permisos de quien pregunta (security_invoker). Desde la 026, quien tiene
--    sesión ('authenticated') puede leer `paquetes` y su política lo deja ver
--    todo: el stock que ve la web no cambia. anon sigue sin acceso.
--    Las funciones SECURITY DEFINER que lean la vista siguen leyendo como dueño.
-- 2. Funciones sin search_path fijo (_siguiente_codigo, finalizar_lote_remallado
--    y las tres de diseños): se fija `public, pg_temp`. Así nadie puede colar
--    una tabla o función con el mismo nombre en otro esquema o en pg_temp.
--    Ninguna de ellas usa funciones del esquema `extensions`. Se recorren todas
--    las funciones propias sin search_path, no solo esas cinco.
--
-- No cambia datos ni permisos. Reversión: supabase/scripts/revertir_028.sql
-- ==============================================================================

BEGIN;

-- 1. La vista respeta los permisos y el RLS de quien consulta
ALTER VIEW public.vista_stock_medias SET (security_invoker = true);

-- 2. search_path fijo en las funciones propias que no lo tienen
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS funcion
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.funcion);
  END LOOP;
END $$;

COMMIT;

-- ── Comprobación (ejecutar por separado después) ─────────────────────────────
-- Debe devolver 'security_invoker=true':
-- SELECT reloptions FROM pg_class WHERE oid = 'public.vista_stock_medias'::regclass;
-- Debe devolver 0 filas (funciones propias sin search_path):
-- SELECT p.oid::regprocedure FROM pg_proc p
--  WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p')
--    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
--    AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%');
