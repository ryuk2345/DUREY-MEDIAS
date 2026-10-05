-- Pruebas de la migración 024 contra un Postgres real (base de PRUEBA).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/024_rpc_materia_prima.test.sql
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
  RAISE EXCEPTION 'FALLO: se esperaba error con "%" pero la operación pasó', p_fragmento;
END $$;

CREATE FUNCTION pg_temp.verificar(p_ok BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'FALLO: %', p_msg; END IF;
END $$;

INSERT INTO proveedores (id, nombre) VALUES ('00000000-0000-0000-0000-0000000005a1', 'Proveedor 24');
INSERT INTO materia_prima (id, material, color, stock_kg, tipo_empaque) VALUES
  ('00000000-0000-0000-0000-0000000005b1', 'Algodón-24', 'Blanco-24', 20, 'cono'),
  ('00000000-0000-0000-0000-0000000005b2', 'Algodón-24', 'Negro-24', 30, 'cono');
INSERT INTO repuestos (id, nombre, stock_actual, costo_unitario) VALUES
  ('00000000-0000-0000-0000-0000000005c1', 'Repuesto 24', 5, 10);

-- ── Compra a crédito: cuotas que suman exacto ──────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT registrar_compra_materia_prima('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005b1', 0, 100, 'contado', 'efectivo', NULL)$$, 'mayores a 0');
CREATE TEMP TABLE t_c AS SELECT registrar_compra_materia_prima('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005b1', 10, 100, 'pago_diferido', 'transferencia', 3) AS id;
SELECT pg_temp.verificar((SELECT count(*) = 3 AND sum(monto) = 100 FROM cuotas_compras WHERE compra_id = (SELECT id FROM t_c)), '3 cuotas que suman exactamente 100 (33.33 + 33.33 + 33.34)');
SELECT pg_temp.verificar((SELECT stock_kg = 20 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b1'), 'una compra pendiente no suma stock');

-- ── Control de calidad: suma relativa y no se aprueba dos veces ────────────
-- Simula un lote de tejido que descontó 6 kg DESPUÉS de abrir la pantalla de compras
UPDATE materia_prima SET stock_kg = stock_kg - 6 WHERE id = '00000000-0000-0000-0000-0000000005b1';
SELECT procesar_control_calidad_compra((SELECT id FROM t_c), true, NULL);
SELECT pg_temp.verificar((SELECT stock_kg = 24 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b1'), 'stock 20 - 6 + 10 = 24 (antes quedaba 30 y se perdía el consumo)');
SELECT pg_temp.verificar((SELECT estado = 'recibida' FROM compras_materia_prima WHERE id = (SELECT id FROM t_c)), 'compra recibida');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM movimientos_materia_prima WHERE referencia_id = (SELECT id FROM t_c) AND tipo = 'ingreso_compra'), 'movimiento de ingreso');
SELECT pg_temp.debe_fallar(format('SELECT procesar_control_calidad_compra(%L, true, NULL)', (SELECT id FROM t_c)), 'ya fue procesada');
SELECT pg_temp.verificar((SELECT stock_kg = 24 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b1'), 'no se suma dos veces');

CREATE TEMP TABLE t_c2 AS SELECT registrar_compra_materia_prima('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005b2', 5, 50, 'contado', 'efectivo', NULL) AS id;
SELECT pg_temp.debe_fallar(format('SELECT procesar_control_calidad_compra(%L, false, %L)', (SELECT id FROM t_c2), ' '), 'motivo');
SELECT procesar_control_calidad_compra((SELECT id FROM t_c2), false, 'Color equivocado');
SELECT pg_temp.verificar((SELECT stock_kg = 30 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b2'), 'devolución no suma stock');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM movimientos_materia_prima WHERE referencia_id = (SELECT id FROM t_c2) AND tipo = 'devolucion'), 'movimiento de devolución');

-- ── Editar hilo: cambiar color no toca el stock; un conteo sí, con movimiento ─
SELECT editar_materia_prima('00000000-0000-0000-0000-0000000005b1', 'Algodón-24', 'Crudo-24', 'cono', 20, 20);
SELECT pg_temp.verificar((SELECT color = 'Crudo-24' AND stock_kg = 24 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b1'), 'solo color: el stock real (24) se respeta aunque la pantalla mostraba 20');
SELECT editar_materia_prima('00000000-0000-0000-0000-0000000005b1', 'Algodón-24', 'Crudo-24', 'cono', 20, 22.5);
SELECT pg_temp.verificar((SELECT stock_kg = 22.5 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b1'), 'conteo físico 22.5');
SELECT pg_temp.verificar((SELECT count(*) = 1 AND sum(cantidad_kg) = -1.5 FROM movimientos_materia_prima WHERE materia_prima_id = '00000000-0000-0000-0000-0000000005b1' AND tipo = 'ajuste_inventario'), 'ajuste de -1.5 kg registrado');
SELECT pg_temp.verificar((SELECT stock_kg = 30 AND color = 'Negro-24' FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000005b2'), 'el otro hilo del mismo material no se tocó');

-- ── Repuestos ──────────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000005c1', 'salida', 6, 'x')$$, 'Solo hay 5');
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM egresos_adicionales WHERE concepto LIKE 'Consumo repuesto: Repuesto 24%'), 'sin stock no se registra gasto (antes sí)');
SELECT pg_temp.verificar((SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000005c1', 'salida', 2, 'Cambio') = 3), 'salida de 2 deja 3');
SELECT pg_temp.verificar((SELECT monto = 20 FROM egresos_adicionales WHERE concepto LIKE 'Consumo repuesto: Repuesto 24%'), 'gasto 2 × 10 = 20');
SELECT pg_temp.verificar((SELECT ajustar_stock_repuesto('00000000-0000-0000-0000-0000000005c1', 'ingreso', 4, NULL) = 7), 'ingreso de 4 deja 7');

SELECT 'OK: todas las pruebas de la migración 024 pasaron' AS resultado;

ROLLBACK;
