-- Pruebas de la migración 027 contra un Postgres real (base de PRUEBA con la 027 aplicada).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/027_agencias_pagos_proveedores_almacenes.test.sql
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
SELECT pg_temp.verificar((SELECT count(*) >= 4 FROM agencias), 'las 4 agencias de siempre sembradas');
SELECT pg_temp.verificar((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agencias'::regclass), 'agencias con RLS');
SELECT pg_temp.verificar((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pagos_proveedores'::regclass), 'pagos_proveedores con RLS');
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.agencias', 'SELECT'), 'anon no lee agencias');
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.pagos_proveedores', 'SELECT'), 'anon no lee pagos');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', 'public.registrar_pago_proveedor(uuid, text, date, text, uuid)', 'EXECUTE'), 'anon no paga');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', 'public.desactivar_ubicacion(uuid)', 'EXECUTE'), 'anon no desactiva almacenes');
SELECT pg_temp.verificar(has_function_privilege('authenticated', 'public.registrar_agencia(text)', 'EXECUTE'), 'authenticated registra agencias');

-- ── Agencias ───────────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT registrar_agencia('  ')$$, 'nombre de la agencia');
SELECT pg_temp.debe_fallar($$SELECT registrar_agencia(' shalom ')$$, 'ya está registrada');
CREATE TEMP TABLE t_ag AS SELECT registrar_agencia('Agencia 27') AS id;
SELECT pg_temp.verificar((SELECT nombre = 'Agencia 27' FROM agencias WHERE id = (SELECT id FROM t_ag)), 'agencia nueva');
UPDATE agencias SET activo = false WHERE id = (SELECT id FROM t_ag);
SELECT pg_temp.verificar((SELECT registrar_agencia('agencia 27') = (SELECT id FROM t_ag)), 'una agencia dada de baja se reactiva, no se duplica');

-- ── Pagos a proveedores ────────────────────────────────────────────────────
INSERT INTO proveedores (id, nombre) VALUES ('00000000-0000-0000-0000-0000000027a1', 'Proveedor 27');
INSERT INTO materia_prima (id, material, color, stock_kg, tipo_empaque) VALUES ('00000000-0000-0000-0000-0000000027b1', 'Algodón-27', 'Blanco-27', 0, 'cono');
CREATE TEMP TABLE t_c AS SELECT registrar_compra_materia_prima('00000000-0000-0000-0000-0000000027a1', '00000000-0000-0000-0000-0000000027b1', 10, 300, 'pago_diferido', 'Transferencia', 3) AS id;
CREATE TEMP TABLE t_q AS SELECT id, monto, row_number() OVER (ORDER BY fecha_vencimiento) AS n FROM cuotas_compras WHERE compra_id = (SELECT id FROM t_c);

-- Caja abierta hoy con 500 de saldo inicial
INSERT INTO cajas_diarias (id, fecha, saldo_inicial, estado) VALUES ('00000000-0000-0000-0000-0000000027c1', CURRENT_DATE, 500, 'abierta');

SELECT pg_temp.debe_fallar(format('SELECT registrar_pago_proveedor(%L, %L)', (SELECT id FROM t_q WHERE n = 1), 'bitcoin'), 'Método de pago inválido');
SELECT pg_temp.debe_fallar(format('SELECT registrar_pago_proveedor(%L, %L, %L)', (SELECT id FROM t_q WHERE n = 1), 'efectivo', CURRENT_DATE + 1), 'no puede ser futura');

-- Efectivo hoy: resta de la caja
SELECT registrar_pago_proveedor((SELECT id FROM t_q WHERE n = 1), 'efectivo');
SELECT pg_temp.verificar((SELECT pagos_efectivo = 100 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000027c1'), 'efectivo: 100 salen de la caja del día');
SELECT pg_temp.verificar((SELECT estado = 'pagada' AND metodo_pago = 'Efectivo' FROM cuotas_compras WHERE id = (SELECT id FROM t_q WHERE n = 1)), 'cuota pagada');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM pagos_proveedores WHERE cuota_compra_id = (SELECT id FROM t_q WHERE n = 1) AND caja_id IS NOT NULL AND proveedor_id = '00000000-0000-0000-0000-0000000027a1'), 'pago en el historial con su caja y proveedor');
SELECT pg_temp.debe_fallar(format('SELECT registrar_pago_proveedor(%L, %L)', (SELECT id FROM t_q WHERE n = 1), 'efectivo'), 'ya fue pagada');
SELECT pg_temp.verificar((SELECT pagos_efectivo = 100 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000027c1'), 'no se resta dos veces');

-- Transferencia: solo historial
SELECT registrar_pago_proveedor((SELECT id FROM t_q WHERE n = 2), 'transferencia');
SELECT pg_temp.verificar((SELECT pagos_efectivo = 100 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000027c1'), 'transferencia no toca la caja');
SELECT pg_temp.verificar((SELECT caja_id IS NULL FROM pagos_proveedores WHERE cuota_compra_id = (SELECT id FROM t_q WHERE n = 2)), 'transferencia sin caja');

-- Efectivo con fecha pasada: historial sí, caja no
CREATE TEMP TABLE t_c2 AS SELECT registrar_compra_materia_prima('00000000-0000-0000-0000-0000000027a1', '00000000-0000-0000-0000-0000000027b1', 10, 400, 'pago_diferido', 'Transferencia', 4) AS id;
CREATE TEMP TABLE t_q2 AS SELECT id, row_number() OVER (ORDER BY fecha_vencimiento) AS n FROM cuotas_compras WHERE compra_id = (SELECT id FROM t_c2);
SELECT registrar_pago_proveedor((SELECT id FROM t_q2 WHERE n = 1), 'efectivo', CURRENT_DATE - 3);
SELECT pg_temp.verificar((SELECT pagos_efectivo = 100 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000027c1'), 'efectivo con fecha pasada no toca la caja de hoy');

-- Varias cajas abiertas: la de quien paga; sin caja propia, la general (no la de otra vendedora)
INSERT INTO usuarios (id, nombre, email, rol) VALUES
  ('00000000-0000-0000-0000-0000000027e1', 'Vendedora 27 X', 'v27x@prueba.local', 'vendedora'),
  ('00000000-0000-0000-0000-0000000027e2', 'Vendedora 27 Y', 'v27y@prueba.local', 'vendedora');
INSERT INTO cajas_diarias (id, asesora_id, fecha, saldo_inicial, estado, created_at) VALUES
  ('00000000-0000-0000-0000-0000000027c2', '00000000-0000-0000-0000-0000000027e1', CURRENT_DATE, 0, 'abierta', NOW() - INTERVAL '2 hours'),
  ('00000000-0000-0000-0000-0000000027c3', '00000000-0000-0000-0000-0000000027e2', CURRENT_DATE, 0, 'abierta', NOW());
SELECT pg_temp.verificar((SELECT (registrar_pago_proveedor((SELECT id FROM t_q2 WHERE n = 2), 'efectivo', NULL, NULL, '00000000-0000-0000-0000-0000000027e2')->>'caja_id')::uuid = '00000000-0000-0000-0000-0000000027c3'), 'paga Y: sale de la caja de Y');
SELECT pg_temp.verificar((SELECT (registrar_pago_proveedor((SELECT id FROM t_q2 WHERE n = 3), 'efectivo')->>'caja_id')::uuid = '00000000-0000-0000-0000-0000000027c1'), 'sin caja propia: caja general, no la de X (más antigua)');
SELECT pg_temp.verificar((SELECT pagos_efectivo = 0 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000027c2'), 'la caja de X no se toca');

-- Caja cerrada no recibe pagos
UPDATE cajas_diarias SET estado = 'cerrada_cuadrada' WHERE fecha = CURRENT_DATE;
SELECT pg_temp.verificar((SELECT (registrar_pago_proveedor((SELECT id FROM t_q2 WHERE n = 4), 'efectivo')->>'descontado_de_caja')::boolean = false), 'caja cerrada: no se descuenta');

-- Reprogramar
SELECT pg_temp.debe_fallar(format('SELECT reprogramar_cuota_compra(%L, %L)', (SELECT id FROM t_q WHERE n = 2), CURRENT_DATE + 60), 'pagada no se puede reprogramar');
SELECT reprogramar_cuota_compra((SELECT id FROM t_q WHERE n = 3), CURRENT_DATE + 90);
SELECT pg_temp.verificar((SELECT fecha_vencimiento = CURRENT_DATE + 90 FROM cuotas_compras WHERE id = (SELECT id FROM t_q WHERE n = 3)), 'cuota reprogramada');

-- ── Almacenes ──────────────────────────────────────────────────────────────
INSERT INTO ubicaciones (id, nombre, tipo, activo) VALUES
  ('00000000-0000-0000-0000-0000000027d1', 'Salón 27-A', 'salon', true),
  ('00000000-0000-0000-0000-0000000027d2', 'Salón 27-B', 'salon', true);
SELECT pg_temp.debe_fallar($$SELECT renombrar_ubicacion('00000000-0000-0000-0000-0000000027d1', 'salón 27-b')$$, 'Ya existe un almacén');
SELECT renombrar_ubicacion('00000000-0000-0000-0000-0000000027d1', '  Salón 27-Z ');
SELECT pg_temp.verificar((SELECT nombre = 'Salón 27-Z' FROM ubicaciones WHERE id = '00000000-0000-0000-0000-0000000027d1'), 'renombrado sin espacios');

SELECT renombrar_ubicacion('00000000-0000-0000-0000-0000000027d2', 'SALÓN 27-B');
SELECT pg_temp.verificar((SELECT nombre = 'SALÓN 27-B' FROM ubicaciones WHERE id = '00000000-0000-0000-0000-0000000027d2'), 'renombrar solo mayúsculas está permitido');

INSERT INTO paquetes (codigo_paquete, docenas, estado, ubicacion_id) VALUES ('P-27-1', 5, 'almacenado', '00000000-0000-0000-0000-0000000027d1');
SELECT pg_temp.debe_fallar($$SELECT desactivar_ubicacion('00000000-0000-0000-0000-0000000027d1')$$, 'tiene 1 paquete(s) dentro');
UPDATE paquetes SET estado = 'entregado' WHERE codigo_paquete = 'P-27-1';
SELECT desactivar_ubicacion('00000000-0000-0000-0000-0000000027d1');
SELECT pg_temp.verificar((SELECT NOT activo FROM ubicaciones WHERE id = '00000000-0000-0000-0000-0000000027d1'), 'almacén vacío desactivado (borrado suave)');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM paquetes WHERE codigo_paquete = 'P-27-1' AND ubicacion_id = '00000000-0000-0000-0000-0000000027d1'), 'el historial de paquetes sigue apuntando al almacén');

-- Crear con el nombre de un almacén eliminado lo reactiva
SELECT pg_temp.debe_fallar($$SELECT renombrar_ubicacion('00000000-0000-0000-0000-0000000027d2', 'salón 27-z')$$, 'almacén eliminado');
SELECT pg_temp.verificar((SELECT crear_ubicacion('Salón 27-Z') = '00000000-0000-0000-0000-0000000027d1'), 'crear con el nombre de uno eliminado lo reactiva');
SELECT pg_temp.verificar((SELECT activo FROM ubicaciones WHERE id = '00000000-0000-0000-0000-0000000027d1'), 'reactivado');
SELECT pg_temp.debe_fallar($$SELECT crear_ubicacion('salón 27-z')$$, 'Ya existe un almacén');

ROLLBACK;
