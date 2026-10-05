-- ==============================================================================
-- Migración 026: Cerrar la base a quien no inició sesión (etapa 1b)
--
-- Problema: 010, 013, 015 y 019 dieron GRANT ALL a 'anon' en todas las tablas y
-- funciones, con RLS desactivado. La anon key es pública (va dentro de la web),
-- así que cualquiera podía leer, modificar o borrar ventas, stock, caja, etc.
-- sin usuario ni contraseña.
--
-- Qué hace:
--   * 'anon' (sin sesión) pierde todo acceso a tablas, vistas, secuencias y
--     funciones del esquema public.
--   * 'authenticated' (usuario con sesión válida) conserva lectura y escritura.
--     En 'usuarios' se mantienen las columnas de la migración 020 (sin hashes).
--   * Se activa RLS en todas las tablas con una política para usuarios con
--     sesión (defensa adicional; 'service_role' y las funciones SECURITY DEFINER
--     no se ven afectadas).
--   * Las funciones auxiliares internas (nombre que empieza con "_") solo las
--     usan otras funciones; nadie las puede llamar directamente.
--   * Las tablas/funciones que se creen en el futuro ya no se abren a 'anon'.
--
-- ANTES de ejecutarla: abrir /api/diagnostico/sesion-db con la sesión iniciada
-- y confirmar "listo_para_026": true. Si algo falla después, ejecutar
-- supabase/scripts/revertir_026_abrir_tablas.sql (deja todo como antes).
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  -- 1. Tablas: RLS + política para sesión válida; sin acceso para anon
  FOR r IN
    SELECT c.oid::regclass AS tabla, c.relname
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.tabla);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = r.relname AND policyname = 'durey_usuarios_con_sesion') THEN
      EXECUTE format('CREATE POLICY durey_usuarios_con_sesion ON %s FOR ALL TO authenticated USING (true) WITH CHECK (true)', r.tabla);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.tabla);
    IF r.relname <> 'usuarios' THEN
      -- Sin TRUNCATE/TRIGGER/REFERENCES (GRANT ALL de 010 los incluía)
      EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', r.tabla);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO authenticated', r.tabla);
    END IF;
  END LOOP;

  -- 2. Vistas (vista_stock_medias, etc.)
  FOR r IN
    SELECT c.oid::regclass AS vista
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('v', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.vista);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', r.vista);
    EXECUTE format('GRANT SELECT ON TABLE %s TO authenticated', r.vista);
  END LOOP;

  -- 3. Secuencias
  FOR r IN
    SELECT c.oid::regclass AS secuencia
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'S'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', r.secuencia);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', r.secuencia);
  END LOOP;

  -- 4. Funciones propias (las de extensiones como uuid-ossp no se tocan).
  --    EXECUTE viene dado a PUBLIC por defecto, y anon lo hereda: hay que quitarlo de PUBLIC.
  FOR r IN
    SELECT p.oid::regprocedure AS funcion, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.funcion);
    IF left(r.proname, 1) = '_' THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.funcion);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.funcion);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.funcion);
  END LOOP;
END $$;

-- 5. 'usuarios': anon ya no lee ni actualiza nada (la migración 020 le dejaba columnas públicas).
--    authenticated conserva exactamente lo de 020.
REVOKE ALL ON TABLE public.usuarios FROM anon;

-- 6. Lo que se cree en adelante desde el SQL Editor (rol postgres) no se abre a anon.
--    Las migraciones nuevas deben dar GRANT solo a authenticated y service_role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

COMMIT;

-- ── Comprobación (ejecutar por separado después) ─────────────────────────────
-- Debe devolver 0 filas (ninguna tabla/vista abierta a anon):
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND grantee = 'anon';
-- Debe devolver 0 filas (ninguna tabla sin RLS):
-- SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity;
