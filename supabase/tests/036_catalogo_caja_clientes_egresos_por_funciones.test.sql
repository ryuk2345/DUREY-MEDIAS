-- Pruebas de la migración 036 (SKU y código fijos; catálogo, caja, clientes y egresos por
-- funciones con módulo; gastos de materia prima por pagos reales).
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

CREATE FUNCTION pg_temp.sesion(p_uid TEXT) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), true)
$$;

-- ── Permisos exactos ───────────────────────────────────────────────────────
SELECT pg_temp.verificar(NOT has_table_privilege('authenticated', 'public.' || t, p), t || ': con sesión no se hace ' || p)
  FROM unnest(ARRAY['cajas_diarias', 'clientes', 'egresos_adicionales', 'catalogo_medias', 'modelos_media', 'compras_materia_prima', 'cuotas_compras', 'pagos_proveedores']) t,
       unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p;
SELECT pg_temp.verificar(has_table_privilege('authenticated', 'public.' || t, 'SELECT'), t || ': con sesión se lee')
  FROM unnest(ARRAY['cajas_diarias', 'clientes', 'egresos_adicionales', 'catalogo_medias', 'modelos_media', 'vista_gastos_materia_prima']) t;
SELECT pg_temp.verificar(NOT has_table_privilege('anon', 'public.vista_gastos_materia_prima', 'SELECT'), 'anon no lee la vista de gastos');
SELECT pg_temp.verificar(NOT has_table_privilege('authenticated', 'public.vista_gastos_materia_prima', 'INSERT'), 'la vista de gastos solo se lee');
SELECT pg_temp.verificar((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.vista_gastos_materia_prima'::regclass), 'vista de gastos en modo invoker');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon no ejecuta ' || f),
       pg_temp.verificar(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ejecuta ' || f),
       pg_temp.verificar((SELECT prosecdef AND COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = f::regprocedure), f || ' definer con search_path fijo')
  FROM unnest(ARRAY['public.crear_producto(jsonb)', 'public.editar_producto(uuid, jsonb)', 'public.cambiar_estado_producto(uuid, text)',
    'public.eliminar_producto(uuid)', 'public.crear_modelo_media(text)', 'public.abrir_caja(uuid, numeric)',
    'public.cerrar_caja(uuid, numeric, text)', 'public.guardar_cliente(uuid, jsonb)', 'public.eliminar_cliente(uuid)',
    'public.registrar_egreso(text, numeric, text, date, text)', 'public.eliminar_egreso(uuid)']) f;
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public.exigir_algun_modulo(text[])', 'EXECUTE'), 'la ayuda de módulos no se llama con sesión');

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000036a5', 'Vende inactiva 036', 'vi036@test', 'vendedora', false, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a6', 'Vende B 036', 'vb036@test', 'vendedora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a7', 'Vende C 036', 'vc036@test', 'vendedora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a1', 'Admin 036', 'ad036@test', 'admin', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a2', 'Vende 036', 've036@test', 'vendedora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a3', 'Teje 036', 'te036@test', 'tejedor', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000036a4', 'Almacén 036', 'al036@test', 'almacenero', true, 'disponible');

SET LOCAL ROLE authenticated;

-- ── Sin módulo, nada ───────────────────────────────────────────────────────
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000036a3');  -- tejedor
SELECT pg_temp.debe_fallar($$SELECT crear_producto('{"modelo":"M","publico":"adulto","diseno_color":"Azul","talla":"L","codigo":"x","costo_produccion_docena":1}')$$, 'módulo catalogo');
SELECT pg_temp.debe_fallar($$SELECT crear_modelo_media('M36')$$, 'módulo catalogo');
SELECT pg_temp.debe_fallar($$SELECT abrir_caja('00000000-0000-0000-0000-0000000036a2', 10)$$, 'módulo ventas');
SELECT pg_temp.debe_fallar($$SELECT guardar_cliente(NULL, '{"nombre":"X","numero_documento":"36363636"}')$$, 'módulo clientes');
SELECT pg_temp.debe_fallar($$SELECT registrar_egreso('Luz', 10, 'servicios', NULL, NULL)$$, 'módulo egresos ni al módulo materia_prima');
SELECT pg_temp.debe_fallar($$SELECT editar_producto(gen_random_uuid(), '{}')$$, 'módulo catalogo');
SELECT pg_temp.debe_fallar($$SELECT cambiar_estado_producto(gen_random_uuid(), 'activo')$$, 'módulo catalogo');
SELECT pg_temp.debe_fallar($$SELECT eliminar_producto(gen_random_uuid())$$, 'módulo catalogo');
SELECT pg_temp.debe_fallar($$SELECT cerrar_caja(gen_random_uuid(), 0, NULL)$$, 'módulo ventas');
SELECT pg_temp.debe_fallar($$SELECT eliminar_cliente(gen_random_uuid())$$, 'módulo clientes');
SELECT pg_temp.debe_fallar($$SELECT eliminar_egreso(gen_random_uuid())$$, 'módulo egresos');
DO $$
BEGIN
  BEGIN
    INSERT INTO clientes (tipo_documento, numero_documento, nombre) VALUES ('dni', '36000000', 'Directo');
    RAISE EXCEPTION 'FALLO: con sesión se creó un cliente sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE cajas_diarias SET saldo_inicial = 0;
    RAISE EXCEPTION 'FALLO: con sesión se cambió una caja sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE catalogo_medias SET precio_venta_sugerido = 0;
    RAISE EXCEPTION 'FALLO: con sesión se cambió el catálogo sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha) VALUES ('x', 1, 'otros', CURRENT_DATE);
    RAISE EXCEPTION 'FALLO: con sesión se creó un egreso sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO pagos_proveedores (monto, metodo_pago) VALUES (1, 'efectivo');
    RAISE EXCEPTION 'FALLO: con sesión se registró un pago sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── Catálogo: SKU y código fijos ───────────────────────────────────────────
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000036a2');  -- vendedora (tiene catálogo)
SELECT pg_temp.debe_fallar($$SELECT crear_producto('{"modelo":"M36","publico":"adulto","diseno_color":"","talla":"L","codigo":"t36","costo_produccion_docena":1}')$$, 'Completa modelo');
SELECT pg_temp.debe_fallar($$SELECT crear_producto('{"modelo":"M36","publico":"adulto","diseno_color":"Azul","talla":"L","codigo":"t36","costo_produccion_docena":-1}')$$, 'no pueden ser negativos');
SELECT pg_temp.debe_fallar($$SELECT crear_producto('{"modelo":"M36","publico":"adulto","diseno_color":"Azul","talla":"L","codigo":" ","costo_produccion_docena":1}')$$, 'Falta el código');
SELECT pg_temp.debe_fallar($$SELECT crear_producto('{"modelo":"M36","publico":"adulto","diseno_color":"Azul","talla":"L","codigo":"t36_x","costo_produccion_docena":1,"precio_venta_sugerido":-1}')$$, 'no pueden ser negativos');
SELECT pg_temp.debe_fallar($$SELECT editar_producto(gen_random_uuid(), '{"modelo":"M","publico":"a","diseno_color":"c","talla":"t","costo_produccion_docena":1}')$$, 'Producto no encontrado');
SELECT pg_temp.debe_fallar($$SELECT cambiar_estado_producto(gen_random_uuid(), 'activo')$$, 'Producto no encontrado');
SELECT pg_temp.debe_fallar($$SELECT crear_modelo_media('  ')$$, 'nombre del modelo');
CREATE TEMP TABLE t_prod ON COMMIT DROP AS SELECT crear_producto('{"sku":"SKU-36A","codigo":"t36_a","modelo":"M36","publico":"adulto","diseno_color":"Azul","talla":"L","costo_produccion_docena":5,"precio_venta_sugerido":12}') AS id;
SELECT pg_temp.debe_fallar(format('SELECT editar_producto(%L, %L)', (SELECT id FROM t_prod), '{"modelo":"M36","publico":"adulto","diseno_color":"Rojo","talla":"XL","costo_produccion_docena":-2}'), 'no pueden ser negativos');
SELECT editar_producto((SELECT id FROM t_prod), '{"sku":"OTRO","codigo":"otro","modelo":"M36","publico":"adulto","diseno_color":"Rojo","talla":"XL","costo_produccion_docena":6,"precio_venta_sugerido":14}');
RESET ROLE;
SELECT pg_temp.verificar((SELECT sku = 'SKU-36A' AND codigo = 't36_a' AND diseno_color = 'Rojo' AND talla = 'XL' AND costo_produccion_docena = 6 AND precio_venta_sugerido = 14
  FROM catalogo_medias WHERE id = (SELECT id FROM t_prod)), 'se edita todo menos el SKU y el código');
SELECT pg_temp.verificar((SELECT NOT es_crudo FROM catalogo_medias WHERE id = (SELECT id FROM t_prod)), 'sin es_crudo en los datos se mantiene el que tenía');
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET sku = 'CAMBIO' WHERE codigo = 't36_a'$$, 'no se cambian');
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET codigo = 'cambio' WHERE codigo = 't36_a'$$, 'no se cambian');
-- Un producto sin SKU (crudo) puede recibir su SKU una vez
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla) VALUES ('00000000-0000-0000-0000-0000000036c9', 't36_sin', 'M36', 'adulto', 'Verde', 'L');
SET LOCAL ROLE authenticated;
SELECT editar_producto('00000000-0000-0000-0000-0000000036c9', '{"sku":"SKU-36S","modelo":"M36","publico":"adulto","diseno_color":"Verde","talla":"L","costo_produccion_docena":1}');
RESET ROLE;
SELECT pg_temp.verificar((SELECT sku = 'SKU-36S' FROM catalogo_medias WHERE id = '00000000-0000-0000-0000-0000000036c9'), 'el SKU vacío se puede poner');
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET sku = 'SKU-36X' WHERE id = '00000000-0000-0000-0000-0000000036c9'$$, 'no se cambian');

SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar(format('SELECT cambiar_estado_producto(%L, %L)', (SELECT id FROM t_prod), 'borrado'), 'Estado de producto inválido');
SELECT cambiar_estado_producto((SELECT id FROM t_prod), 'inactivo');
SELECT crear_modelo_media('Modelo 36');
RESET ROLE;
SELECT pg_temp.verificar((SELECT estado = 'inactivo' FROM catalogo_medias WHERE id = (SELECT id FROM t_prod)), 'producto desactivado');
SELECT pg_temp.verificar(EXISTS (SELECT 1 FROM modelos_media WHERE nombre = 'Modelo 36'), 'modelo creado');

-- ── Clientes ───────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_cli ON COMMIT DROP AS SELECT guardar_cliente(NULL, '{"nombre":" Cliente 36 ","numero_documento":"20360360361","telefono":"","direccion":"Jr. 36"}') AS id;
SELECT pg_temp.debe_fallar($$SELECT guardar_cliente(NULL, '{"nombre":"Otro","numero_documento":"20360360361"}')$$, 'Ya hay un cliente con el documento');
SELECT pg_temp.debe_fallar($$SELECT guardar_cliente(NULL, '{"nombre":"","numero_documento":"1"}')$$, 'nombre o razón social es obligatorio');
SELECT pg_temp.debe_fallar($$SELECT guardar_cliente(NULL, '{"nombre":"X","numero_documento":" "}')$$, 'DNI o RUC es obligatorio');
SELECT pg_temp.debe_fallar($$SELECT guardar_cliente(gen_random_uuid(), '{"nombre":"X","numero_documento":"36999999"}')$$, 'Cliente no encontrado');
SELECT guardar_cliente((SELECT id FROM t_cli), '{"nombre":"Cliente 36 SAC","numero_documento":"20360360361","telefono":"999"}');
RESET ROLE;
SELECT pg_temp.verificar((SELECT tipo_documento = 'ruc' AND nombre = 'Cliente 36 SAC' AND telefono = '999' AND direccion IS NULL FROM clientes WHERE id = (SELECT id FROM t_cli)),
  'cliente editado, RUC por sus 11 dígitos');
INSERT INTO ventas (id, codigo_venta, cliente_id, tipo_pago, total_soles, estado) VALUES
  ('00000000-0000-0000-0000-000000360001', 'V-36-1', (SELECT id FROM t_cli), 'directo', 10, 'pendiente');
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar(format('SELECT eliminar_cliente(%L)', (SELECT id FROM t_cli)), 'tiene ventas registradas');
CREATE TEMP TABLE t_cli2 ON COMMIT DROP AS SELECT guardar_cliente(NULL, '{"nombre":"Sin ventas","numero_documento":"36363636"}') AS id;
SELECT eliminar_cliente((SELECT id FROM t_cli2));
RESET ROLE;
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM clientes WHERE numero_documento = '36363636'), 'cliente sin ventas eliminado');
-- Un producto con ventas no se elimina
INSERT INTO items_venta (venta_id, catalogo_media_id, docenas, precio_docena) VALUES ('00000000-0000-0000-0000-000000360001', (SELECT id FROM t_prod), 1, 10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar(format('SELECT eliminar_producto(%L)', (SELECT id FROM t_prod)), 'Desactívalo en su lugar');
SELECT eliminar_producto('00000000-0000-0000-0000-0000000036c9');
RESET ROLE;
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM catalogo_medias WHERE id = '00000000-0000-0000-0000-0000000036c9'), 'producto sin uso eliminado');

-- ── Caja diaria ────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT abrir_caja('00000000-0000-0000-0000-0000000036a2', -1)$$, 'no puede ser negativo');
SELECT pg_temp.debe_fallar($$SELECT abrir_caja(NULL, 10)$$, 'Elige la vendedora');
SELECT pg_temp.debe_fallar($$SELECT abrir_caja('00000000-0000-0000-0000-0000000036a5', 10)$$, 'Elige la vendedora');  -- inactiva
SELECT pg_temp.debe_fallar($$SELECT cerrar_caja(gen_random_uuid(), 0, NULL)$$, 'Caja no encontrada');
CREATE TEMP TABLE t_caja ON COMMIT DROP AS SELECT abrir_caja('00000000-0000-0000-0000-0000000036a2', 100) AS id;
SELECT pg_temp.debe_fallar($$SELECT abrir_caja('00000000-0000-0000-0000-0000000036a2', 50)$$, 'ya abrió su caja de hoy');
RESET ROLE;
SELECT pg_temp.verificar((SELECT fecha = (NOW() AT TIME ZONE 'America/Lima')::date AND estado = 'abierta' FROM cajas_diarias WHERE id = (SELECT id FROM t_caja)), 'caja con la fecha de Lima');
UPDATE cajas_diarias SET ventas_efectivo = 80, cobros_efectivo = 30, pagos_efectivo = 10 WHERE id = (SELECT id FROM t_caja);  -- esperado 200
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar(format('SELECT cerrar_caja(%L, 190, %L)', (SELECT id FROM t_caja), ' '), 'justificación');
SELECT pg_temp.debe_fallar(format('SELECT cerrar_caja(%L, -1, %L)', (SELECT id FROM t_caja), 'x'), 'no puede ser negativo');
CREATE TEMP TABLE t_cierre ON COMMIT DROP AS SELECT cerrar_caja((SELECT id FROM t_caja), 190, 'Faltó cambio') AS r;
SELECT pg_temp.debe_fallar(format('SELECT cerrar_caja(%L, 200, NULL)', (SELECT id FROM t_caja)), 'ya está cerrada');
RESET ROLE;
SELECT pg_temp.verificar((SELECT r->>'estado' = 'cerrada_faltante' AND (r->>'diferencia')::numeric = -10 AND (r->>'esperado')::numeric = 200 FROM t_cierre), 'cierre: esperado 200, faltan 10');
SELECT pg_temp.verificar((SELECT saldo_esperado_efectivo = 200 AND saldo_declarado_efectivo = 190 AND diferencia = -10 AND justificacion = 'Faltó cambio'
  FROM cajas_diarias WHERE id = (SELECT id FROM t_caja)), 'la caja guarda lo esperado, lo contado y la diferencia');
-- Cuadrada sin justificación y sobrante con ella; otra vendedora abre su propia caja el mismo día
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_caja_b ON COMMIT DROP AS SELECT abrir_caja('00000000-0000-0000-0000-0000000036a6', 30) AS id;
CREATE TEMP TABLE t_caja_c ON COMMIT DROP AS SELECT abrir_caja('00000000-0000-0000-0000-0000000036a7', 30) AS id;
CREATE TEMP TABLE t_cierre_b ON COMMIT DROP AS SELECT cerrar_caja((SELECT id FROM t_caja_b), 30, NULL) AS r;
SELECT pg_temp.debe_fallar(format('SELECT cerrar_caja(%L, 35, NULL)', (SELECT id FROM t_caja_c)), 'justificación');
CREATE TEMP TABLE t_cierre_c ON COMMIT DROP AS SELECT cerrar_caja((SELECT id FROM t_caja_c), 35, 'Sobró') AS r;
RESET ROLE;
SELECT pg_temp.verificar((SELECT r->>'estado' = 'cerrada_cuadrada' AND (r->>'diferencia')::numeric = 0 FROM t_cierre_b), 'cuadrada sin justificación');
SELECT pg_temp.verificar((SELECT r->>'estado' = 'cerrada_sobrante' AND (r->>'diferencia')::numeric = 5 FROM t_cierre_c), 'sobrante de 5 con justificación');

-- La caja del día es la de Lima: lo que suma a la caja la encuentra aunque en UTC ya sea otro día
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public._sumar_a_caja(uuid,text,numeric,boolean)'::regprocedure,
    'public.registrar_pago_proveedor(uuid,text,date,text,uuid)'::regprocedure, 'public.registrar_compra_repuesto(uuid,integer,numeric,text,date,uuid,boolean,uuid)'::regprocedure,
    'public._caja_abierta_hoy(uuid)'::regprocedure) AND prosrc ~* '\mcurrent_date\M'), 'ninguna función de caja usa CURRENT_DATE (UTC)');
INSERT INTO cajas_diarias (id, asesora_id, fecha, saldo_inicial, estado) VALUES
  ('00000000-0000-0000-0000-0000000036b9', '00000000-0000-0000-0000-0000000036a1', (NOW() AT TIME ZONE 'America/Lima')::date, 0, 'abierta');
SELECT _sumar_a_caja('00000000-0000-0000-0000-0000000036a1', 'efectivo', 15, true);
SELECT pg_temp.verificar((SELECT ventas_efectivo = 15 FROM cajas_diarias WHERE id = '00000000-0000-0000-0000-0000000036b9'), 'la venta en efectivo entra a la caja abierta del día de Lima');

-- ── Egresos ────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000036a4');  -- almacenero: materia prima sí, egresos no
CREATE TEMP TABLE t_egr ON COMMIT DROP AS SELECT registrar_egreso(' Planilla ', 500, 'planilla', NULL, ' https://x/c.jpg ') AS id;
SELECT pg_temp.debe_fallar($$SELECT registrar_egreso('Luz', 0, 'servicios', NULL, NULL)$$, 'mayor a 0');
SELECT pg_temp.debe_fallar($$SELECT registrar_egreso(' ', 5, 'servicios', NULL, NULL)$$, 'concepto');
SELECT pg_temp.debe_fallar($$SELECT registrar_egreso('Luz', 5, ' ', NULL, NULL)$$, 'categoría');
SELECT pg_temp.debe_fallar($$SELECT registrar_egreso('Luz', 5, 'servicios', NULL, 'javascript:alert(1)')$$, 'http:// o https://');
SELECT pg_temp.debe_fallar(format('SELECT eliminar_egreso(%L)', (SELECT id FROM t_egr)), 'módulo egresos');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000036a1');  -- admin
CREATE TEMP TABLE t_egr2 ON COMMIT DROP AS SELECT registrar_egreso('Luz', 80, 'servicios', '2026-11-01', NULL) AS id;
RESET ROLE;
SELECT pg_temp.verificar((SELECT concepto = 'Planilla' AND comprobante_url = 'https://x/c.jpg' AND fecha = (NOW() AT TIME ZONE 'America/Lima')::date
  FROM egresos_adicionales WHERE id = (SELECT id FROM t_egr)), 'egreso con comprobante y fecha de Lima');
SELECT pg_temp.verificar((SELECT fecha = '2026-11-01' FROM egresos_adicionales WHERE id = (SELECT id FROM t_egr2)), 'egreso con la fecha que se indica');
INSERT INTO repuestos (id, nombre) VALUES ('00000000-0000-0000-0000-0000000036d1', 'Aguja 36');
INSERT INTO compras_repuestos (repuesto_id, cantidad, precio_unitario, total, metodo_pago, egreso_id)
  VALUES ('00000000-0000-0000-0000-0000000036d1', 1, 80, 80, 'efectivo', (SELECT id FROM t_egr2));
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar(format('SELECT eliminar_egreso(%L)', (SELECT id FROM t_egr2)), 'viene de una compra de repuestos');
SELECT eliminar_egreso((SELECT id FROM t_egr));
RESET ROLE;
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM egresos_adicionales WHERE id = (SELECT id FROM t_egr)), 'egreso eliminado');

-- ── Gastos de materia prima por pagos reales ────────────────────────────────
INSERT INTO materia_prima (id, material, color) VALUES ('00000000-0000-0000-0000-0000000036b1', 'Algodón 36', 'Blanco');
INSERT INTO proveedores (id, nombre) VALUES ('00000000-0000-0000-0000-0000000036b2', 'Hilos 36');
INSERT INTO compras_materia_prima (id, proveedor_id, materia_prima_id, cantidad_kg, costo_total, estado, fecha, condicion_pago) VALUES
  ('00000000-0000-0000-0000-0000000036e1', '00000000-0000-0000-0000-0000000036b2', '00000000-0000-0000-0000-0000000036b1', 10, 120, 'recibida', '2026-11-02', 'contado'),
  ('00000000-0000-0000-0000-0000000036e2', '00000000-0000-0000-0000-0000000036b2', '00000000-0000-0000-0000-0000000036b1', 10, 999, 'devuelta', '2026-11-02', 'contado'),
  ('00000000-0000-0000-0000-0000000036e3', '00000000-0000-0000-0000-0000000036b2', '00000000-0000-0000-0000-0000000036b1', 10, 50, 'pendiente', '2026-11-02', 'contado'),
  ('00000000-0000-0000-0000-0000000036e4', '00000000-0000-0000-0000-0000000036b2', '00000000-0000-0000-0000-0000000036b1', 30, 300, 'recibida', '2026-11-03', 'pago_diferido');
INSERT INTO cuotas_compras (id, compra_id, monto, fecha_vencimiento, estado) VALUES
  ('00000000-0000-0000-0000-0000000036f1', '00000000-0000-0000-0000-0000000036e4', 100, '2026-11-10', 'pagada'),
  ('00000000-0000-0000-0000-0000000036f2', '00000000-0000-0000-0000-0000000036e4', 100, '2026-12-10', 'pendiente'),
  ('00000000-0000-0000-0000-0000000036f3', '00000000-0000-0000-0000-0000000036e4', 100, '2027-01-10', 'pendiente');
INSERT INTO pagos_proveedores (cuota_compra_id, proveedor_id, monto, metodo_pago, fecha) VALUES
  ('00000000-0000-0000-0000-0000000036f1', '00000000-0000-0000-0000-0000000036b2', 100, 'efectivo', '2026-11-12');
SET LOCAL ROLE authenticated;
SELECT pg_temp.verificar((SELECT count(*) = 2 AND sum(monto) = 220
    AND bool_or(origen = 'contado' AND compra_id = '00000000-0000-0000-0000-0000000036e1' AND fecha = '2026-11-02' AND monto = 120)
    AND bool_or(origen = 'cuota' AND compra_id = '00000000-0000-0000-0000-0000000036e4' AND fecha = '2026-11-12' AND monto = 100)
  FROM vista_gastos_materia_prima WHERE compra_id::text LIKE '00000000-0000-0000-0000-0000000036e%'),
  'gastos: contado recibida por su fecha y cada cuota pagada por su fecha; sin devueltas, pendientes ni cuotas por pagar');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM vista_gastos_materia_prima', 'permission denied');
RESET ROLE;

ROLLBACK;
