-- Pruebas de la migración 028 contra un Postgres real (base de PRUEBA con la 028 aplicada).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/028_search_path_y_vista_invoker.test.sql
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

-- ── Estructura ─────────────────────────────────────────────────────────────
-- La vista consulta con los permisos de quien pregunta (no con los de su dueño)
SELECT pg_temp.verificar(
  (SELECT 'security_invoker=true' = ANY (COALESCE(reloptions, '{}')) FROM pg_class WHERE oid = 'public.vista_stock_medias'::regclass),
  'vista_stock_medias con security_invoker');

-- Ninguna función propia del esquema public queda sin search_path fijo
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
), 'todas las funciones propias con search_path fijo');

SELECT pg_temp.verificar(
  (SELECT 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public._siguiente_codigo(text, integer, bigint, integer)'::regprocedure),
  '_siguiente_codigo con search_path = public, pg_temp');

-- Los permisos de la 026 siguen igual
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.vista_stock_medias', 'SELECT'), 'anon no lee la vista');
SELECT pg_temp.verificar(has_table_privilege('authenticated', 'public.vista_stock_medias', 'SELECT'), 'authenticated lee la vista');
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public._siguiente_codigo(text, integer, bigint, integer)', 'EXECUTE'), '_siguiente_codigo sigue interna');

-- ── La vista da el mismo stock con sesión que como dueño ────────────────────
INSERT INTO catalogo_medias (id, codigo, modelo, talla, diseno_color, publico)
VALUES ('00000000-0000-0000-0000-0000000028a1', 'T028', 'Modelo 028', 'U', 'Negro', 'adulto');
INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, estado) VALUES
  ('P028-1', '00000000-0000-0000-0000-0000000028a1', 5, 'almacenado'),
  ('P028-2', '00000000-0000-0000-0000-0000000028a1', 3, 'pendiente_almacenar'),
  ('P028-3', '00000000-0000-0000-0000-0000000028a1', 7, 'entregado');

CREATE TEMP TABLE t_stock_dueno AS
  SELECT stock_docenas FROM vista_stock_medias WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000028a1';
SELECT pg_temp.verificar((SELECT stock_docenas = 8 FROM t_stock_dueno), 'stock como dueño = 8 (5 almacenado + 3 pendiente)');
GRANT SELECT ON t_stock_dueno TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.verificar(
  (SELECT stock_docenas FROM vista_stock_medias WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000028a1')
    = (SELECT stock_docenas FROM t_stock_dueno),
  'con sesión la vista da el mismo stock (RLS de paquetes lo permite)');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM vista_stock_medias', 'permission denied');
RESET ROLE;

-- ── Las funciones siguen funcionando con el search_path fijo ────────────────
SELECT pg_temp.verificar(_siguiente_codigo('V-', 1001, 4, NULL) = 'V-1005', '_siguiente_codigo calcula igual');
SELECT pg_temp.verificar(_siguiente_codigo('GR-', 1, 2, 12345) = 'GR-12346', '_siguiente_codigo respeta el máximo');

INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000028b1', 'Remalladora 028', 'r028@test', 'remalladora', true, 'ocupada');
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000028c1', 'T2801', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000028c2', 'T2802', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000028c3', 'R2801', 'remalladora', 'ocupada');
INSERT INTO lotes_remallado (id, catalogo_media_id, maquina_remalladora_id, estado) VALUES
  ('00000000-0000-0000-0000-0000000028d1', '00000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028c3', 'en_proceso');

-- Como usuario con sesión, igual que la web
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE t_diseno AS
  SELECT registrar_diseno_con_asignaciones('D028', 'Diseño 028', NULL, 'Rojo', NULL, NULL, 'M-028', 2, 'prueba',
         ARRAY['00000000-0000-0000-0000-0000000028c1'::uuid]) AS id;
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM disenos_maquinas WHERE diseno_id = (SELECT id FROM t_diseno) AND activo),
  'registrar_diseno_con_asignaciones crea el diseño y su máquina');

SELECT asignar_diseno_a_maquinas((SELECT id FROM t_diseno), ARRAY['00000000-0000-0000-0000-0000000028c2'::uuid]);
SELECT pg_temp.verificar(
  (SELECT bool_and(activo = (maquina_id = '00000000-0000-0000-0000-0000000028c2')) FROM disenos_maquinas WHERE diseno_id = (SELECT id FROM t_diseno)),
  'asignar_diseno_a_maquinas cambia la máquina activa');

SELECT actualizar_estado_muestra_diseno((SELECT id FROM t_diseno), 'aprobada', NULL);
SELECT pg_temp.verificar((SELECT estado = 'aprobada' FROM disenos WHERE id = (SELECT id FROM t_diseno)),
  'actualizar_estado_muestra_diseno aprueba la muestra');

SELECT finalizar_lote_remallado('00000000-0000-0000-0000-0000000028d1', 10, 0, '00000000-0000-0000-0000-0000000028a1',
                                '00000000-0000-0000-0000-0000000028b1', '00000000-0000-0000-0000-0000000028c3');
SELECT pg_temp.verificar((SELECT estado = 'completado' FROM lotes_remallado WHERE id = '00000000-0000-0000-0000-0000000028d1'),
  'finalizar_lote_remallado completa el lote');
SELECT pg_temp.verificar((SELECT docenas = 10 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000028a1'),
  'finalizar_lote_remallado pasa las docenas a planchado');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000028c3'),
  'finalizar_lote_remallado libera la máquina');

RESET ROLE;

ROLLBACK;
