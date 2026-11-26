-- Pruebas de la migración 029 contra un Postgres real (base de PRUEBA con la 029 aplicada).
--   supabase/tests/local/probar_migraciones.sh <base_nueva>
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

-- ── Estructura y permisos ──────────────────────────────────────────────────
SELECT pg_temp.verificar((SELECT bool_and(relrowsecurity) FROM pg_class
  WHERE oid IN ('public.mecanicos'::regclass, 'public.compras_repuestos'::regclass, 'public.averia_repuestos'::regclass)), 'tablas nuevas con RLS');
SELECT pg_temp.verificar((SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'durey_usuarios_con_sesion'
  AND tablename IN ('mecanicos', 'compras_repuestos', 'averia_repuestos')), 'tablas nuevas con la política de sesión');
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.mecanicos', 'SELECT'), 'anon no lee mecánicos');
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.compras_repuestos', 'SELECT'), 'anon no lee compras');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', 'public.registrar_compra_repuesto(uuid, integer, numeric, text, date, uuid, boolean, uuid)', 'EXECUTE'), 'anon no compra');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', 'public.usar_repuesto_en_averia(uuid, uuid, integer)', 'EXECUTE'), 'anon no usa repuestos');
SELECT pg_temp.verificar(has_function_privilege('authenticated', 'public.cerrar_reparacion_averia(uuid, text, numeric)', 'EXECUTE'), 'authenticated cierra reparaciones');
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public._caja_abierta_hoy(uuid)', 'EXECUTE'), 'la elección de caja es interna');
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public.registrar_reparacion_averia(uuid, text, numeric, numeric, uuid)', 'EXECUTE'), 'la reparación con costo a mano queda retirada');
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public.iniciar_reparacion_averia(uuid)', 'EXECUTE'), 'iniciar sin mecánico queda retirado');
SELECT pg_temp.verificar(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('_caja_abierta_hoy', 'registrar_compra_repuesto', 'asignar_mecanico_averia', 'iniciar_reparacion_mecanico',
                       'usar_repuesto_en_averia', 'quitar_repuesto_de_averia', 'cerrar_reparacion_averia', 'ajustar_stock_repuesto')
     AND NOT (proconfig @> ARRAY['search_path=public, pg_temp'] OR proconfig @> ARRAY['search_path=public'])
), 'funciones con search_path fijo');

-- ── Rol técnico fuera ──────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$INSERT INTO usuarios (nombre, email, rol) VALUES ('T', 't029@test', 'tecnico')$$, 'usuarios_rol_check');

-- ── Datos de prueba ────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000029a1', 'Vendedora 029', 'v029@test', 'vendedora', true, 'disponible');
INSERT INTO repuestos (id, nombre, stock_actual, costo_unitario) VALUES
  ('00000000-0000-0000-0000-0000000029b1', 'Aguja 029', 5, 10),
  ('00000000-0000-0000-0000-0000000029b2', 'Correa 029', 2, 50);
INSERT INTO proveedores (id, nombre) VALUES ('00000000-0000-0000-0000-0000000029c1', 'Ferretería 029');
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES ('00000000-0000-0000-0000-0000000029d1', 'T2901', 'tejedora', 'activa');
INSERT INTO cajas_diarias (id, fecha, estado, saldo_inicial) VALUES ('00000000-0000-0000-0000-0000000029e1', CURRENT_DATE, 'abierta', 100);

-- ── Mecánicos ──────────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$INSERT INTO mecanicos (nombre, apellido, telefono) VALUES ('  ', 'Pérez', '987')$$, 'mecanicos');
INSERT INTO mecanicos (id, nombre, apellido, telefono) VALUES
  ('00000000-0000-0000-0000-0000000029f1', 'Juan', 'Pérez', '987654321'),
  ('00000000-0000-0000-0000-0000000029f2', 'Luis', 'Baja', '911111111');
UPDATE mecanicos SET activo = false WHERE id = '00000000-0000-0000-0000-0000000029f2';
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM usuarios WHERE nombre = 'Juan'), 'un mecánico no es usuario');

-- ── Compra de repuestos (AC1) ──────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 0, 12, 'efectivo', NULL, NULL, true, NULL)$$, 'mayor a 0');
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, -1, 'efectivo', NULL, NULL, true, NULL)$$, 'negativo');
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 1, 'cheque', NULL, NULL, true, NULL)$$, 'Método de pago');
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 1, 'efectivo', CURRENT_DATE + 1, NULL, true, NULL)$$, 'futura');

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_compra ON COMMIT DROP AS
  SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 3, 12, 'efectivo', NULL,
                                   '00000000-0000-0000-0000-0000000029c1', true, '00000000-0000-0000-0000-0000000029a1') AS r;
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_actual = 8 AND costo_unitario = 12 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000029b1'),
  'compra: stock 5+3=8 y costo = último precio 12');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM egresos_adicionales WHERE categoria = 'repuestos' AND monto = 36 AND concepto LIKE 'Compra repuesto: Aguja 029%'),
  'compra: egreso repuestos por 36');
SELECT pg_temp.verificar((SELECT pagos_efectivo = 36 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000029e1'), 'efectivo de la caja: resta 36 de la caja');
SELECT pg_temp.verificar((SELECT (r->>'descontado_de_caja')::boolean AND (r->>'caja_de') = 'Caja general' FROM t_compra), 'avisa de qué caja salió');
SELECT pg_temp.verificar((SELECT total = 36 AND proveedor_id IS NOT NULL AND caja_id IS NOT NULL AND egreso_id IS NOT NULL
  FROM compras_repuestos WHERE id = ((SELECT r->>'compra_id' FROM t_compra))::uuid), 'la compra guarda total, proveedor, caja y egreso');

-- Efectivo que no sale de la caja, transferencia, precio 0 y sin proveedor: no tocan la caja
SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 10, 'efectivo', NULL, NULL, false, NULL);
SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 10, 'transferencia', NULL, NULL, true, NULL);
SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 0, 'efectivo', NULL, NULL, true, NULL);
SELECT pg_temp.verificar((SELECT pagos_efectivo = 36 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000029e1'), 'solo el efectivo de la caja resta');
SELECT pg_temp.verificar((SELECT stock_actual = 11 AND costo_unitario = 0 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000029b1'),
  'precio 0 permitido (garantía) y pasa a ser el último precio');
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM egresos_adicionales WHERE categoria = 'repuestos' AND concepto LIKE 'Compra repuesto: Aguja 029%' AND monto = 10),
  'cada compra con total > 0 crea su egreso');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM egresos_adicionales WHERE concepto LIKE 'Compra repuesto: Aguja 029%' AND monto = 0), 'compra de 0 no crea egreso');
-- Fecha pasada en efectivo: no toca la caja de hoy
SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 10, 'efectivo', CURRENT_DATE - 1, NULL, true, NULL);
SELECT pg_temp.verificar((SELECT pagos_efectivo = 36 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000029e1'), 'compra de otro día no toca la caja de hoy');
UPDATE repuestos SET stock_actual = 5, costo_unitario = 12 WHERE id = '00000000-0000-0000-0000-0000000029b1';

-- ── Ajuste manual ya no crea egreso ────────────────────────────────────────
CREATE TEMP TABLE t_egresos_antes ON COMMIT DROP AS SELECT count(*) AS n FROM egresos_adicionales;
SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000029b1', 'salida', 1, 'conteo');
SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000029b1', 'ingreso', 1, 'conteo');
SELECT pg_temp.verificar((SELECT count(*) FROM egresos_adicionales) = (SELECT n FROM t_egresos_antes), 'el ajuste manual no crea egreso');

-- ── Falla: reportar, asignar, iniciar con mecánico ─────────────────────────
CREATE TEMP TABLE t_averia ON COMMIT DROP AS
  SELECT (reportar_averia_maquina('00000000-0000-0000-0000-0000000029d1', 'MECÁNICA', 'Se rompió una aguja', NULL, NULL)->>'averia_id')::uuid AS id;
GRANT SELECT ON t_averia TO authenticated;
SELECT pg_temp.debe_fallar($$SELECT usar_repuesto_en_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029b1', 1)$$, 'en reparación');
SELECT pg_temp.debe_fallar($$SELECT asignar_mecanico_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029f2')$$, 'no está activo');
SELECT asignar_mecanico_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029f1');
SELECT pg_temp.verificar((SELECT mecanico_id = '00000000-0000-0000-0000-0000000029f1' AND asignado_a = 'Juan Pérez' FROM averias_maquinas WHERE id = (SELECT id FROM t_averia)),
  'la falla queda asignada al mecánico (y su nombre como texto)');
SELECT pg_temp.debe_fallar($$SELECT iniciar_reparacion_mecanico((SELECT id FROM t_averia), NULL)$$, 'mecánico');
SELECT iniciar_reparacion_mecanico((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029f1');
SELECT pg_temp.verificar((SELECT estado = 'en_reparacion' FROM averias_maquinas WHERE id = (SELECT id FROM t_averia)), 'reparación iniciada');
SELECT pg_temp.verificar((SELECT estado = 'mantenimiento' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000029d1'), 'máquina en mantenimiento');

-- ── Usar repuestos (AC2, AC3) ──────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT usar_repuesto_en_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029b2', 3)$$,
  'Solo hay 2 unidades de Correa 029; no se pueden usar 3');
SELECT pg_temp.verificar((SELECT stock_actual = 2 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000029b2'), 'sin stock suficiente no descuenta');
DELETE FROM t_egresos_antes; INSERT INTO t_egresos_antes SELECT count(*) FROM egresos_adicionales;

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_uso ON COMMIT DROP AS
  SELECT usar_repuesto_en_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029b1', 2) AS id;
SELECT usar_repuesto_en_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029b2', 1);
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_actual = 3 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000029b1'), 'usar 2 agujas: 5-2=3');
SELECT pg_temp.verificar((SELECT count(*) FROM egresos_adicionales) = (SELECT n FROM t_egresos_antes), 'usar un repuesto no crea egreso');
SELECT pg_temp.verificar((SELECT costo_unitario = 12 AND mecanico_id = '00000000-0000-0000-0000-0000000029f1' FROM averia_repuestos WHERE id = (SELECT id FROM t_uso)),
  'el uso guarda el costo del momento y el mecánico');

-- Quitar un uso por error devuelve el stock
SELECT quitar_repuesto_de_averia((SELECT id FROM averia_repuestos WHERE repuesto_id = '00000000-0000-0000-0000-0000000029b2' AND averia_id = (SELECT id FROM t_averia)));
SELECT pg_temp.verificar((SELECT stock_actual = 2 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000029b2'), 'quitar devuelve el stock');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM averia_repuestos WHERE averia_id = (SELECT id FROM t_averia)), 'el uso quitado desaparece');

-- ── Cerrar la reparación: costo de repuestos calculado ─────────────────────
SELECT pg_temp.debe_fallar($$SELECT cerrar_reparacion_averia((SELECT id FROM t_averia), '  ', 0)$$, 'diagnóstico');
SELECT pg_temp.debe_fallar($$SELECT cerrar_reparacion_averia((SELECT id FROM t_averia), 'ok', -1)$$, 'negativ');
SELECT cerrar_reparacion_averia((SELECT id FROM t_averia), 'Cambio de aguja', 30);
SELECT pg_temp.verificar((SELECT costo_repuestos = 24 AND costo_mano_obra = 30 AND mecanico_id = '00000000-0000-0000-0000-0000000029f1'
  FROM reparaciones WHERE averia_id = (SELECT id FROM t_averia)), 'costo de repuestos = 2 x 12 = 24 y el mecánico de la falla');
SELECT pg_temp.verificar((SELECT estado = 'resuelto' FROM averias_maquinas WHERE id = (SELECT id FROM t_averia)), 'falla resuelta');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000029d1'), 'máquina activa');
SELECT pg_temp.debe_fallar($$SELECT usar_repuesto_en_averia((SELECT id FROM t_averia), '00000000-0000-0000-0000-0000000029b1', 1)$$, 'en reparación');
SELECT pg_temp.debe_fallar($$SELECT quitar_repuesto_de_averia((SELECT id FROM t_uso))$$, 'en reparación');

-- ── Sin sesión no se toca nada ─────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM mecanicos', 'permission denied');
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_repuesto('00000000-0000-0000-0000-0000000029b1', 1, 1, 'efectivo', NULL, NULL, true, NULL)$$, 'permission denied');
RESET ROLE;

ROLLBACK;
