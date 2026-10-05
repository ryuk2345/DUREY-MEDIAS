-- Pruebas de la migración 021 contra un Postgres real.
-- Ejecutar sobre una base de PRUEBA con las migraciones aplicadas:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/021_rpc_produccion_y_averias.test.sql
-- Todo corre dentro de una transacción que se revierte al final.
-- Si una regla falla, el script se detiene con "FALLO: ...".

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
  RAISE EXCEPTION 'FALLO: se esperaba error con "%" pero la operación pasó', p_fragmento;
END $$;

CREATE FUNCTION pg_temp.verificar(p_ok BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
END $$;

-- ── Datos de prueba ─────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Tejedor Uno', 't1@test', 'tejedor', true, 'disponible');
INSERT INTO materia_prima (id, material, color, stock_kg) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Algodón-TEST', 'Blanco-TEST', 20);
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla, peso_docena_g, materia_prima_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'TST-1', 'Modelo', 'adulto', 'Liso', 'M', 400, '00000000-0000-0000-0000-0000000000b1');
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'TST01', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000000d2', 'TST02', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000000d3', 'TST03', 'tejedora', 'mantenimiento');

-- ── 1. cargar_lote_produccion ──────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT cargar_lote_produccion(NULL, 'dia', 12,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d1","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]')$$,
  'operador de turno');
SELECT pg_temp.debe_fallar($$SELECT cargar_lote_produccion('00000000-0000-0000-0000-0000000000a1', 'dia', 12,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d3","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]')$$,
  'TST03 no está disponible');

-- Hilo insuficiente: 2 máquinas × 15 doc × 0.4 kg = 12 kg > 5 kg. No debe quedar NADA escrito.
UPDATE materia_prima SET stock_kg = 5 WHERE id = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.debe_fallar($$SELECT cargar_lote_produccion('00000000-0000-0000-0000-0000000000a1', 'dia', 12,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d1","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"},
    {"maquina_id":"00000000-0000-0000-0000-0000000000d2","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]')$$,
  'Falta de materia prima');
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM turnos_produccion WHERE tejedor_id = '00000000-0000-0000-0000-0000000000a1'), 'no debe quedar turno a medias');
SELECT pg_temp.verificar((SELECT stock_kg = 5 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000000b1'), 'no debe descontar hilo si falla');

UPDATE materia_prima SET stock_kg = 20 WHERE id = '00000000-0000-0000-0000-0000000000b1';
CREATE TEMP TABLE t_turno AS
SELECT cargar_lote_produccion('00000000-0000-0000-0000-0000000000a1', 'dia', 12,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d1","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"},
    {"maquina_id":"00000000-0000-0000-0000-0000000000d2","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]') AS id;

SELECT pg_temp.verificar((SELECT stock_kg = 8 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000000b1'), 'stock debe quedar 20 - 12 = 8');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM movimientos_materia_prima WHERE referencia_id = (SELECT id FROM t_turno) AND cantidad_kg = 12), 'movimiento de consumo de 12 kg');
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM turno_maquinas WHERE turno_id = (SELECT id FROM t_turno)), '2 máquinas en el turno');
SELECT pg_temp.verificar((SELECT bool_and(estado = 'ocupada') FROM maquinas WHERE codigo IN ('TST01','TST02')), 'máquinas ocupadas');
SELECT pg_temp.verificar((SELECT estado = 'ocupada' FROM usuarios WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'tejedor ocupado');

SELECT pg_temp.debe_fallar($$SELECT cargar_lote_produccion('00000000-0000-0000-0000-0000000000a1', 'dia', 12,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d1","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]')$$,
  'TST01 no está disponible');

-- ── 3. reportar_averia_maquina (sobre TST01, que está en el turno) ─────────
SELECT pg_temp.debe_fallar($$SELECT reportar_averia_maquina('00000000-0000-0000-0000-0000000000d1', 'MECÁNICA', '  ', NULL, NULL)$$, 'descripción');
SELECT pg_temp.debe_fallar($$SELECT reportar_averia_maquina('00000000-0000-0000-0000-0000000000d3', 'MECÁNICA', 'ruido', NULL, NULL)$$, 'estado mantenimiento');

CREATE TEMP TABLE t_averia AS
SELECT reportar_averia_maquina('00000000-0000-0000-0000-0000000000d1', 'MECÁNICA', 'Rotura de aguja', 'alexander', NULL) AS r;

SELECT pg_temp.verificar((SELECT (r->>'turnos_cerrados')::int = 1 FROM t_averia), 'debe cerrar 1 turno');
SELECT pg_temp.verificar((SELECT estado = 'malograda' AND detalle_estado = 'FALLA MECÁNICA' FROM maquinas WHERE codigo = 'TST01'), 'TST01 malograda');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE codigo = 'TST02'), 'la otra máquina del lote se libera (antes quedaba ocupada)');
SELECT pg_temp.verificar((SELECT estado = 'cerrado' FROM turnos_produccion WHERE id = (SELECT id FROM t_turno)), 'turno cerrado');
SELECT pg_temp.verificar((SELECT estado = 'disponible' FROM usuarios WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'tejedor disponible');
SELECT pg_temp.verificar((SELECT estado = 'pendiente' AND asignado_a = 'alexander' FROM averias_maquinas WHERE id = (SELECT (r->>'averia_id')::uuid FROM t_averia)), 'avería pendiente');
SELECT pg_temp.debe_fallar($$SELECT reportar_averia_maquina('00000000-0000-0000-0000-0000000000d1', 'ELÉCTRICA', 'otra', NULL, NULL)$$, 'ya tiene un reporte de avería activo');

-- ── 2. cerrar_turno_produccion ─────────────────────────────────────────────
SELECT pg_temp.debe_fallar(format('SELECT cerrar_turno_produccion(%L, %L)', (SELECT id FROM t_turno), '[]'), 'ya fue cerrado');

CREATE TEMP TABLE t_turno2 AS
SELECT cargar_lote_produccion('00000000-0000-0000-0000-0000000000a1', 'noche', 8,
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d2","catalogo_media_id":"00000000-0000-0000-0000-0000000000c1"}]') AS id;
SELECT pg_temp.debe_fallar(format('SELECT cerrar_turno_produccion(%L, %L)', (SELECT id FROM t_turno2),
  '[{"maquina_id":"00000000-0000-0000-0000-0000000000d2","docenas":-1}]'), 'negativas');
SELECT cerrar_turno_produccion((SELECT id FROM t_turno2), '[{"maquina_id":"00000000-0000-0000-0000-0000000000d2","docenas":14.5}]');
SELECT pg_temp.verificar((SELECT docenas_producidas = 14.5 FROM reportes_produccion WHERE turno_id = (SELECT id FROM t_turno2)), 'reporte 14.5 docenas');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE codigo = 'TST02'), 'máquina liberada al cerrar');
SELECT pg_temp.verificar((SELECT estado = 'disponible' FROM usuarios WHERE id = '00000000-0000-0000-0000-0000000000a1'), 'tejedor liberado al cerrar');

-- ── 4 y 5. Reparación ──────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar(format('SELECT registrar_reparacion_averia(%L, %L, 0, 0, NULL)', (SELECT (r->>'averia_id') FROM t_averia), 'cambio'), 'Primero inicia la reparación');
SELECT iniciar_reparacion_averia((SELECT (r->>'averia_id')::uuid FROM t_averia));
SELECT pg_temp.verificar((SELECT estado = 'mantenimiento' FROM maquinas WHERE codigo = 'TST01'), 'máquina en mantenimiento');
SELECT pg_temp.debe_fallar(format('SELECT iniciar_reparacion_averia(%L)', (SELECT (r->>'averia_id') FROM t_averia)), 'avería pendiente');
SELECT pg_temp.debe_fallar(format('SELECT registrar_reparacion_averia(%L, %L, 0, 0, NULL)', (SELECT (r->>'averia_id') FROM t_averia), ' '), 'diagnóstico');
SELECT registrar_reparacion_averia((SELECT (r->>'averia_id')::uuid FROM t_averia), 'Cambio de aguja', 30, 20, NULL);
SELECT pg_temp.verificar((SELECT costo_total = 50 FROM reparaciones WHERE averia_id = (SELECT (r->>'averia_id')::uuid FROM t_averia)), 'costo_total 50');
SELECT pg_temp.verificar((SELECT estado = 'resuelto' FROM averias_maquinas WHERE id = (SELECT (r->>'averia_id')::uuid FROM t_averia)), 'avería resuelta');
SELECT pg_temp.verificar((SELECT estado = 'activa' AND detalle_estado = 'OPERATIVA' FROM maquinas WHERE codigo = 'TST01'), 'máquina activa y OPERATIVA');

SELECT 'OK: todas las pruebas de la migración 021 pasaron' AS resultado;

ROLLBACK;
