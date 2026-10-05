-- ==============================================================================
-- REVERSIÓN DE EMERGENCIA de la migración 026 (cerrar tablas sin sesión)
--
-- Usar SOLO si, después de ejecutar la 026, alguna pantalla deja de cargar datos
-- o muestra "permission denied" / "JWT". Deja los permisos como estaban antes
-- (base abierta a 'anon', igual que tras las migraciones 010–025), para que la
-- planta siga trabajando mientras se revisa el problema.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tabla, c.relname
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS durey_usuarios_con_sesion ON %s', r.tabla);
    EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', r.tabla);
    IF r.relname <> 'usuarios' THEN
      EXECUTE format('GRANT ALL ON TABLE %s TO anon, authenticated, service_role', r.tabla);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.oid::regclass AS vista
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('v', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('GRANT ALL ON TABLE %s TO anon, authenticated, service_role', r.vista);
  END LOOP;

  FOR r IN
    SELECT c.oid::regclass AS secuencia
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'S'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO anon, authenticated, service_role', r.secuencia);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS funcion, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND p.proname <> '_sumar_a_caja' -- sigue cerrada, como en la migración 023
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.funcion);
  END LOOP;
END $$;

-- usuarios: como en la migración 020 (columnas públicas, sin hashes)
GRANT SELECT (id, auth_id, nombre, email, rol, activo, estado, created_at, debe_cambiar_password)
  ON public.usuarios TO anon, authenticated;
GRANT UPDATE (estado) ON public.usuarios TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon;

COMMIT;
