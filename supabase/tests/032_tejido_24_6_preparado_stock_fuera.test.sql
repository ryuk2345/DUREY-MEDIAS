-- Pruebas de la migración 032 (tejido 24/6, preparado, stock de fuera) en un Postgres de PRUEBA.
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

-- Sesión de un usuario de DUREY (auth.uid())
CREATE FUNCTION pg_temp.sesion(p_uid TEXT) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), true)
$$;

-- ── Estructura y permisos exactos ──────────────────────────────────────────
SELECT pg_temp.verificar((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
  ('public.productos_maquina'::regclass, 'public.stock_listo_preparar'::regclass, 'public.reportes_preparado'::regclass, 'public.ingresos_stock_fuera'::regclass)),
  'tablas nuevas con RLS');
SELECT pg_temp.verificar((SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'durey_usuarios_con_sesion'
  AND tablename IN ('productos_maquina', 'stock_listo_preparar', 'reportes_preparado', 'ingresos_stock_fuera')), 'tablas nuevas con la política de sesión');
SELECT pg_temp.verificar(pg_temp.permisos(t, 'authenticated') = 'SELECT', t || ': solo lectura (' || pg_temp.permisos(t, 'authenticated') || ')'),
       pg_temp.verificar(pg_temp.permisos(t, 'anon') = '-', t || ': nada para anon')
  FROM unnest(ARRAY['productos_maquina', 'stock_listo_preparar', 'reportes_preparado', 'ingresos_stock_fuera']) AS t;
-- MAINTAIN solo existe desde Postgres 17 (la base real): IF anidado para no evaluarlo en 16
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['productos_maquina', 'stock_listo_preparar', 'reportes_preparado', 'ingresos_stock_fuera']) t
                WHERE has_table_privilege('authenticated', 'public.' || t, 'MAINTAIN')) THEN
      RAISE EXCEPTION 'FALLO: authenticated tiene MAINTAIN en una tabla nueva';
    END IF;
  END IF;
END $$;
SELECT pg_temp.verificar(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon no ejecuta ' || f),
       pg_temp.verificar(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ejecuta ' || f),
       pg_temp.verificar((SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = f::regprocedure), f || ' con search_path fijo')
  FROM unnest(ARRAY[
    'public.asignar_producto_maquina(uuid, uuid)',
    'public.registrar_produccion_tejido(date, text, uuid, jsonb)',
    'public.corregir_produccion_tejido(uuid, numeric, uuid)',
    'public.registrar_produccion_planchado(jsonb)',
    'public.registrar_produccion_preparado(uuid, text, uuid, jsonb, text)',
    'public.ingresar_stock_fuera(text, uuid, numeric, text)'
  ]) AS f;
SELECT pg_temp.verificar(NOT has_function_privilege('authenticated', 'public.exigir_admin_o_supervisor(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exigir_admin_o_supervisor(text)', 'EXECUTE'),
  'la comprobación de rol no se llama desde fuera (ni con sesión ni sin ella)');

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000032a1', 'Admin 032', 'a032@test', 'admin', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000032a2', 'Super 032', 's032@test', 'supervisor', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000032a3', 'Juan Operario', 'j032@test', 'tejedor', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000032a4', 'Ana Encargada', 'e032@test', 'tejedor', true, 'disponible'),
  ('00000000-0000-0000-0000-0000000032a5', 'Prep 032', 'p032@test', 'operador', true, 'disponible'),  -- 033: operador (planchado y preparado)
  ('00000000-0000-0000-0000-0000000032a6', 'Baja 032', 'b032@test', 'tejedor', false, 'disponible'),
  ('00000000-0000-0000-0000-0000000032a7', 'Admin Baja 032', 'ab032@test', 'admin', false, 'disponible');
INSERT INTO materia_prima (id, material, color, stock_kg) VALUES
  ('00000000-0000-0000-0000-0000000032b1', 'Algodón-032', 'Crudo-032', 10);
INSERT INTO catalogo_medias (id, codigo, sku, modelo, publico, diseno_color, talla, peso_docena_g, materia_prima_id) VALUES
  ('00000000-0000-0000-0000-0000000032c1', 'T32-A', 'SKU-T32A', 'Deportiva', 'adulto', 'Azul', 'L', 400, '00000000-0000-0000-0000-0000000032b1'),
  ('00000000-0000-0000-0000-0000000032c2', 'T32-B', NULL, 'Deportiva', 'adulto', 'Rojo', 'M', 500, '00000000-0000-0000-0000-0000000032b1'),
  ('00000000-0000-0000-0000-0000000032c3', 'T32-C', NULL, 'Deportiva', 'adulto', 'Verde', 'S', 300, NULL);  -- sin hilo vinculado
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000032d1', 'T3201', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000032d2', 'T3202', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000032d3', 'T3203', 'tejedora', 'malograda'),
  ('00000000-0000-0000-0000-0000000032d4', 'R3201', 'remalladora', 'activa'),
  ('00000000-0000-0000-0000-0000000032d5', 'T3205', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000032d6', 'T3206', 'tejedora', 'mantenimiento'),
  ('00000000-0000-0000-0000-0000000032d7', 'T3207', 'tejedora', 'inactiva'),
  ('00000000-0000-0000-0000-0000000032d8', 'T3208', 'tejedora', 'activa');
INSERT INTO ubicaciones (id, nombre, tipo, activo) VALUES
  ('00000000-0000-0000-0000-0000000032e1', 'Salón 032', 'salon', true);

-- ── Producto fijo por máquina ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a3');  -- un tejedor no cambia el producto
SELECT pg_temp.debe_fallar($$SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d1', '00000000-0000-0000-0000-0000000032c1')$$,
  'Solo el administrador o el supervisor');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a7');  -- un administrador dado de baja tampoco
SELECT pg_temp.debe_fallar($$SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d1', '00000000-0000-0000-0000-0000000032c1')$$,
  'Solo el administrador o el supervisor');
SELECT pg_temp.sesion(NULL);  -- sin usuario tampoco
SELECT pg_temp.debe_fallar($$SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d1', '00000000-0000-0000-0000-0000000032c1')$$,
  'Solo el administrador o el supervisor');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a2');  -- supervisor
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d1', '00000000-0000-0000-0000-0000000032c1');
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d3', '00000000-0000-0000-0000-0000000032c1');
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d6', '00000000-0000-0000-0000-0000000032c1');
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d7', '00000000-0000-0000-0000-0000000032c1');
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d8', '00000000-0000-0000-0000-0000000032c3');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a1');  -- administrador
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d2', '00000000-0000-0000-0000-0000000032c1');
SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d2', '00000000-0000-0000-0000-0000000032c2');  -- cambio
SELECT pg_temp.debe_fallar($$SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d2', '00000000-0000-0000-0000-0000000032c2')$$, 'ya tiene el producto');
SELECT pg_temp.debe_fallar($$SELECT asignar_producto_maquina('00000000-0000-0000-0000-0000000032d4', '00000000-0000-0000-0000-0000000032c1')$$, 'no es tejedora');
-- Nadie con sesión escribe directamente
DO $$
BEGIN
  BEGIN
    INSERT INTO productos_maquina (maquina_id, catalogo_media_id) VALUES ('00000000-0000-0000-0000-0000000032d5', '00000000-0000-0000-0000-0000000032c1');
    RAISE EXCEPTION 'FALLO: con sesión se asignó un producto sin su función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM productos_maquina WHERE maquina_id = '00000000-0000-0000-0000-0000000032d2'), 'el cambio guarda el historial');
SELECT pg_temp.verificar((SELECT catalogo_media_id = '00000000-0000-0000-0000-0000000032c2' AND asignado_por = '00000000-0000-0000-0000-0000000032a1'
  FROM productos_maquina WHERE maquina_id = '00000000-0000-0000-0000-0000000032d2' AND hasta IS NULL), 'el vigente es el último, con quién lo asignó');

-- ── Registro de producción por turno ───────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a4');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'tarde', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'día o noche');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido((NOW() AT TIME ZONE 'America/Lima')::date + 1, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'futura');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', NULL, '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'encargado');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a6', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'encargado');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d6","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'T3206 está mantenimiento');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d7","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'T3207 está inactiva');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d8","docenas":10000.01,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'entre 0 y 10 000');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[]')$$, 'al menos una máquina');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1},{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1}]')$$, 'más de una vez');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":-1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'entre 0 y 10 000');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":"NaN","operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'entre 0 y 10 000');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":2}]')$$, 'operario de cada máquina');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a6"}]')$$, 'operario de cada máquina');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d3","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'T3203 está malograda');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d5","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'T3205 no tiene producto');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d4","docenas":2,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'no es tejedora');
-- Hilo insuficiente: 30 docenas × 400 g = 12 kg y hay 10 → no se guarda nada
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'noche', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":30,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'Falta de materia prima');
RESET ROLE;
SELECT pg_temp.verificar((SELECT count(*) = 0 FROM turnos_produccion WHERE registro_24_6), 'un registro rechazado no deja turno');
SELECT pg_temp.verificar((SELECT stock_kg = 10 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000032b1'), 'ni descuenta hilo');

-- Turno noche: T3201 (400 g) 12 docenas con Juan; T3202 (500 g) 4 docenas con Ana → 4,8 + 2 = 6,8 kg
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a4');
CREATE TEMP TABLE t_turno ON COMMIT DROP AS SELECT registrar_produccion_tejido(NULL, 'noche', '00000000-0000-0000-0000-0000000032a4',
  '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":12,"operario_id":"00000000-0000-0000-0000-0000000032a3"},
    {"maquina_id":"00000000-0000-0000-0000-0000000032d2","docenas":4,"operario_id":"00000000-0000-0000-0000-0000000032a4"}]') AS id;
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_kg = 3.2 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000032b1'), 'hilo por docenas reales: 10 − 6,8 = 3,2 kg');
SELECT pg_temp.verificar((SELECT count(*) = 1 AND sum(cantidad_kg) = 6.8 FROM movimientos_materia_prima WHERE referencia_id = (SELECT id FROM t_turno)),
  'un movimiento de hilo por materia prima, con el turno');
SELECT pg_temp.verificar((SELECT docenas_producidas = 12 AND operario_id = '00000000-0000-0000-0000-0000000032a3'
    AND catalogo_media_id = '00000000-0000-0000-0000-0000000032c1' AND registrado_por = '00000000-0000-0000-0000-0000000032a4'
  FROM reportes_produccion WHERE turno_id = (SELECT id FROM t_turno) AND maquina_id = '00000000-0000-0000-0000-0000000032d1'),
  '12 docenas de Juan en T3201 con su producto vigente');
SELECT pg_temp.verificar((SELECT catalogo_media_id = '00000000-0000-0000-0000-0000000032c2'
  FROM reportes_produccion WHERE turno_id = (SELECT id FROM t_turno) AND maquina_id = '00000000-0000-0000-0000-0000000032d2'),
  'T3202 registra el producto nuevo, no el anterior');
SELECT pg_temp.verificar((SELECT estado = 'activa' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000032d1'), 'la máquina no se ocupa');
SELECT pg_temp.verificar((SELECT persona = 'Juan Operario' FROM vista_historia_maquina
  WHERE evento_id = 'tejido:' || (SELECT id FROM reportes_produccion WHERE turno_id = (SELECT id FROM t_turno) AND maquina_id = '00000000-0000-0000-0000-0000000032d1')),
  'la historia clínica muestra al operario de la máquina, no a la encargada');
SELECT pg_temp.verificar((SELECT tejedor_id = '00000000-0000-0000-0000-0000000032a4' AND horario = 'noche' AND registro_24_6
  FROM turnos_produccion WHERE id = (SELECT id FROM t_turno)), 'turno noche con su encargada');

SET LOCAL ROLE authenticated;
-- La misma máquina no se registra dos veces en el turno; otro encargado tampoco
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'noche', '00000000-0000-0000-0000-0000000032a4', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'T3201 ya está registrada');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_tejido(NULL, 'noche', '00000000-0000-0000-0000-0000000032a3', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d2","docenas":1,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]')$$, 'otro encargado (Ana Encargada)');
-- El turno día es otro turno: la misma máquina sí se registra
SELECT registrar_produccion_tejido(NULL, 'dia', '00000000-0000-0000-0000-0000000032a3', '[{"maquina_id":"00000000-0000-0000-0000-0000000032d1","docenas":0,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]');
RESET ROLE;
SELECT pg_temp.verificar((SELECT count(*) = 2 FROM turnos_produccion WHERE registro_24_6), 'día y noche son dos turnos');
SELECT pg_temp.verificar((SELECT stock_kg = 3.2 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000032b1'), '0 docenas no descuentan hilo');
-- Tope: exactamente 10 000 docenas se aceptan (producto sin hilo vinculado, turno de ayer)
SET LOCAL ROLE authenticated;
SELECT registrar_produccion_tejido((NOW() AT TIME ZONE 'America/Lima')::date - 1, 'dia', '00000000-0000-0000-0000-0000000032a4',
  '[{"maquina_id":"00000000-0000-0000-0000-0000000032d8","docenas":10000,"operario_id":"00000000-0000-0000-0000-0000000032a3"}]');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas_producidas = 10000 FROM reportes_produccion WHERE maquina_id = '00000000-0000-0000-0000-0000000032d8'), '10 000 exacto se acepta');

-- ── Corrección del mismo día ───────────────────────────────────────────────
CREATE TEMP TABLE t_rep ON COMMIT DROP AS SELECT id FROM reportes_produccion
  WHERE turno_id = (SELECT id FROM t_turno) AND maquina_id = '00000000-0000-0000-0000-0000000032d1';
GRANT SELECT ON t_turno, t_rep TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a3');
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 10, '00000000-0000-0000-0000-0000000032a3')$$, 'Solo el administrador o el supervisor');
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a2');
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 21, '00000000-0000-0000-0000-0000000032a3')$$, 'Falta de materia prima');
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 'NaN', '00000000-0000-0000-0000-0000000032a3')$$, 'entre 0 y 10 000');
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 10, '00000000-0000-0000-0000-0000000032a6')$$, 'Elige el operario de la máquina');
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 10, NULL)$$, 'Elige el operario de la máquina');
SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 10, '00000000-0000-0000-0000-0000000032a4');  -- 12 → 10: devuelve 0,8 kg
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_kg = 4.0 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000032b1'), 'corregir 12 → 10 devuelve 0,8 kg');
SELECT pg_temp.verificar((SELECT docenas_producidas = 10 AND operario_id = '00000000-0000-0000-0000-0000000032a4' AND registrado_por = '00000000-0000-0000-0000-0000000032a2'
  FROM reportes_produccion WHERE id = (SELECT id FROM t_rep)), 'la corrección cambia docenas, operario y quién registró');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM movimientos_materia_prima WHERE referencia_id = (SELECT id FROM t_turno) AND tipo = 'devolucion' AND cantidad_kg = 0.8),
  'la devolución de hilo queda registrada');
SET LOCAL ROLE authenticated;
SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 11, '00000000-0000-0000-0000-0000000032a4');  -- 10 → 11: descuenta 0,4 kg
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_kg = 3.6 FROM materia_prima WHERE id = '00000000-0000-0000-0000-0000000032b1'), 'corregir 10 → 11 descuenta 0,4 kg');
-- Un registro del flujo anterior (turno sin registro 24/6) no se corrige aquí, aunque sea de hoy
INSERT INTO turnos_produccion (id, tejedor_id, fecha, horario, duracion_horas, estado)
  VALUES ('00000000-0000-0000-0000-0000000032f1', '00000000-0000-0000-0000-0000000032a3', (NOW() AT TIME ZONE 'America/Lima')::date, 'dia', 12, 'cerrado');
INSERT INTO reportes_produccion (id, turno_id, maquina_id, catalogo_media_id, docenas_producidas)
  VALUES ('00000000-0000-0000-0000-0000000032f2', '00000000-0000-0000-0000-0000000032f1', '00000000-0000-0000-0000-0000000032d5', '00000000-0000-0000-0000-0000000032c1', 5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido('00000000-0000-0000-0000-0000000032f2', 1, '00000000-0000-0000-0000-0000000032a3')$$, 'Solo se corrigen registros del turno 24/6');
RESET ROLE;
-- Un registro de ayer ya no se corrige
UPDATE reportes_produccion SET created_at = NOW() - interval '2 days' WHERE id = (SELECT id FROM t_rep);
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT corregir_produccion_tejido((SELECT id FROM t_rep), 12, '00000000-0000-0000-0000-0000000032a4')$$, 'mismo día');
RESET ROLE;

-- ── Planchado suma a por preparar ──────────────────────────────────────────
INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES ('00000000-0000-0000-0000-0000000032c1', 10)
  ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = 10;
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_planchado('[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas_planchadas":"NaN"}]')$$, 'negativas');
SELECT registrar_produccion_planchado('[{"planchador_id":"00000000-0000-0000-0000-0000000032a5","catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas_planchadas":7,"docenas_defectuosas":1}]');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 2 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c1'), 'planchar 7 + 1 defectuosa deja 2 por planchar');
SELECT pg_temp.verificar((SELECT docenas = 7 FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c1'), 'las 7 buenas quedan por preparar');

-- ── Stock de fuera ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a5');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('empaque', '00000000-0000-0000-0000-0000000032c1', 5, 'x')$$, 'etapa');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000032c1', 0, 'x')$$, 'mayores a 0');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000032c1', 'NaN', 'x')$$, 'mayores a 0');
SELECT pg_temp.debe_fallar($$SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000032c1', 5, '  ')$$, 'de dónde vienen');
CREATE TEMP TABLE t_egr ON COMMIT DROP AS SELECT count(*) AS n FROM egresos_adicionales;
SELECT ingresar_stock_fuera('planchado', '00000000-0000-0000-0000-0000000032c2', 5, ' Producción antes del sistema ');
SELECT ingresar_stock_fuera('preparado', '00000000-0000-0000-0000-0000000032c2', 3, 'Taller externo');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 5 FROM stock_listo_planchar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c2'), 'de fuera en planchado: 5 por planchar');
SELECT pg_temp.verificar((SELECT docenas = 3 FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c2'), 'de fuera en preparado: 3 por preparar');
SELECT pg_temp.verificar((SELECT count(*) = 2 AND bool_and(registrado_por = '00000000-0000-0000-0000-0000000032a5')
    AND bool_or(origen = 'Producción antes del sistema') FROM ingresos_stock_fuera), 'cada ingreso guarda origen y quién lo ingresó');
SELECT pg_temp.verificar((SELECT count(*) FROM egresos_adicionales) = (SELECT n FROM t_egr), 'el stock de fuera no crea egreso');

-- ── Preparado descuenta y crea el saco ─────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.sesion('00000000-0000-0000-0000-0000000032a5');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', 'S-032', '00000000-0000-0000-0000-0000000032e1',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas":8}]', 'qr')$$, 'No hay suficiente stock por preparar de T32-A: se registran 8 docenas y hay 7');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', 'S-032', '00000000-0000-0000-0000-0000000032e1',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas":0,"defectuosas":1}]', 'qr')$$, 'al menos una docena preparada');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', ' ', '00000000-0000-0000-0000-0000000032e1',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas":1}]', 'qr')$$, 'código del saco');
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', 'S-032', NULL,
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas":1}]', 'qr')$$, 'salón');
CREATE TEMP TABLE t_saco ON COMMIT DROP AS SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', 'S-032', '00000000-0000-0000-0000-0000000032e1',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c1","docenas":6,"defectuosas":1},{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c2","docenas":2}]', 'qr-032') AS id;
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 0 FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c1'), '6 + 1 defectuosa de 7: quedan 0');
SELECT pg_temp.verificar((SELECT docenas = 1 FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c2'), '2 de 3: queda 1');
SELECT pg_temp.verificar((SELECT codigo_paquete = 'S-032' AND docenas = 8 AND total_pares = 96 AND estado = 'pendiente_almacenar' AND qr_data = 'qr-032'
    AND catalogo_media_id = '00000000-0000-0000-0000-0000000032c1' AND ubicacion_id = '00000000-0000-0000-0000-0000000032e1'
    AND jsonb_array_length(detalles_contenido) = 2
    AND detalles_contenido @> '[{"codigo":"T32-A","sku":"SKU-T32A","docenas":6,"pares":72},{"codigo":"T32-B","sku":"SKU-T32-B","docenas":2,"pares":24}]'
  FROM paquetes WHERE id = (SELECT id FROM t_saco)), 'el saco lleva lo preparado (sin defectuosas), con su contenido por SKU');
SELECT pg_temp.verificar((SELECT count(*) = 2 AND sum(docenas_preparadas) = 8 AND sum(docenas_defectuosas) = 1
    AND bool_and(preparador_id = '00000000-0000-0000-0000-0000000032a5' AND registrado_por = '00000000-0000-0000-0000-0000000032a5')
  FROM reportes_preparado WHERE paquete_id = (SELECT id FROM t_saco)), 'el reporte de preparado por SKU con su preparador');
SET LOCAL ROLE authenticated;
SELECT pg_temp.debe_fallar($$SELECT registrar_produccion_preparado('00000000-0000-0000-0000-0000000032a5', 'S-032', '00000000-0000-0000-0000-0000000032e1',
  '[{"catalogo_media_id":"00000000-0000-0000-0000-0000000032c2","docenas":1}]', 'qr')$$, 'duplicate key');
RESET ROLE;
SELECT pg_temp.verificar((SELECT docenas = 1 FROM stock_listo_preparar WHERE catalogo_media_id = '00000000-0000-0000-0000-0000000032c2'), 'un saco con código repetido no descuenta nada');

-- ── Sin sesión no se ve nada ───────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM productos_maquina', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM stock_listo_preparar', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM ingresos_stock_fuera', 'permission denied');
RESET ROLE;

ROLLBACK;
