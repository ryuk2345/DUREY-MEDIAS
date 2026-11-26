-- ==============================================================================
-- Migración 030: permisos de authenticated en las tablas creadas después de la 026
--
-- Problema (visto en la base real tras aplicar la 029): Supabase configura por
-- defecto que cada tabla nueva creada por `postgres` dé a `authenticated` TODOS
-- los permisos (incluidos TRUNCATE, REFERENCES, TRIGGER y, en Postgres 17,
-- MAINTAIN). La 026 solo quitó esos permisos por defecto a `anon`. Por eso:
--   * agencias, pagos_proveedores (027) y mecanicos, compras_repuestos,
--     averia_repuestos (029) tienen TRUNCATE, REFERENCES y TRIGGER;
--   * compras_repuestos y averia_repuestos se podían escribir directamente,
--     saltándose sus funciones atómicas (la 029 quería solo lectura).
--
-- Qué hace (solo permisos; no toca datos):
--   1. Esas 5 tablas quedan con los permisos que pretendían sus migraciones.
--   2. Cualquier otra tabla de public pierde TRUNCATE, REFERENCES y TRIGGER
--      para authenticated, si los tuviera (como hizo la 026).
--   3. Las tablas que se creen en adelante nacen con SELECT, INSERT, UPDATE y
--      DELETE para authenticated, y nada más.
--
-- Reversión: supabase/scripts/revertir_030.sql
-- ==============================================================================

BEGIN;

-- 1. Permisos exactos de las tablas creadas después de la 026
REVOKE ALL ON TABLE public.agencias, public.pagos_proveedores, public.mecanicos,
                    public.compras_repuestos, public.averia_repuestos FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agencias, public.pagos_proveedores, public.mecanicos TO authenticated;
-- Compras y usos de repuestos solo se escriben por sus funciones atómicas (029)
GRANT SELECT ON TABLE public.compras_repuestos, public.averia_repuestos TO authenticated;

-- 2. Ninguna tabla de public con TRUNCATE, REFERENCES ni TRIGGER para authenticated
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tabla
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM authenticated', r.tabla);
    IF current_setting('server_version_num')::int >= 170000 THEN
      EXECUTE format('REVOKE MAINTAIN ON TABLE %s FROM authenticated', r.tabla);
    END IF;
  END LOOP;
END $$;

-- 3. Tablas futuras: solo leer, crear, cambiar y borrar para authenticated
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

COMMIT;
