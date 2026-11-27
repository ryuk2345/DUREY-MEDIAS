-- Pruebas de la migración 034 (un SKU por saco, kardex, traslados, despacho por sacos, bloqueo por rol).
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

CREATE FUNCTION pg_temp.permisos(p_tabla TEXT, p_rol TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(privilege_type, ',' ORDER BY privilege_type), '-')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = p_tabla AND grantee = p_rol
$$;

CREATE FUNCTION pg_temp.sesion(p_uid TEXT) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), true)
$$;

-- ── Estructura y permisos exactos ──────────────────────────────────────────
SELECT pg_temp.verificar((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.despacho_detalle'::regclass), 'despacho_detalle con RLS');
SELECT pg_temp.verificar(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'despacho_detalle' AND policyname = 'durey_usuarios_con_sesion'),
  'despacho_detalle con la política de sesión');
SELECT pg_temp.verificar(pg_temp.permisos(t, 'authenticated') = 'SELECT', t || ': con sesión solo se lee (' || pg_temp.permisos(t, 'authenticated') || ')'),
       pg_temp.verificar(pg_temp.permisos(t, 'anon') = '-', t || ': nada para anon')
  FROM unnest(ARRAY['despacho_detalle', 'paquetes', 'movimientos_stock', 'guias_remision', 'ventas', 'items_venta', 'cuotas', 'cobros', 'ubicaciones', 'agencias']) AS t;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 AND has_table_privilege('authenticated', 'public.despacho_detalle', 'MAINTAIN') THEN
    RAISE EXCEPTION 'FALLO: authenticated tiene MAINTAIN en despacho_detalle';
  END IF;
END $$;
SELECT pg_temp.verificar(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon no ejecuta ' || f),
       pg_temp.verificar(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ejecuta ' || f),
       pg_temp.verificar((SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = f::regprocedure), f || ' con search_path fijo')
  FROM unnest(ARRAY[
    'public.trasladar_saco(uuid, uuid)',
    'public.despachar_venta_sacos(uuid, text, uuid[])',
    'public.almacenar_paquete(uuid, uuid, text, uuid, numeric, numeric, jsonb, text, text)',
    'public.registrar_venta(jsonb, uuid, text, numeric, jsonb, jsonb, text)',
    'public.registrar_cobro_cuotas(uuid[], text, text, uuid)',
    'public.crear_ubicacion(text, text)',
    'public.renombrar_ubicacion(uuid, text)',
    'public.desactivar_ubicacion(uuid)',
    'public.registrar_agencia(text)'
  ]) AS f;
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public.despachar_venta(uuid, text, jsonb)', 'EXECUTE'),
  'el despacho anterior ya no se llama con sesión');

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000034a1', 'Almacén 034', 'al034@test', 'almacenero', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000034a2', 'Vende 034', 've034@test', 'vendedora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000034a3', 'Plancha 034', 'pl034@test', 'planchador', true, 'disponible');
INSERT INTO catalogo_medias (id, codigo, sku, modelo, publico, diseno_color, talla) VALUES
  ('00000000-0000-0000-0000-0000000034c1', 'T34-A', 'SKU-34A', 'M34', 'adulto', 'Azul', 'L'),
  ('00000000-0000-0000-0000-0000000034c2', 'T34-B', 'SKU-34B', 'M34', 'adulto', 'Rojo', 'L'),
  ('00000000-0000-0000-0000-0000000034c3', 'T34-C', 'SKU-34C', 'M34', 'adulto', 'Verde', 'L');
INSERT INTO ubicaciones (id, nombre, tipo, activo) VALUES
  ('00000000-0000-0000-0000-0000000034e1', 'Salón 34-1', 'salon', true),
  ('00000000-0000-0000-0000-0000000034e2', 'Salón 34-2', 'salon', true),
  ('00000000-0000-0000-0000-0000000034e3', 'Salón 34-baja', 'salon', false);
INSERT INTO paquetes (id, codigo_paquete, catalogo_media_id, docenas, total_pares, estado, ubicacion_id) VALUES
  ('00000000-0000-0000-0000-0000000034f1', 'S34-A1', '00000000-0000-0000-0000-0000000034c1', 6, 72, 'almacenado', '00000000-0000-0000-0000-0000000034e1'),
  ('00000000-0000-0000-0000-0000000034f2', 'S34-A2', '00000000-0000-0000-0000-0000000034c1', 6, 72, 'almacenado', '00000000-0000-0000-0000-0000000034e2'),
  ('00000000-0000-0000-0000-0000000034f3', 'S34-B1', '00000000-0000-0000-0000-0000000034c2', 4, 48, 'almacenado', '00000000-0000-0000-0000-0000000034e1'),
  ('00000000-0000-0000-0000-0000000034f4', 'S34-A3', '00000000-0000-0000-0000-0000000034c1', 6, 72, 'pendiente_almacenar', NULL),
  ('00000000-0000-0000-0000-0000000034f5', 'S34-C1', '00000000-0000-0000-0000-0000000034c3', 6, 72, 'almacenado', '00000000-0000-0000-0000-0000000034e1');
INSERT INTO clientes (id, tipo_documento, numero_documento, nombre) VALUES ('00000000-0000-0000-0000-0000000034b1', 'dni', '34343434', 'Cliente 34');
INSERT INTO ventas (id, codigo_venta, cliente_id, tipo_pago, total_soles, estado) VALUES
  ('00000000-0000-0000-0000-000000340001', 'V-34-1', '00000000-0000-0000-0000-0000000034b1', 'directo', 100, 'pendiente');
INSERT INTO items_venta (venta_id, catalogo_media_id, docenas, precio_docena) VALUES
  ('00000000-0000-0000-0000-000000340001', '00000000-0000-0000-0000-0000000034c1', 10, 5),
  ('00000000-0000-0000-0000-000000340001', '00000000-0000-0000-0000-0000000034c2', 3, 5);

-- ── Un saco, un SKU ────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, estado, detalles_contenido)
  VALUES ('S34-MIX', '00000000-0000-0000-0000-0000000034c1', 2, 'almacenado', '[{"codigo":"T34-A","docenas":1},{"codigo":"T34-B","docenas":1}]')$$, 'paquetes_un_solo_sku');

-- ── Bloqueo por rol ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000034a2');  -- vendedora: sin almacén
SELECT pg_temp.debe_fallar($$SELECT trasladar_saco('00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034e2')$$, 'módulo almacen');
SELECT pg_temp.debe_fallar($$SELECT crear_ubicacion('Salón X', 'salon')$$, 'módulo almacen');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000034a3');  -- planchador: sin despacho ni ventas
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom', ARRAY['00000000-0000-0000-0000-0000000034f1']::uuid[])$$, 'módulo despacho');
SELECT pg_temp.debe_fallar($$SELECT registrar_agencia('Agencia 34')$$, 'módulo despacho');
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{}'::jsonb, NULL, 'directo', 0, '[]'::jsonb, '[]'::jsonb, 'efectivo')$$, 'módulo ventas');
SELECT pg_temp.debe_fallar($$SELECT registrar_cobro_cuotas(ARRAY[]::uuid[], 'efectivo', NULL, NULL)$$, 'módulo ventas');
SELECT pg_temp.debe_fallar($$SELECT almacenar_paquete('00000000-0000-0000-0000-0000000034f4', '00000000-0000-0000-0000-0000000034e1', NULL, NULL, NULL, NULL, NULL, NULL, NULL)$$, 'módulo almacen');
-- Sin escritura directa
DO $$
BEGIN
  BEGIN
    UPDATE paquetes SET ubicacion_id = NULL;
    RAISE EXCEPTION 'FALLO: con sesión se cambió un saco sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO movimientos_stock (tipo, docenas) VALUES ('ingreso_salon', 1);
    RAISE EXCEPTION 'FALLO: con sesión se escribió el kardex sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE ventas SET estado = 'entregado';
    RAISE EXCEPTION 'FALLO: con sesión se cambió una venta sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ── Almacenar y trasladar ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000034a1');  -- almacenero
SELECT pg_temp.debe_fallar($$SELECT almacenar_paquete('00000000-0000-0000-0000-0000000034f4', '00000000-0000-0000-0000-0000000034e3', NULL, NULL, NULL, NULL, NULL, NULL, NULL)$$, 'salón de destino válido');
SELECT almacenar_paquete('00000000-0000-0000-0000-0000000034f4', '00000000-0000-0000-0000-0000000034e1', NULL, NULL, NULL, NULL, NULL, NULL, 'Entra de Preparado');
SELECT almacenar_paquete('00000000-0000-0000-0000-0000000034f4', '00000000-0000-0000-0000-0000000034e1', NULL, NULL, NULL, NULL, NULL, NULL, NULL);  -- mismo salón: nada
CREATE TEMP TABLE t_nuevo ON COMMIT DROP AS SELECT almacenar_paquete(NULL, '00000000-0000-0000-0000-0000000034e2', 'S34-NUEVO', '00000000-0000-0000-0000-0000000034c2', 3, 36,
  '[{"codigo":"T34-B","docenas":3,"pares":36}]', NULL, 'Ingreso directo') AS id;
SELECT pg_temp.debe_fallar($$SELECT almacenar_paquete(NULL, '00000000-0000-0000-0000-0000000034e2', 'S34-SIN', NULL, 3, 36, NULL, NULL, NULL)$$, 'SKU del saco');
RESET ROLE;
SELECT pg_temp.verificar((SELECT count(*) = 1 AND bool_and(tipo = 'ingreso_salon' AND usuario_id = '00000000-0000-0000-0000-0000000034a1'
    AND ubicacion_id = '00000000-0000-0000-0000-0000000034e1' AND catalogo_media_id = '00000000-0000-0000-0000-0000000034c1' AND docenas = 6)
  FROM movimientos_stock WHERE paquete_id = '00000000-0000-0000-0000-0000000034f4'), 'una sola entrada al salón, con usuario, SKU y docenas');
SELECT pg_temp.verificar((SELECT count(*) = 1 AND bool_and(catalogo_media_id = '00000000-0000-0000-0000-0000000034c2' AND docenas = 3)
  FROM movimientos_stock WHERE paquete_id = (SELECT id FROM t_nuevo)), 'el saco nuevo entra al kardex con su SKU');

SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT trasladar_saco('00000000-0000-0000-0000-0000000034f5', '00000000-0000-0000-0000-0000000034e1')$$, 'ya está en Salón 34-1');
SELECT pg_temp.debe_fallar($$SELECT trasladar_saco('00000000-0000-0000-0000-0000000034f5', '00000000-0000-0000-0000-0000000034e3')$$, 'salón de destino activo');
SELECT trasladar_saco('00000000-0000-0000-0000-0000000034f5', '00000000-0000-0000-0000-0000000034e2');
-- Volver a almacenar en otro salón también queda como traslado
SELECT almacenar_paquete('00000000-0000-0000-0000-0000000034f5', '00000000-0000-0000-0000-0000000034e1', NULL, NULL, NULL, NULL, NULL, NULL, 'Reubicado');
RESET ROLE;
SELECT pg_temp.verificar((SELECT ubicacion_id = '00000000-0000-0000-0000-0000000034e1' FROM paquetes WHERE id = '00000000-0000-0000-0000-0000000034f5'), 'el saco quedó en el último salón');
SELECT pg_temp.verificar((SELECT count(*) = 4
    AND count(*) FILTER (WHERE tipo = 'traslado_salida' AND ubicacion_id = '00000000-0000-0000-0000-0000000034e1' AND ubicacion_destino_id = '00000000-0000-0000-0000-0000000034e2') = 1
    AND count(*) FILTER (WHERE tipo = 'traslado_entrada' AND ubicacion_id = '00000000-0000-0000-0000-0000000034e2' AND ubicacion_origen_id = '00000000-0000-0000-0000-0000000034e1') = 1
    AND bool_and(usuario_id = '00000000-0000-0000-0000-0000000034a1' AND docenas = 6 AND catalogo_media_id = '00000000-0000-0000-0000-0000000034c3')
  FROM movimientos_stock WHERE paquete_id = '00000000-0000-0000-0000-0000000034f5'), 'cada traslado: salida del origen y entrada al destino, con usuario');
-- Un saco que no está en un salón no se traslada
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT trasladar_saco(id, '00000000-0000-0000-0000-0000000034e2') FROM paquetes WHERE codigo_paquete = 'S34-NOEXISTE'
  UNION ALL SELECT trasladar_saco('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000034e2')$$, 'Saco no encontrado');
RESET ROLE;

-- ── Despacho eligiendo sacos ───────────────────────────────────────────────
INSERT INTO paquetes (id, codigo_paquete, catalogo_media_id, docenas, total_pares, estado, ubicacion_id) VALUES
  ('00000000-0000-0000-0000-0000000034f6', 'S34-A4', '00000000-0000-0000-0000-0000000034c1', 2, 24, 'pendiente_almacenar', NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000034a1');  -- almacenero (tiene despacho)
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', ' ', ARRAY['00000000-0000-0000-0000-0000000034f1']::uuid[])$$, 'agencia');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom', ARRAY[]::uuid[])$$, 'Elige los sacos');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f1']::uuid[])$$, 'más de una vez');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f6']::uuid[])$$, 'S34-A4 no está disponible en un salón');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f5']::uuid[])$$, 'S34-C1 es de T34-C, que no está en el pedido');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f3']::uuid[])$$, 'Faltan 4.00 docenas de T34-A');
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f2']::uuid[])$$, 'Faltan 3.00 docenas de T34-B');
CREATE TEMP TABLE t_guia ON COMMIT DROP AS SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', ' Shalom ',
  ARRAY['00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f2', '00000000-0000-0000-0000-0000000034f3']::uuid[]) AS codigo;
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340001', 'Shalom', ARRAY['00000000-0000-0000-0000-0000000034f4']::uuid[])$$, 'ya fue despachada');
RESET ROLE;
SELECT pg_temp.verificar((SELECT despachado_por = '00000000-0000-0000-0000-0000000034a1' AND agencia = 'Shalom' AND estado = 'entregado'
  FROM guias_remision WHERE codigo_guia = (SELECT codigo FROM t_guia)), 'la guía guarda quién despachó');
SELECT pg_temp.verificar((SELECT count(*) = 2
    AND bool_or(catalogo_media_id = '00000000-0000-0000-0000-0000000034c1' AND docenas_pedidas = 10 AND docenas_entregadas = 12)
    AND bool_or(catalogo_media_id = '00000000-0000-0000-0000-0000000034c2' AND docenas_pedidas = 3 AND docenas_entregadas = 4)
  FROM despacho_detalle WHERE venta_id = '00000000-0000-0000-0000-000000340001'), 'el detalle guarda lo pedido y lo entregado (sobrante registrado)');
SELECT pg_temp.verificar((SELECT count(*) = 3
    AND bool_and(tipo = 'salida_venta' AND usuario_id = '00000000-0000-0000-0000-0000000034a1' AND venta_id = '00000000-0000-0000-0000-000000340001' AND guia_id IS NOT NULL)
    AND bool_or(paquete_id = '00000000-0000-0000-0000-0000000034f2' AND ubicacion_id = '00000000-0000-0000-0000-0000000034e2' AND docenas = 6)
  FROM movimientos_stock WHERE tipo = 'salida_venta' AND venta_id = '00000000-0000-0000-0000-000000340001'), 'una salida por saco, desde su salón');
SELECT pg_temp.verificar((SELECT bool_and(estado = 'entregado' AND ubicacion_id IS NULL AND venta_id = '00000000-0000-0000-0000-000000340001')
  FROM paquetes WHERE id IN ('00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034f2', '00000000-0000-0000-0000-0000000034f3')),
  'los sacos quedan entregados');
SELECT pg_temp.verificar((SELECT estado = 'entregado' FROM ventas WHERE id = '00000000-0000-0000-0000-000000340001'), 'la venta queda entregada');
SELECT pg_temp.verificar((SELECT estado = 'almacenado' FROM paquetes WHERE id = '00000000-0000-0000-0000-0000000034f5'), 'un saco no elegido no se toca');

-- Otro pedido no puede usar un saco ya entregado
INSERT INTO ventas (id, codigo_venta, cliente_id, tipo_pago, total_soles, estado) VALUES
  ('00000000-0000-0000-0000-000000340002', 'V-34-2', '00000000-0000-0000-0000-0000000034b1', 'directo', 10, 'pendiente');
INSERT INTO items_venta (venta_id, catalogo_media_id, docenas, precio_docena) VALUES ('00000000-0000-0000-0000-000000340002', '00000000-0000-0000-0000-0000000034c1', 1, 5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT despachar_venta_sacos('00000000-0000-0000-0000-000000340002', 'Shalom', ARRAY['00000000-0000-0000-0000-0000000034f1']::uuid[])$$, 'S34-A1 no está disponible');
RESET ROLE;

-- ── Sin sesión no se ve nada nuevo ─────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM despacho_detalle', 'permission denied');
RESET ROLE;

ROLLBACK;
