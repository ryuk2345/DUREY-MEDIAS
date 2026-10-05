-- Pruebas de la migración 023 contra un Postgres real (base de PRUEBA).
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/023_cobros_reales_y_caja.test.sql
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

INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000003a1', 'Vendedora 23', 'v@test23', 'vendedora', true, 'disponible');
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla) VALUES
  ('00000000-0000-0000-0000-0000000003c1', 'T23-A', 'M', 'adulto', 'Liso', 'M');
-- Caja abierta de hoy de esta vendedora
INSERT INTO cajas_diarias (id, asesora_id, fecha, saldo_inicial, estado) VALUES
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-0000000003a1', CURRENT_DATE, 100, 'abierta');

-- ── Venta al contado: cobro por el total + caja (ventas en efectivo) ────────
CREATE TEMP TABLE t_contado AS SELECT registrar_venta(
  '{"nombre":"Cliente 23","numero_documento":"23232323"}', '00000000-0000-0000-0000-0000000003a1', 'directo', 0,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000003c1","docenas":2,"precio_docena":50}]', NULL, 'efectivo') AS r;
SELECT pg_temp.verificar((SELECT (r->>'monto_cobrado')::numeric = 100 FROM t_contado), 'contado cobra el total');
SELECT pg_temp.verificar((SELECT count(*) = 1 AND sum(monto) = 100 AND bool_and(estado_validacion = 'validado') FROM cobros WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_contado)), 'cobro validado de 100');
SELECT pg_temp.verificar((SELECT ventas_efectivo = 100 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000003b1'), 'caja: ventas en efectivo = 100');

-- ── Venta a cuotas con adelanto por Yape: cobro del adelanto + caja digital ─
CREATE TEMP TABLE t_cuotas AS SELECT registrar_venta(
  '{"nombre":"Cliente 23","numero_documento":"23232323"}', '00000000-0000-0000-0000-0000000003a1', 'cuotas', 40,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000003c1","docenas":4,"precio_docena":40}]',
  '[{"numero_cuota":1,"monto":60,"fecha_vencimiento":"2026-11-01"},{"numero_cuota":2,"monto":60,"fecha_vencimiento":"2026-12-01"}]', 'yape') AS r;
SELECT pg_temp.verificar((SELECT (r->>'monto_cobrado')::numeric = 40 FROM t_cuotas), 'cuotas cobra solo el adelanto');
SELECT pg_temp.verificar((SELECT ventas_digital = 40 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000003b1'), 'caja: ventas digitales = 40');
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"X","numero_documento":"1"}', '00000000-0000-0000-0000-0000000003a1', 'directo', 0, '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000003c1","docenas":1,"precio_docena":1}]', NULL, 'bitcoin')$$, 'Método de pago');

-- ── Cobro de cuotas ─────────────────────────────────────────────────────────
CREATE TEMP TABLE t_q AS SELECT id FROM cuotas WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_cuotas) AND numero_cuota = 1;
SELECT pg_temp.verificar((SELECT registrar_cobro_cuotas(ARRAY[(SELECT id FROM t_q)], 'efectivo', NULL, '00000000-0000-0000-0000-0000000003a1') = 60), 'cobra 60');
SELECT pg_temp.verificar((SELECT estado = 'pagada' AND metodo_pago = 'efectivo' FROM cuotas WHERE id = (SELECT id FROM t_q)), 'cuota pagada');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM cobros WHERE cuota_id = (SELECT id FROM t_q)), 'cobro de la cuota registrado');
SELECT pg_temp.verificar((SELECT cobros_efectivo = 60 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000003b1'), 'caja: cobros en efectivo = 60');
SELECT pg_temp.debe_fallar(format('SELECT registrar_cobro_cuotas(ARRAY[%L]::uuid[], %L, NULL, NULL)', (SELECT id FROM t_q), 'efectivo'), 'ya está pagada');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM cobros WHERE cuota_id = (SELECT id FROM t_q)), 'doble cobro rechazado sin duplicar');

-- ── Sin caja abierta el cobro igual se registra ─────────────────────────────
UPDATE cajas_diarias SET estado = 'cerrada_cuadrada' WHERE id = '00000000-0000-0000-0000-0000000003b1';
SELECT registrar_cobro_cuotas(ARRAY(SELECT id FROM cuotas WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_cuotas) AND numero_cuota = 2), 'transferencia', NULL, NULL);
SELECT pg_temp.verificar((SELECT count(*) = 3 FROM cobros WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_cuotas)), 'adelanto + 2 cuotas = 3 cobros');
SELECT pg_temp.verificar((SELECT cobros_digital = 0 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000003b1'), 'caja cerrada no se toca');

SELECT 'OK: todas las pruebas de la migración 023 pasaron' AS resultado;

ROLLBACK;
