-- Pruebas de la migración 030 (permisos exactos de authenticated) contra un Postgres de PRUEBA.
--   supabase/tests/local/probar_migraciones.sh <base_nueva>
-- La base local simula los permisos por defecto de Supabase (stub_supabase.sql).
-- Todo corre dentro de una transacción que se revierte al final.

BEGIN;

CREATE FUNCTION pg_temp.verificar(p_ok BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
END $$;

CREATE FUNCTION pg_temp.permisos(p_tabla TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(privilege_type, ',' ORDER BY privilege_type), '-')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = p_tabla AND grantee = 'authenticated'
$$;

-- Ninguna tabla de public da a authenticated TRUNCATE, REFERENCES ni TRIGGER (la 026 los quitó; las tablas nuevas tampoco)
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'authenticated' AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
), 'authenticated sin TRUNCATE, REFERENCES ni TRIGGER en ninguna tabla');

-- Permisos exactos de las tablas creadas después de la 026
SELECT pg_temp.verificar(pg_temp.permisos(t) = 'DELETE,INSERT,SELECT,UPDATE', t || ': leer, crear, cambiar y borrar (' || pg_temp.permisos(t) || ')')
  FROM unnest(ARRAY['agencias', 'pagos_proveedores', 'mecanicos']) AS t;
SELECT pg_temp.verificar(pg_temp.permisos(t) = 'SELECT', t || ': solo lectura, se escribe por su función (' || pg_temp.permisos(t) || ')')
  FROM unnest(ARRAY['compras_repuestos', 'averia_repuestos']) AS t;

-- Una tabla que se cree en adelante nace sin TRUNCATE, REFERENCES ni TRIGGER para authenticated, y sin nada para anon
CREATE TABLE public.tabla_prueba_030 (id INT);
SELECT pg_temp.verificar(pg_temp.permisos('tabla_prueba_030') = 'DELETE,INSERT,SELECT,UPDATE', 'tabla nueva: solo leer, crear, cambiar y borrar');
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.tabla_prueba_030', 'SELECT'), 'tabla nueva cerrada a anon');

-- La web sigue funcionando: con sesión se lee y se escriben mecánicos; compras solo por la función
SET LOCAL ROLE authenticated;
INSERT INTO mecanicos (nombre, apellido, telefono) VALUES ('Prueba', '030', '900000030');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM mecanicos WHERE apellido = '030'), 'con sesión se crean mecánicos');
RESET ROLE;
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO compras_repuestos (repuesto_id, cantidad, precio_unitario, total, metodo_pago)
    VALUES ((SELECT id FROM repuestos LIMIT 1), 1, 1, 1, 'efectivo');
    RAISE EXCEPTION 'FALLO: con sesión se pudo insertar una compra sin la función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

ROLLBACK;
