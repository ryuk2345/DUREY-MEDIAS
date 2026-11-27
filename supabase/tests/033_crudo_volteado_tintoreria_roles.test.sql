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
  ('00000000-0000-0000-0000-0000000033c2', 'T33-AZUL-M', NULL, 'Modelo33', 'adulto', 'Azul', 'M', false);
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
SELECT finalizar_lote_remallado((SELECT id FROM t_lc), 4, 0, NULL, '00000000-0000-0000-0000-0000000033a2', '00000000-0000-0000-0000-0000000033d2');
SELECT pg_temp.debe_fallar($$SELECT finalizar_lote_remallado((SELECT id FROM t_lr), 1, 0, NULL, NULL, NULL)$$, 'ya no está en proceso');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 10 FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'remallado crudo: 10 por voltear');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'lo crudo no va a planchado');
SELECT pg_temp.verificar((SELECT docenas = 4 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c1'), 'un lote con color sigue a por planchar');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000033d1'), 'la máquina se libera');

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
SELECT pg_temp.verificar((SELECT count(*) = 2 AND sum(docenas_volteadas) = 8 AND bool_or(comentarios = 'bien') FROM reportes_volteado WHERE lote_volteado_id = (SELECT id FROM t_lv)),
  'dos reportes de volteado');

-- ── Tintorería ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a4');  -- tintorero
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033c1', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'media cruda');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c0', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$, 'SKU de color');
SELECT pg_temp.debe_fallar($$SELECT enviar_lote_tintoreria('00000000-0000-0000-0000-0000000033c0', '00000000-0000-0000-0000-0000000033c2', 'algodon', 1, '00000000-0000-0000-0000-0000000033a2')$$,
  'El SKU T33-AZUL-M no es de la misma media');
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
SELECT recibir_lote_tintoreria((SELECT id FROM t_lt2), 3, NULL);
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas_merma = 0 AND motivo_merma IS NULL FROM lotes_tintoreria WHERE id = (SELECT id FROM t_lt2)), 'sin merma, sin motivo');

-- ── Stock de fuera en las etapas nuevas ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000033a1');  -- administrador
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c1', 5, 'x')$$, 'elige la media cruda');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000033c0', 5, 'x')$$, 'elige su SKU de color');
SELECT ingresar_stock_fuera('volteado', '00000000-0000-0000-0000-0000000033c0', 5, 'Taller');
SELECT ingresar_stock_fuera('tintoreria', '00000000-0000-0000-0000-0000000033c0', 6, 'Otro taller');
SELECT ingresar_stock_fuera('remallado', '00000000-0000-0000-0000-0000000033c0', 7, 'Tejido fuera');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 7 FROM stock_listo_voltear WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'de fuera en volteado: 2 + 5 por voltear');
SELECT pg_temp.verificar((SELECT docenas = 6 FROM stock_listo_tenir WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'de fuera en tintorería: 6 por teñir');
SELECT pg_temp.verificar((SELECT count(*) = 3 AND bool_and(registrado_por = '00000000-0000-0000-0000-0000000033a1') FROM ingresos_stock_fuera
  WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000033c0'), 'los tres ingresos quedan registrados, remallado incluido');

-- ── Sin sesión no se ve nada nuevo ─────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM lotes_tintoreria', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM stock_listo_tenir', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM modulos_por_rol', 'permission denied');
RESET ROLE;

ROLLBACK;
