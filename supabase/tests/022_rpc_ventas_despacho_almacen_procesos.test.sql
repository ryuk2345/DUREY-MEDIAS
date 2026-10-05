-- Pruebas de la migración 022 contra un Postgres real.
-- Ejecutar sobre una base de PRUEBA con las migraciones aplicadas:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/022_rpc_ventas_despacho_almacen_procesos.test.sql
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

-- ── Datos de prueba ─────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000001a1', 'Vendedora', 'v@test22', 'vendedora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000001a2', 'Remalladora 1', 'r1@test22', 'remalladora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000001a3', 'Remalladora 2', 'r2@test22', 'remalladora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000001a4', 'Planchador', 'p@test22', 'planchador', true, 'disponible');
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla) VALUES
  ('00000000-0000-0000-0000-0000000001c1', 'T22-A', 'M', 'adulto', 'Liso', 'M'),
  ('00000000-0000-0000-0000-0000000001c2', 'T22-B', 'M', 'adulto', 'Rayas', 'M');
INSERT INTO ubicaciones (id, nombre, tipo) VALUES ('00000000-0000-0000-0000-0000000001e1', 'Salón Test', 'salon');
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000001d1', 'R22-1', 'remalladora', 'activa'),
  ('00000000-0000-0000-0000-0000000001d2', 'R22-2', 'remalladora', 'activa'),
  ('00000000-0000-0000-0000-0000000001d3', 'R22-3', 'remalladora', 'malograda');

-- ── 1. registrar_venta ─────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"X","numero_documento":"1"}', NULL, 'directo', 0, '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":1,"precio_docena":10}]', NULL)$$, 'vendedora');
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"X","numero_documento":"1"}', '00000000-0000-0000-0000-0000000001a1', 'directo', 0, '[]', NULL)$$, 'al menos un producto');
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"X","numero_documento":"1"}', '00000000-0000-0000-0000-0000000001a1', 'cuotas', 0, '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":1,"precio_docena":10}]', '[]')$$, 'cronograma');

-- Producto inexistente: falla la FK de items_venta y NO debe quedar ni cliente ni venta
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"Cliente Fantasma","numero_documento":"99999999","tipo_documento":"dni"}', '00000000-0000-0000-0000-0000000001a1', 'directo', 0, '[{"catalogo_media_id":"00000000-0000-0000-0000-00000000ffff","docenas":1,"precio_docena":10}]', NULL)$$, 'foreign key');
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM clientes WHERE numero_documento = '99999999'), 'sin cliente a medias');

CREATE TEMP TABLE t_v1 AS SELECT registrar_venta(
  '{"nombre":"Cliente Uno","numero_documento":"11111111","tipo_documento":"dni"}', '00000000-0000-0000-0000-0000000001a1', 'cuotas', 20,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":3,"precio_docena":40},{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c2","docenas":2,"precio_docena":50}]',
  '[{"numero_cuota":1,"monto":100,"fecha_vencimiento":"2026-11-01"},{"numero_cuota":2,"monto":100,"fecha_vencimiento":"2026-12-01"}]') AS r;
SELECT pg_temp.verificar((SELECT (r->>'total_soles')::numeric = 220 FROM t_v1), 'total calculado en el servidor = 220');
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM items_venta WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_v1)), '2 productos');
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM cuotas WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_v1)), '2 cuotas');

-- Mismo cliente: se actualiza, no se duplica; el código siguiente es distinto
CREATE TEMP TABLE t_v2 AS SELECT registrar_venta(
  '{"nombre":"Cliente Uno SAC","numero_documento":"11111111","tipo_documento":"dni"}', '00000000-0000-0000-0000-0000000001a1', 'directo', 0,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":5,"precio_docena":40}]', NULL) AS r;
SELECT pg_temp.verificar((SELECT count(*) = 1 AND max(nombre) = 'Cliente Uno SAC' FROM clientes WHERE numero_documento = '11111111'), 'cliente actualizado sin duplicar');
SELECT pg_temp.verificar((SELECT (a.r->>'codigo_venta') <> (b.r->>'codigo_venta') FROM t_v1 a, t_v2 b), 'códigos de venta distintos');
SELECT pg_temp.verificar((SELECT (r->>'codigo_venta') ~ '^V-[0-9]{4,}$' FROM t_v2), 'formato V-NNNN');

-- ── 3. almacenar_paquete (stock para el despacho) ──────────────────────────
SELECT pg_temp.debe_fallar($$SELECT almacenar_paquete(NULL, NULL, 'X', NULL, 1, 12, NULL, 'ingreso_directo', 'x')$$, 'salón de destino');
CREATE TEMP TABLE t_p1 AS SELECT almacenar_paquete(NULL, '00000000-0000-0000-0000-0000000001e1', 'T22-PKG-1', '00000000-0000-0000-0000-0000000001c1', 4, 48, NULL, 'ingreso_directo', 'ING test') AS id;
CREATE TEMP TABLE t_p2 AS SELECT almacenar_paquete(NULL, '00000000-0000-0000-0000-0000000001e1', 'T22-PKG-2', '00000000-0000-0000-0000-0000000001c2', 2, 24, NULL, 'ingreso_directo', 'ING test') AS id;
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM movimientos_stock WHERE paquete_id IN ((SELECT id FROM t_p1), (SELECT id FROM t_p2))), 'kárdex de los 2 ingresos');

INSERT INTO paquetes (id, codigo_paquete, catalogo_media_id, docenas, estado) VALUES
  ('00000000-0000-0000-0000-0000000001f1', 'T22-PEND', '00000000-0000-0000-0000-0000000001c1', 1, 'pendiente_almacenar'),
  ('00000000-0000-0000-0000-0000000001f2', 'T22-ENTR', '00000000-0000-0000-0000-0000000001c1', 1, 'entregado');
SELECT almacenar_paquete('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-0000000001e1', NULL, NULL, NULL, NULL, NULL, 'ingreso_salon', 'Saco T22-PEND');
SELECT pg_temp.verificar((SELECT estado = 'almacenado' FROM paquetes WHERE id = '00000000-0000-0000-0000-0000000001f1'), 'pendiente → almacenado');
SELECT pg_temp.verificar((SELECT docenas = 1 FROM movimientos_stock WHERE paquete_id = '00000000-0000-0000-0000-0000000001f1'), 'kárdex toma las docenas del paquete');
SELECT pg_temp.debe_fallar($$SELECT almacenar_paquete('00000000-0000-0000-0000-0000000001f2', '00000000-0000-0000-0000-0000000001e1', NULL, NULL, NULL, NULL, NULL, 'ingreso_salon', 'x')$$, 'no se puede almacenar');

-- ── 2. despachar_venta (venta 2: 5 docenas de T22-A; hay 4 + 1 = 5) ────────
SELECT pg_temp.debe_fallar(format('SELECT despachar_venta(%L, %L, %L)', (SELECT r->>'venta_id' FROM t_v2), 'Shalom',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":6}]'), 'Stock insuficiente');
SELECT pg_temp.verificar((SELECT estado = 'pendiente' FROM ventas WHERE id = (SELECT (r->>'venta_id')::uuid FROM t_v2)), 'sin stock, la venta sigue pendiente');
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM paquetes WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_v2)), 'sin stock, ningún paquete entregado');

CREATE TEMP TABLE t_g AS SELECT despachar_venta((SELECT (r->>'venta_id')::uuid FROM t_v2), 'Shalom',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":5}]') AS codigo;
SELECT pg_temp.verificar((SELECT codigo ~ '^GR-[0-9]{4,}$' FROM t_g), 'formato GR-NNNN');
SELECT pg_temp.verificar((SELECT estado = 'entregado' FROM ventas WHERE id = (SELECT (r->>'venta_id')::uuid FROM t_v2)), 'venta entregada');
SELECT pg_temp.verificar((SELECT count(*) = 2 AND bool_and(estado = 'entregado' AND ubicacion_id IS NULL) FROM paquetes WHERE venta_id = (SELECT (r->>'venta_id')::uuid FROM t_v2)), '2 paquetes entregados');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM guias_remision WHERE codigo_guia = (SELECT codigo FROM t_g)), 'guía registrada');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM movimientos_stock WHERE tipo = 'salida_venta' AND referencia LIKE 'Despacho ' || (SELECT r->>'codigo_venta' FROM t_v2) || '%'), 'kárdex de salida');
SELECT pg_temp.debe_fallar(format('SELECT despachar_venta(%L, %L, %L)', (SELECT r->>'venta_id' FROM t_v2), 'Shalom',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas":1}]'), 'ya fue despachada');

-- ── 4 y 5. Remallado ───────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001c1', 75)$$, 'no está disponible');
CREATE TEMP TABLE t_l AS SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001c1', 75) AS id;
SELECT pg_temp.verificar((SELECT estado = 'ocupada' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000001d1'), 'máquina ocupada');
SELECT pg_temp.verificar((SELECT estado = 'ocupada' FROM usuarios WHERE id = '00000000-0000-0000-0000-0000000001a2'), 'remalladora ocupada');
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001c1', 10)$$, 'no está disponible');

SELECT pg_temp.debe_fallar(format('SELECT traspasar_lote_remallado(%L, %L, %L, 80)', (SELECT id FROM t_l), '00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-0000000001d2'), 'excede');
SELECT pg_temp.debe_fallar(format('SELECT traspasar_lote_remallado(%L, %L, %L, 10)', (SELECT id FROM t_l), '00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-0000000001d3'), 'no está disponible');
SELECT pg_temp.verificar((SELECT docenas_pendientes = 75 FROM lotes_remallado WHERE id = (SELECT id FROM t_l)), 'traspaso fallido no resta docenas (antes sí)');
SELECT traspasar_lote_remallado((SELECT id FROM t_l), '00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-0000000001d2', 25);
SELECT pg_temp.verificar((SELECT docenas_pendientes = 50 FROM lotes_remallado WHERE id = (SELECT id FROM t_l)), 'origen 75 - 25 = 50');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM lotes_remallado WHERE maquina_remalladora_id = '00000000-0000-0000-0000-0000000001d2' AND docenas_pendientes = 25), 'lote destino de 25');
SELECT pg_temp.verificar((SELECT estado = 'ocupada' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000001d2'), 'máquina destino ocupada');

-- ── 6. Planchado ───────────────────────────────────────────────────────────
INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000001c1', 10)
  ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = 10;
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_planchado('[]')$$, 'al menos una docena');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_planchado('[{"planchador_id":"00000000-0000-0000-0000-0000000001a4","catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas_planchadas":9,"docenas_defectuosas":2}]')$$, 'No hay suficiente stock');
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM reportes_planchado WHERE planchador_id = '00000000-0000-0000-0000-0000000001a4'), 'sin stock no quedan reportes (antes sí)');
SELECT registrar_produccion_planchado('[{"planchador_id":"00000000-0000-0000-0000-0000000001a4","catalogo_media_id":"00000000-0000-0000-0000-0000000001c1","docenas_planchadas":7,"docenas_defectuosas":1}]');
SELECT pg_temp.verificar((SELECT docenas = 2 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000001c1'), 'stock 10 - 8 = 2');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM reportes_planchado WHERE planchador_id = '00000000-0000-0000-0000-0000000001a4'), '1 reporte');

SELECT 'OK: todas las pruebas de la migración 022 pasaron' AS resultado;

ROLLBACK;
