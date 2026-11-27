-- Pruebas de la migración 035 (Ventas no vende crudos ni más de lo que hay para vender).
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

CREATE FUNCTION pg_temp.vender(p_media TEXT, p_docenas NUMERIC) RETURNS JSONB LANGUAGE sql AS $$
  SELECT registrar_venta('{"nombre":"Cliente 35","numero_documento":"35353535"}'::jsonb, '00000000-0000-0000-0000-0000000035a1', 'directo', 0,
    jsonb_build_array(jsonb_build_object('catalogo_media_id', p_media, 'docenas', p_docenas, 'precio_docena', 10)), NULL, 'efectivo')
$$;

-- ── Vista: permisos exactos y modo invoker ──────────────────────────────────
SELECT pg_temp.verificar(pg_temp.permisos('vista_stock_vendible', 'authenticated') = 'SELECT', 'con sesión la vista solo se lee'),
       pg_temp.verificar(pg_temp.permisos('vista_stock_vendible', 'anon') = '-', 'nada para anon');
SELECT pg_temp.verificar((SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.vista_stock_vendible'::regclass),
  'la vista consulta con los permisos de quien pregunta');

-- ── Ventas simultáneas: el cerrojo se toma antes de leer el stock ────────────
-- (una prueba con dos sesiones no cabe en este archivo; se comprueba el orden en el código)
SELECT pg_temp.verificar((SELECT position('pg_advisory_xact_lock(hashtext(''durey_stock_venta''))' IN prosrc) BETWEEN 1 AND position('vista_stock_vendible' IN prosrc)
  FROM pg_proc WHERE oid = 'public.registrar_venta(jsonb, uuid, text, numeric, jsonb, jsonb, text)'::regprocedure),
  'registrar_venta toma el cerrojo de stock antes de leer lo que hay para vender');

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000035a1', 'Vende 035', 've035@test', 'vendedora', true, 'disponible');
INSERT INTO catalogo_medias (id, codigo, sku, modelo, publico, diseno_color, talla) VALUES
  ('00000000-0000-0000-0000-0000000035c1', 'T35-A', 'SKU-35A', 'M35', 'adulto', 'Azul', 'L'),
  ('00000000-0000-0000-0000-0000000035c2', 'T35-B', 'SKU-35B', 'M35', 'adulto', 'Rojo', 'L'),
  -- Orden de código contrario al de id, para fijar que el aviso sigue el código
  ('00000000-0000-0000-0000-0000000035d4', 'T35-Z1', 'SKU-35Z1', 'M35', 'adulto', 'Gris', 'L'),
  ('00000000-0000-0000-0000-0000000035d3', 'T35-Z2', 'SKU-35Z2', 'M35', 'adulto', 'Negro', 'L'),
  ('00000000-0000-0000-0000-0000000035d2', 'T35-Z3', 'SKU-35Z3', 'M35', 'adulto', 'Verde', 'L'),
  ('00000000-0000-0000-0000-0000000035d1', 'T35-Z4', 'SKU-35Z4', 'M35', 'adulto', 'Lila', 'L');
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES
  ('00000000-0000-0000-0000-0000000035c9', 'CRU-35', 'M35', 'adulto', 'CRUDO', 'L', true);
INSERT INTO ubicaciones (id, nombre, tipo, activo) VALUES ('00000000-0000-0000-0000-0000000035e1', 'Salón 35', 'salon', true);
INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, total_pares, estado, ubicacion_id) VALUES
  ('S35-1', '00000000-0000-0000-0000-0000000035c1', 6, 72, 'almacenado', '00000000-0000-0000-0000-0000000035e1'),
  ('S35-2', '00000000-0000-0000-0000-0000000035c1', 4, 48, 'pendiente_almacenar', NULL),
  ('S35-3', '00000000-0000-0000-0000-0000000035c1', 9, 108, 'entregado', NULL),
  ('S35-C', '00000000-0000-0000-0000-0000000035c9', 5, 60, 'almacenado', '00000000-0000-0000-0000-0000000035e1');

SELECT pg_temp.verificar((SELECT fisico = 10 AND comprometidas = 0 AND vendibles = 10 FROM vista_stock_vendible
  WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c1'), 'físico = almacenado + por almacenar (no los entregados)');
SELECT pg_temp.verificar((SELECT vendibles = 0 FROM vista_stock_vendible WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c2'),
  'un producto sin sacos aparece con 0');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM vista_stock_vendible WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c9'),
  'los crudos no aparecen en la vista');

-- ── Vender ─────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000035a1', true);
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c9', 1)$$, 'No se vende CRU-35: es un producto crudo');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c2', 1)$$, 'No hay stock suficiente de T35-B');
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 10.5)$$, 'pides 10.5 docenas y hay 10.00 para vender');
-- Dos líneas del mismo producto se suman
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"C","numero_documento":"35353536"}'::jsonb, '00000000-0000-0000-0000-0000000035a1', 'directo', 0,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000035c1","docenas":6,"precio_docena":1},{"catalogo_media_id":"00000000-0000-0000-0000-0000000035c1","docenas":5,"precio_docena":1}]'::jsonb, NULL, 'efectivo')$$,
  'pides 11 docenas');
-- Con dos productos sin stock, avisa del primero por código (no por id)
SELECT pg_temp.debe_fallar($$SELECT registrar_venta('{"nombre":"C","numero_documento":"35353537"}'::jsonb, '00000000-0000-0000-0000-0000000035a1', 'directo', 0,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000035d1","docenas":4,"precio_docena":1},{"catalogo_media_id":"00000000-0000-0000-0000-0000000035d3","docenas":2,"precio_docena":1},
    {"catalogo_media_id":"00000000-0000-0000-0000-0000000035d2","docenas":3,"precio_docena":1},{"catalogo_media_id":"00000000-0000-0000-0000-0000000035d4","docenas":1,"precio_docena":1}]'::jsonb, NULL, 'efectivo')$$,
  'No hay stock suficiente de T35-Z1:');
-- Exactamente lo que hay sí se vende
SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 8);
RESET ROLE;
SELECT pg_temp.verificar((SELECT fisico = 10 AND comprometidas = 8 AND vendibles = 2 FROM vista_stock_vendible
  WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c1'), 'lo vendido sin despachar queda comprometido');

SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 3)$$, 'pides 3 docenas y hay 2.00 para vender');
SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 2);
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 0.5)$$, 'hay 0.00 para vender');
RESET ROLE;

-- Al entregar una venta, lo suyo deja de estar comprometido (y sus sacos salen del físico)
UPDATE ventas SET estado = 'entregado' WHERE codigo_venta = (SELECT min(codigo_venta) FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE c.numero_documento = '35353535');
SELECT pg_temp.verificar((SELECT comprometidas = 2 FROM vista_stock_vendible WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c1'),
  'solo las ventas pendientes comprometen stock');
-- Con lo sobrevendido de antes, el saldo puede quedar negativo y no deja vender
UPDATE paquetes SET estado = 'entregado' WHERE codigo_paquete IN ('S35-1', 'S35-2');
SELECT pg_temp.verificar((SELECT vendibles = -2 FROM vista_stock_vendible WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000035c1'), 'saldo negativo visible');
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT pg_temp.vender('00000000-0000-0000-0000-0000000035c1', 1)$$, 'hay 0 para vender');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM vista_stock_vendible', 'permission denied');
RESET ROLE;

ROLLBACK;
