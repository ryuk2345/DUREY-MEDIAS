-- Pruebas de la migración 026 contra un Postgres real (base de PRUEBA con la 026 aplicada).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/026_cerrar_tablas_sin_sesion.test.sql
-- Todo corre dentro de una transacción que se revierte al final.

BEGIN;

CREATE FUNCTION pg_temp.debe_fallar(p_sql TEXT, p_fragmento TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragmento IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FALLO: se esperaba error con "%", llegó "%"', p_fragmento, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO: se esperaba error con "%" pero la operación pasó (%)', p_fragmento, p_sql;
END $$;

CREATE FUNCTION pg_temp.verificar(p_ok BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
END $$;

-- ── Estructura ──────────────────────────────────────────────────────────────
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'
), 'ninguna tabla ni vista abierta a anon');
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee = 'anon'
), 'ninguna columna (usuarios) abierta a anon');
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity
), 'todas las tablas con RLS');
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
), 'ninguna función propia ejecutable por anon');

-- Datos para las pruebas (como postgres)
INSERT INTO repuestos (id, nombre, stock_actual, costo_unitario) VALUES ('00000000-0000-0000-0000-0000000026c1', 'Repuesto 26', 5, 10);

-- ── Sin sesión (anon): no ve ni toca nada ───────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM maquinas', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM ventas', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM vista_stock_medias', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT id, nombre FROM usuarios', 'permission denied');
SELECT pg_temp.debe_fallar($$INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha) VALUES ('x', 1, 'otros', CURRENT_DATE)$$, 'permission denied');
SELECT pg_temp.debe_fallar($$UPDATE repuestos SET stock_actual = 0$$, 'permission denied');
SELECT pg_temp.debe_fallar($$SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000026c1', 'salida', 1, 'x')$$, 'permission denied');
RESET ROLE;

-- ── Con sesión (authenticated): trabaja normal ──────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.verificar((SELECT count(*) >= 0 FROM maquinas), 'lee máquinas');
SELECT pg_temp.verificar((SELECT count(*) >= 0 FROM vista_stock_medias), 'lee la vista de stock');
SELECT pg_temp.verificar((SELECT count(*) >= 0 FROM (SELECT id, nombre, rol, activo FROM usuarios) u), 'lee columnas públicas de usuarios');
SELECT pg_temp.debe_fallar('SELECT password_hash FROM usuarios', 'permission denied');
INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha) VALUES ('Prueba 026', 1, 'otros', CURRENT_DATE);
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM egresos_adicionales WHERE concepto = 'Prueba 026'), 'inserta y lee con RLS activo');
UPDATE egresos_adicionales SET monto = 2 WHERE concepto = 'Prueba 026';
DELETE FROM egresos_adicionales WHERE concepto = 'Prueba 026';
SELECT pg_temp.verificar((SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000026c1', 'salida', 2, 'x') = 3), 'RPC atómica funciona con sesión');
SELECT pg_temp.debe_fallar($$SELECT _sumar_a_caja(gen_random_uuid(), 'efectivo', 1, false)$$, 'permission denied');
SELECT pg_temp.debe_fallar($$SELECT _siguiente_codigo('VTA', 0, 1, 99)$$, 'permission denied');
SELECT pg_temp.debe_fallar('TRUNCATE egresos_adicionales', 'permission denied');
RESET ROLE;

-- ── Tablas nuevas tampoco nacen abiertas a anon ─────────────────────────────
CREATE TABLE public.tabla_prueba_026 (id INT);
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.tabla_prueba_026', 'SELECT'), 'tabla nueva cerrada a anon');

SELECT 'OK: todas las pruebas de la migración 026 pasaron' AS resultado;

ROLLBACK;
