-- Pruebas de la migración 033 (crudo, Volteado, Tintorería y bloqueo por rol) en un Postgres de PRUEBA.
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
SELECT pg_temp.verificar((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
  ('public.modulos_por_rol'::regclass, 'public.stock_listo_tenir'::regclass, 'public.lotes_tintoreria'::regclass)), 'tablas nuevas con RLS');
SELECT pg_temp.verificar((SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'durey_usuarios_con_sesion'
  AND tablename IN ('modulos_por_rol', 'stock_listo_tenir', 'lotes_tintoreria')), 'tablas nuevas con la política de sesión');
SELECT pg_temp.verificar(pg_temp.permisos(t, 'authenticated') = 'SELECT', t || ': con sesión solo se lee (' || pg_temp.permisos(t, 'authenticated') || ')'),
       pg_temp.verificar(pg_temp.permisos(t, 'anon') = '-', t || ': nada para anon')
  FROM unnest(ARRAY['modulos_por_rol', 'stock_listo_tenir', 'lotes_tintoreria',
                    'turnos_produccion', 'turno_maquinas', 'reportes_produccion', 'lotes_remallado', 'reportes_remallado',
                    'stock_listo_voltear', 'lotes_volteado', 'reportes_volteado', 'stock_listo_planchar', 'reportes_planchado']) AS t;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['modulos_por_rol', 'stock_listo_tenir', 'lotes_tintoreria']) t
                WHERE has_table_privilege('authenticated', 'public.' || t, 'MAINTAIN')) THEN
      RAISE EXCEPTION 'FALLO: authenticated tiene MAINTAIN en una tabla nueva';
    END IF;
  END IF;
END $$;
SELECT pg_temp.verificar(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon no ejecuta ' || f),
       pg_temp.verificar(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ejecuta ' || f),
       pg_temp.verificar((SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = f::regprocedure), f || ' con search_path fijo')
  FROM unnest(ARRAY[
    'public.iniciar_lote_volteado(uuid, uuid, numeric)',
    'public.reportar_lote_volteado(uuid, numeric, integer, text)',
    'public.enviar_lote_tintoreria(uuid, uuid, text, numeric, uuid)',
    'public.recibir_lote_tintoreria(uuid, numeric, text)',
    'public.iniciar_lote_remallado(uuid, uuid, uuid, numeric)',
    'public.traspasar_lote_remallado(uuid, uuid, uuid, numeric)',
    'public.finalizar_lote_remallado(uuid, numeric, numeric, uuid, uuid, uuid)',
    'public.ingresar_stock_fuera(text, uuid, numeric, text)'
  ]) AS f;
SELECT pg_temp.verificar(NOT has_function_privilege(r, 'public.exigir_modulo(text)', 'EXECUTE'), r || ' no llama a exigir_modulo'),
       pg_temp.verificar(NOT has_function_privilege(r, 'public.crear_crudos_faltantes()', 'EXECUTE'), r || ' no crea crudos'),
       pg_temp.verificar(NOT has_table_privilege(r, 'public.paquetes', 'INSERT'), r || ' no inserta sacos directo'),
       pg_temp.verificar(NOT has_function_privilege(r, 'public.cargar_lote_produccion(uuid, text, integer, jsonb)', 'EXECUTE'), r || ': el tejido anterior ya no se llama'),
       pg_temp.verificar(NOT has_function_privilege(r, 'public.cerrar_turno_produccion(uuid, jsonb)', 'EXECUTE'), r || ': el cierre anterior ya no se llama')
  FROM unnest(ARRAY['anon', 'authenticated']) AS r;

-- Módulos por rol (la prueba de TypeScript compara la tabla entera con MODULOS_POR_ROL)
SELECT pg_temp.verificar(EXISTS (SELECT 1 FROM modulos_por_rol WHERE rol = 'tintorero' AND modulo = 'tintoreria'), 'tintorero → tintorería');
SELECT pg_temp.verificar((SELECT count(*) = 4 FROM modulos_por_rol WHERE modulo IN ('volteado', 'tintoreria') AND rol IN ('admin', 'supervisor')),
  'administrador y supervisor ven Volteado y Tintorería');
SELECT pg_temp.verificar(EXISTS (SELECT 1 FROM modulos_por_rol WHERE rol = 'operador' AND modulo = 'tintoreria')
  AND NOT EXISTS (SELECT 1 FROM modulos_por_rol WHERE rol = 'planchador' AND modulo = 'tintoreria'), 'operador sí, planchador no');

-- Crudos creados por la migración: uno por modelo, público y talla
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM catalogo_medias WHERE es_crudo GROUP BY modelo, publico, talla HAVING count(*) > 1), 'un solo crudo por grupo');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM catalogo_medias WHERE es_crudo AND (diseno_color <> 'CRUDO' OR sku IS NOT NULL)), 'crudos con color CRUDO y sin SKU');

-- Crear crudos sobre datos: un crudo por grupo, código único aunque choquen mayúsculas, color CRUDO, activo
INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, peso_docena_g, estado) VALUES
  ('G33-ROJO', 'Grupo 33', 'niño', 'Rojo', 'S', 300, 'inactivo'),
  ('G33-AZUL', 'Grupo 33', 'niño', 'Azul', 'S', 310, 'activo'),
  ('G33-MIN', 'grupo 33', 'niño', 'Rojo', 'S', 300, 'activo');
SELECT pg_temp.verificar(crear_crudos_faltantes() = 2, 'dos grupos (Grupo 33 y grupo 33) → dos crudos');
SELECT pg_temp.verificar(crear_crudos_faltantes() = 0, 'la segunda vez no crea nada');
SELECT pg_temp.verificar((SELECT count(*) = 2 AND count(DISTINCT codigo) = 2 AND bool_and(diseno_color = 'CRUDO' AND estado = 'activo' AND sku IS NULL)
    -- (upper() de la ñ depende del idioma de la base: se compara sin ella)
    AND bool_or(codigo LIKE 'CRUDO-GRUPO-33-NI_O-S') AND bool_or(codigo LIKE 'CRUDO-GRUPO-33-NI_O-S-2')
  FROM catalogo_medias WHERE es_crudo AND lower(modelo) = 'grupo 33'), 'crudos con código único, color CRUDO, activos y sin SKU');
SELECT pg_temp.verificar((SELECT peso_docena_g = 310 FROM catalogo_medias WHERE es_crudo AND modelo = 'Grupo 33'), 'toma el peso del primero del grupo por código');
SELECT pg_temp.debe_fallar($$INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES ('OTRO-CRUDO', 'Grupo 33', 'niño', 'CRUDO', 'S', true)$$,
  'catalogo_medias_un_crudo_uq');

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000033a1', 'Admin 033', 'a033@test', 'admin', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a2', 'Rema 033', 'r033@test', 'remalladora', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a3', 'Volt 033', 'v033@test', 'volteador', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a4', 'Tinto 033', 't033@test', 'tintorero', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a5', 'Plancha 033', 'p033@test', 'planchador', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a6', 'Tinto Baja', 'tb033@test', 'tintorero', false, 'disponible');
INSERT INTO catalogo_medias (id, codigo, sku, modelo, publico, diseno_color, talla, es_crudo) VALUES
  ('00000000-0000-0000-0000-0000000033c0', 'T33-CRUDO', NULL, 'Modelo33', 'adulto', 'CRUDO', 'L', true),
  ('00000000-0000-0000-0000-0000000033c1', 'T33-AZUL-L', 'SKU-T33A', 'Modelo33', 'adulto', 'Azul', 'L', false),
  ('00000000-0000-0000-0000-0000000033c2', 'T33-AZUL-M', NULL, 'Modelo33', 'adulto', 'Azul', 'M', false),
  ('00000000-0000-0000-0000-0000000033c3', 'T33-AZUL-NINO', NULL, 'Modelo33', 'niño', 'Azul', 'L', false),
  ('00000000-0000-0000-0000-0000000033c4', 'T33-OTRO-MOD', NULL, 'Otro33', 'adulto', 'Azul', 'L', false),
  ('00000000-0000-0000-0000-0000000033c5', 'T33-VERDE-L', NULL, 'Modelo33', 'adulto', 'Verde', 'L', false);
UPDATE catalogo_medias SET estado = 'inactivo' WHERE id = '00000000-0000-0000-0000-0000000033c5';
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000033d1', 'R3301', 'remalladora', 'activa'),
  ('00000000-0000-0000-0000-0000000033d2', 'R3302', 'remalladora', 'activa');

-- ── Bloqueo por rol ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion(NULL);
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000033d1', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033c0', 12)$$,
  'Tu rol no tiene acceso al módulo remallado');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a5');  -- planchador
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000033d1', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033c0', 12)$$,
  'Tu rol no tiene acceso al módulo remallado');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000033a5', '[]')$$, 'módulo produccion');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000033a5', 'X', NULL, '[]', 'qr')$$, 'módulo preparado');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('tintoreria', '00000000-0000-0000-0000-0000000033c0', 5, 'x')$$, 'módulo tintoreria');
SELECT pg_temp.debe_fallar($$SELECT traspasar_lote_remallado('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033d2', 1)$$, 'módulo remallado');
SELECT pg_temp.debe_fallar($$SELECT finalizar_lote_remallado('00000000-0000-0000-0000-000000000000', 1, 0, NULL, NULL, NULL)$$, 'módulo remallado');
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-0000000033c0', 1)$$, 'módulo volteado');
SELECT pg_temp.debe_fallar($$SELECT reportar_lote_volteado('00000000-0000-0000-0000-000000000000', 1, 0, NULL)$$, 'módulo volteado');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'módulo tintoreria');
SELECT pg_temp.debe_fallar($$SELECT recibir_lote_tintoreria('00000000-0000-0000-0000-000000000000', 1, NULL)$$, 'módulo tintoreria');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a6');  -- tintorero dado de baja
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('tintoreria', '00000000-0000-0000-0000-0000000033c0', 5, 'x')$$, 'módulo tintoreria');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a3');  -- volteador: no planchado
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_planchado('[{"catalogo_media_id":"00000000-0000-0000-0000-0000000033c1","docenas_planchadas":1}]')$$, 'módulo planchado');
-- Sin escritura directa en las tablas de proceso
DO $$
BEGIN
  BEGIN
    INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033c1', 99);
    RAISE EXCEPTION 'FALLO: con sesión se escribió stock por planchar sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE lotes_remallado SET docenas_pendientes = 0;
    RAISE EXCEPTION 'FALLO: con sesión se cambió un lote de remallado sin función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ── Remallado crudo → por voltear ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a2');  -- remalladora
CREATE TEMP TABLE t_lr ON COMMIT DROP AS
  SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000033d1', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033c0', 12) AS id;
CREATE TEMP TABLE t_lc ON COMMIT DROP AS
  SELECT iniciar_lote_remallado('00000000-0000-0000-0000-0000000033d2', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033c1', 4) AS id;
SELECT pg_temp.debe_fallar($$SELECT finalizar_lote_remallado((SELECT id FROM t_lr), 13, 0, '00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033d1')$$,
  'tiene 12.00 pendientes');
SELECT pg_temp.debe_fallar($$SELECT finalizar_lote_remallado((SELECT id FROM t_lr), -1, 0, NULL, NULL, NULL)$$, 'negativas');
-- El producto sale del lote, no del parámetro (aquí se manda otro a propósito)
SELECT finalizar_lote_remallado((SELECT id FROM t_lr), 10, 2, '00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033d1');
SELECT finalizar_lote_remallado((SELECT id FROM t_lc), 4, 0, '00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033d2');
SELECT pg_temp.debe_fallar($$SELECT finalizar_lote_remallado((SELECT id FROM t_lr), 1, 0, NULL, NULL, NULL)$$, 'ya no está en proceso');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 10 FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'remallado crudo: 10 por voltear');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'lo crudo no va a planchado');
SELECT pg_temp.verificar((SELECT docenas = 4 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c1'), 'un lote con color sigue a por planchar');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000033d1'), 'la máquina se libera');
SELECT pg_temp.verificar((SELECT estado = 'disponible' FROM usuarios WHERE id = '00000000-0000-0000-0000-0000000033a2'), 'la remalladora queda disponible');

-- ── Volteado ───────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a3');  -- volteador
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-0000000033c0', 11)$$,
  'No hay suficiente stock por voltear de T33-CRUDO: se asignan 11 docenas y hay 10.00');
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a6', '00000000-0000-0000-0000-0000000033c0', 1)$$, 'quién voltea');
SELECT pg_temp.debe_fallar($$SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-0000000033c0', 0)$$, 'mayores a 0');
CREATE TEMP TABLE t_lv ON COMMIT DROP AS
  SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-0000000033c0', 8) AS id;
SELECT reportar_lote_volteado((SELECT id FROM t_lv), 5, 2, ' bien ');
SELECT pg_temp.debe_fallar($$SELECT reportar_lote_volteado((SELECT id FROM t_lv), 4, 0, NULL)$$, 'tiene 3.00 pendientes');
SELECT pg_temp.debe_fallar($$SELECT reportar_lote_volteado((SELECT id FROM t_lv), 1, -1, NULL)$$, 'defectuosos');
SELECT reportar_lote_volteado((SELECT id FROM t_lv), 3, 0, NULL);
SELECT pg_temp.debe_fallar($$SELECT reportar_lote_volteado((SELECT id FROM t_lv), 1, 0, NULL)$$, 'ya está completado');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 2 FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'voltear 8 de 10 deja 2');
SELECT pg_temp.verificar((SELECT docenas = 8 FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'lo volteado crudo queda por teñir');
SELECT pg_temp.verificar((SELECT estado = 'completado' AND docenas_pendientes = 0 FROM lotes_volteado WHERE id = (SELECT id FROM t_lv)), 'lote de volteado completado');
SELECT pg_temp.verificar((SELECT count(*) = 2 AND sum(docenas_volteadas) = 8 AND bool_or(comentarios = 'bien') AND sum(pares_defectuosos) = 2
  FROM reportes_volteado WHERE lote_volteado_id = (SELECT id FROM t_lv)), 'dos reportes de volteado, con sus pares defectuosos');
INSERT INTO stock_listo_voltear (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033c2', 3);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_lvc ON COMMIT DROP AS
  SELECT iniciar_lote_volteado('00000000-0000-0000-0000-0000000033a3', '00000000-0000-0000-0000-0000000033c2', 3) AS id;
SELECT reportar_lote_volteado((SELECT id FROM t_lvc), 3, 0, NULL);
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 3 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c2')
  AND NOT EXISTS (SELECT 1 FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c2'), 'volteado de una media con color va a por planchar');

-- ── Tintorería ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a4');  -- tintorero
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'media cruda');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c0', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'SKU de color');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c2', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$,
  'El SKU T33-AZUL-M no es de la misma media');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c3', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'no es de la misma media');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c4', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'no es de la misma media');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c5', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'T33-VERDE-L está inactivo');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'lana', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'algodón o poliéster');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1, NULL)$$, 'que remalló');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'algodon', 9, '00000000-0000-0000-0000-0000000033a2')$$,
  'No hay suficiente stock por teñir de T33-CRUDO: se envían 9 docenas y hay 8.00');
CREATE TEMP TABLE t_lt ON COMMIT DROP AS
  SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'poliester', 8, '00000000-0000-0000-0000-0000000033a2') AS id;
SELECT pg_temp.debe_fallar($$SELECT recibir_lote_tintoreria((SELECT id FROM t_lt), 9, NULL)$$, 'Se reciben 9.00 docenas y se enviaron 8.00');
SELECT pg_temp.debe_fallar($$SELECT recibir_lote_tintoreria((SELECT id FROM t_lt), 7, '  ')$$, 'Faltan 1.00 docenas: indica el motivo de la merma');
SELECT pg_temp.debe_fallar($$SELECT recibir_lote_tintoreria((SELECT id FROM t_lt), 'NaN', 'x')$$, 'docenas recibidas');
SELECT recibir_lote_tintoreria((SELECT id FROM t_lt), 7, ' manchada ');
SELECT pg_temp.debe_fallar($$SELECT recibir_lote_tintoreria((SELECT id FROM t_lt), 7, 'x')$$, 'ya fue recibido');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 0 FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'enviar 8 deja 0 por teñir');
SELECT pg_temp.verificar((SELECT docenas = 11 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c1'),
  'las 7 recibidas entran por planchar con su SKU de color (4 + 7)');
SELECT pg_temp.verificar((SELECT estado = 'recibido' AND docenas_recibidas = 7 AND docenas_merma = 1 AND motivo_merma = 'manchada' AND material = 'poliester'
    AND enviado_por = '00000000-0000-0000-0000-0000000033a4' AND recibido_por = '00000000-0000-0000-0000-0000000033a4'
    AND remalladora_id = '00000000-0000-0000-0000-0000000033a2' AND fecha_recepcion IS NOT NULL
  FROM lotes_tintoreria WHERE id = (SELECT id FROM t_lt)), 'el lote guarda recepción, merma con motivo y quién');
-- Sin merma no hace falta motivo
INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033c0', 3)
  ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = 3;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_lt2 ON COMMIT DROP AS
  SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'algodon', 3, '00000000-0000-0000-0000-0000000033a2') AS id;
SELECT recibir_lote_tintoreria((SELECT id FROM t_lt2), 3, 'no hacía falta');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas_merma = 0 AND motivo_merma IS NULL FROM lotes_tintoreria WHERE id = (SELECT id FROM t_lt2)), 'sin merma, sin motivo');

-- ── Stock de fuera en las etapas nuevas ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a1');  -- administrador
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c1', 5, 'x')$$, 'elige la media cruda');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000033c0', 5, 'x')$$, 'elige su SKU de color');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('preparado', '00000000-0000-0000-0000-0000000033c0', 5, 'x')$$, 'elige su SKU de color');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('remallado', '00000000-0000-0000-0000-0000000033c1', 5, 'x')$$, 'elige la media cruda');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('tintoreria', '00000000-0000-0000-0000-0000000033c1', 5, 'x')$$, 'elige la media cruda');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c0', 100000.01, 'x')$$, 'mayores a 0');
SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c0', 5, 'Taller');
SELECT ingresar_stock_fuera('tintoreria', '00000000-0000-0000-0000-0000000033c0', 6, 'Otro taller');
SELECT ingresar_stock_fuera('remallado', '00000000-0000-0000-0000-0000000033c0', 7, 'Tejido fuera');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 7 FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'de fuera en volteado: 2 + 5 por voltear');
SELECT pg_temp.verificar((SELECT docenas = 6 FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'de fuera en tintorería: 6 por teñir');
SELECT pg_temp.verificar((SELECT count(*) = 3 AND bool_and(registrado_por = '00000000-0000-0000-0000-0000000033a1') FROM ingresos_stock_fuera
  WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'los tres ingresos quedan registrados, remallado incluido');

-- ── Marcar o desmarcar "cruda" ─────────────────────────────────────────────
GRANT UPDATE ON catalogo_medias TO authenticated;  -- como en la base real (la pantalla de Catálogo escribe directo)
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a5');  -- planchador: sin módulo Catálogo
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET es_crudo = true WHERE id = '00000000-0000-0000-0000-0000000033c4'$$, 'módulo catalogo');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a1');  -- administrador
-- Con stock por voltear (7) no se desmarca
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET es_crudo = false WHERE id = '00000000-0000-0000-0000-0000000033c0'$$, 'tiene stock, lotes en proceso');
-- Con stock por planchar (11) no se marca
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET es_crudo = true WHERE id = '00000000-0000-0000-0000-0000000033c1'$$, 'tiene stock, lotes en proceso');
-- Sin stock ni lotes sí se puede, y otros cambios no pasan por la regla
UPDATE catalogo_medias SET es_crudo = true WHERE id = '00000000-0000-0000-0000-0000000033c4';
UPDATE catalogo_medias SET costo_produccion_docena = 5 WHERE id = '00000000-0000-0000-0000-0000000033c1';
RESET ROLE;
SELECT pg_temp.verificar((SELECT es_crudo FROM catalogo_medias WHERE id = '00000000-0000-0000-0000-0000000033c4'), 'con el módulo y sin stock se marca cruda');

-- ── La regla de "cruda", condición por condición ───────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000033a7', 'Catálogo Baja', 'cb033@test', 'disenador', false, 'disponible'),
  ('00000000-0000-0000-0000-0000000033a8', 'Diseñadora 033', 'd033@test', 'disenador', true, 'disponible');
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES
  ('00000000-0000-0000-0000-0000000033e1', 'T33-PRUEBA', 'Prueba33', 'adulto', 'Gris', 'XL', false);
GRANT INSERT ON catalogo_medias TO authenticated;  -- como en la base real (la pantalla de Catálogo inserta directo)

CREATE FUNCTION pg_temp.cambiar_crudo() RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000033a8', true);
    UPDATE catalogo_medias SET es_crudo = NOT es_crudo WHERE id = '00000000-0000-0000-0000-0000000033e1';
    RESET ROLE;
    RAISE EXCEPTION 'cambiado';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN SQLERRM;
  END;
END $$;

-- Sin nada pendiente sí se puede (el cambio se deshace: la función siempre revierte)
SELECT pg_temp.verificar(pg_temp.cambiar_crudo() = 'cambiado', 'sin stock ni lotes se puede cambiar');
-- Un stock en 0 no bloquea
INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 0);
INSERT INTO stock_listo_voltear (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 0);
INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 0);
INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 0);
SELECT pg_temp.verificar(pg_temp.cambiar_crudo() = 'cambiado', 'un stock en 0 (en cualquier etapa) no bloquea');
DELETE FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1';
DELETE FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1';
DELETE FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1';
DELETE FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1';
-- Un lote de tintorería ya recibido no bloquea
INSERT INTO lotes_tintoreria (id, crudo_id, color_id, material, docenas_enviadas, estado, docenas_recibidas, docenas_merma)
  VALUES ('00000000-0000-0000-0000-0000000033f5', '00000000-0000-0000-0000-0000000033e1', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1, 'recibido', 1, 0);
SELECT pg_temp.verificar(pg_temp.cambiar_crudo() = 'cambiado', 'un lote de tintorería ya recibido no bloquea');
DELETE FROM lotes_tintoreria WHERE id = '00000000-0000-0000-0000-0000000033f5';

-- Cada condición por separado bloquea
CREATE FUNCTION pg_temp.bloquea(p_sql TEXT, p_deshacer TEXT, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  IF position('tiene stock, lotes en proceso' IN pg_temp.cambiar_crudo()) = 0 THEN
    RAISE EXCEPTION 'FALLO: % no bloquea el cambio', p_msg;
  END IF;
  EXECUTE p_deshacer;
END $$;
SELECT pg_temp.bloquea($$INSERT INTO stock_listo_voltear (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 1)$$,
  $$DELETE FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1'$$, 'stock por voltear');
SELECT pg_temp.bloquea($$INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 1)$$,
  $$DELETE FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1'$$, 'stock por teñir');
SELECT pg_temp.bloquea($$INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 1)$$,
  $$DELETE FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1'$$, 'stock por planchar');
SELECT pg_temp.bloquea($$INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 1)$$,
  $$DELETE FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033e1'$$, 'stock por preparar');
SELECT pg_temp.bloquea($$INSERT INTO lotes_remallado (id, catalogo_media_id, maquina_remalladora_id, docenas_asignadas, docenas_pendientes, estado)
    VALUES ('00000000-0000-0000-0000-0000000033f1', '00000000-0000-0000-0000-0000000033e1', '00000000-0000-0000-0000-0000000033d1', 1, 1, 'en_proceso')$$,
  $$DELETE FROM lotes_remallado WHERE id = '00000000-0000-0000-0000-0000000033f1'$$, 'lote de remallado en proceso');
SELECT pg_temp.bloquea($$INSERT INTO lotes_volteado (id, catalogo_media_id, docenas_asignadas, docenas_pendientes, estado)
    VALUES ('00000000-0000-0000-0000-0000000033f2', '00000000-0000-0000-0000-0000000033e1', 1, 1, 'en_proceso')$$,
  $$DELETE FROM lotes_volteado WHERE id = '00000000-0000-0000-0000-0000000033f2'$$, 'lote de volteado en proceso');
SELECT pg_temp.bloquea($$INSERT INTO lotes_tintoreria (id, crudo_id, color_id, material, docenas_enviadas)
    VALUES ('00000000-0000-0000-0000-0000000033f3', '00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033e1', 'algodon', 1)$$,
  $$DELETE FROM lotes_tintoreria WHERE id = '00000000-0000-0000-0000-0000000033f3'$$, 'lote en tintorería');
SELECT pg_temp.bloquea($$INSERT INTO lotes_tintoreria (id, crudo_id, color_id, material, docenas_enviadas)
    VALUES ('00000000-0000-0000-0000-0000000033f6', '00000000-0000-0000-0000-0000000033e1', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1)$$,
  $$DELETE FROM lotes_tintoreria WHERE id = '00000000-0000-0000-0000-0000000033f6'$$, 'lote en tintorería como media cruda');
SELECT pg_temp.bloquea($$INSERT INTO productos_maquina (id, maquina_id, catalogo_media_id) VALUES ('00000000-0000-0000-0000-0000000033f4', '00000000-0000-0000-0000-0000000033d1', '00000000-0000-0000-0000-0000000033e1')$$,
  $$DELETE FROM productos_maquina WHERE id = '00000000-0000-0000-0000-0000000033f4'$$, 'una máquina que la teje');
-- Un producto que la máquina ya no teje (hasta con fecha) no bloquea
INSERT INTO productos_maquina (maquina_id, catalogo_media_id, desde, hasta) VALUES ('00000000-0000-0000-0000-0000000033d1', '00000000-0000-0000-0000-0000000033e1', NOW() - interval '2 days', NOW() - interval '1 day');
SELECT pg_temp.verificar(pg_temp.cambiar_crudo() = 'cambiado', 'una asignación cerrada no bloquea');
INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033e1', 5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a8');  -- diseñadora (Catálogo)
UPDATE catalogo_medias SET es_crudo = es_crudo, diseno_color = 'Gris oscuro' WHERE id = '00000000-0000-0000-0000-0000000033e1';
INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES ('ALTA-CRUDO-33', 'Alta33', 'adulto', 'CRUDO', 'S', true);
RESET ROLE;
SELECT pg_temp.verificar((SELECT diseno_color = 'Gris oscuro' FROM catalogo_medias WHERE id = '00000000-0000-0000-0000-0000000033e1'), 'guardar sin cambiar la marca no pasa por la regla, aunque haya stock');
SELECT pg_temp.verificar((SELECT es_crudo FROM catalogo_medias WHERE codigo = 'ALTA-CRUDO-33'), 'quien tiene Catálogo da de alta una media cruda');

-- Rol: usuario de Catálogo dado de baja no puede; un alta con color sin Catálogo sí (no pasa por la regla)
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a7');
SELECT pg_temp.debe_fallar($$UPDATE catalogo_medias SET es_crudo = true WHERE id = '00000000-0000-0000-0000-0000000033e1'$$, 'módulo catalogo');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a5');  -- planchador
SELECT pg_temp.debe_fallar($$INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES ('NUEVO-CRUDO-33', 'Nuevo33', 'adulto', 'CRUDO', 'S', true)$$, 'módulo catalogo');
INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, es_crudo) VALUES ('NUEVO-COLOR-33', 'Nuevo33', 'adulto', 'Azul', 'S', false);
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a1');
-- Tope del stock de fuera: exactamente 100 000 se acepta
SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c0', 100000, 'Inventario inicial');
RESET ROLE;
SELECT pg_temp.verificar(EXISTS (SELECT 1 FROM catalogo_medias WHERE codigo = 'NUEVO-COLOR-33'), 'un alta con color no necesita Catálogo en la regla');

-- Recibir 0,004 docenas: se redondea a 0, todo es merma y no entra nada a planchado
INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033c0', 2)
  ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = 2;
CREATE TEMP TABLE t_pl ON COMMIT DROP AS SELECT docenas FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c1';
INSERT INTO catalogo_medias (id, codigo, modelo, publico, diseno_color, talla) VALUES
  ('00000000-0000-0000-0000-0000000033c6', 'T33-NEGRO-L', 'Modelo33', 'adulto', 'Negro', 'L');
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a4');
CREATE TEMP TABLE t_lt3 ON COMMIT DROP AS
  SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c1', 'algodon', 2, '00000000-0000-0000-0000-0000000033a2') AS id;
SELECT recibir_lote_tintoreria((SELECT id FROM t_lt3), 0.004, 'todo manchado');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas_recibidas = 0 AND docenas_merma = 2 FROM lotes_tintoreria WHERE id = (SELECT id FROM t_lt3)), '0,004 se redondea a 0 y todo es merma');
SELECT pg_temp.verificar((SELECT docenas FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c1') = (SELECT docenas FROM t_pl),
  'no entra nada a por planchar');
INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000033c0', 1)
  ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = 1;
SET LOCAL ROLE authenticated;
SELECT recibir_lote_tintoreria(enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c6', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2'), 0.004, 'perdido');
RESET ROLE;
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c6'),
  'recibir 0,004 de un color sin stock no crea una fila en 0');

-- ── Sin sesión no se ve nada nuevo ─────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM lotes_tintoreria', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM stock_listo_tenir', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM modulos_por_rol', 'permission denied');
RESET ROLE;

ROLLBACK;
