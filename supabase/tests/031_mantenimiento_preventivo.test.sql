-- Pruebas de la migración 031 (mantenimiento preventivo e historia clínica) en un Postgres de PRUEBA.
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

-- ── Estructura y permisos exactos ──────────────────────────────────────────
SELECT pg_temp.verificar((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
  ('public.planes_mantenimiento'::regclass, 'public.mantenimientos_preventivos'::regclass, 'public.mantenimiento_repuestos'::regclass)), 'tablas nuevas con RLS');
SELECT pg_temp.verificar((SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'durey_usuarios_con_sesion'
  AND tablename IN ('planes_mantenimiento', 'mantenimientos_preventivos', 'mantenimiento_repuestos')), 'tablas nuevas con la política de sesión');
SELECT pg_temp.verificar(pg_temp.permisos('planes_mantenimiento', 'authenticated') = 'INSERT,SELECT,UPDATE', 'planes: leer, crear y cambiar (se desactivan, no se borran)');
SELECT pg_temp.verificar(pg_temp.permisos(t, 'authenticated') = 'SELECT', t || ': solo lectura (' || pg_temp.permisos(t, 'authenticated') || ')')
  FROM unnest(ARRAY['mantenimientos_preventivos', 'mantenimiento_repuestos', 'vista_historia_maquina']) AS t;
SELECT pg_temp.verificar(pg_temp.permisos(t, 'anon') = '-', t || ': nada para anon')
  FROM unnest(ARRAY['planes_mantenimiento', 'mantenimientos_preventivos', 'mantenimiento_repuestos', 'vista_historia_maquina']) AS t;
SELECT pg_temp.verificar((SELECT 'security_invoker=true' = ANY (COALESCE(reloptions, '{}')) FROM pg_class WHERE oid = 'public.vista_historia_maquina'::regclass),
  'la vista consulta con los permisos de quien pregunta');
SELECT pg_temp.verificar(NOT has_function_privilege('anon', f, 'EXECUTE'), 'anon no ejecuta ' || f),
       pg_temp.verificar(has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated ejecuta ' || f),
       pg_temp.verificar((SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = f::regprocedure), f || ' con search_path fijo')
  FROM unnest(ARRAY[
    'public.iniciar_mantenimiento_preventivo(uuid, uuid)',
    'public.usar_repuesto_en_mantenimiento(uuid, uuid, integer)',
    'public.quitar_repuesto_de_mantenimiento(uuid)',
    'public.terminar_mantenimiento_preventivo(uuid, text, numeric)'
  ]) AS f;

-- ── Datos ──────────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, rol, activo, estado) VALUES
  ('00000000-0000-0000-0000-0000000031a1', 'Tejedor 031', 't031@test', 'tejedor', true, 'disponible');
INSERT INTO maquinas (id, codigo, tipo, estado) VALUES
  ('00000000-0000-0000-0000-0000000031d1', 'T3101', 'tejedora', 'activa'),
  ('00000000-0000-0000-0000-0000000031d2', 'T3102', 'tejedora', 'ocupada'),
  ('00000000-0000-0000-0000-0000000031d3', 'T3103', 'tejedora', 'standby'),
  ('00000000-0000-0000-0000-0000000031d4', 'T3104', 'tejedora', 'malograda'),
  ('00000000-0000-0000-0000-0000000031d5', 'R3105', 'remalladora', 'activa');
INSERT INTO mecanicos (id, nombre, apellido, telefono, activo) VALUES
  ('00000000-0000-0000-0000-0000000031f1', 'Juan', 'Pérez', '987', true),
  ('00000000-0000-0000-0000-0000000031f2', 'Luis', 'Baja', '988', false);
INSERT INTO repuestos (id, nombre, stock_actual, costo_unitario) VALUES ('00000000-0000-0000-0000-0000000031b1', 'Aceite 031', 5, 8);
INSERT INTO catalogo_medias (id, codigo, modelo, talla, diseno_color, publico) VALUES ('00000000-0000-0000-0000-0000000031c1', 'M031', 'Mod', 'U', 'Negro', 'adulto');

-- Planes: frecuencia > 0
SELECT pg_temp.debe_fallar($$INSERT INTO planes_mantenimiento (maquina_id, tarea, frecuencia_dias, fecha_inicio)
  VALUES ('00000000-0000-0000-0000-0000000031d1', 'x', 0, CURRENT_DATE)$$, 'planes_mantenimiento');
SELECT pg_temp.debe_fallar($$INSERT INTO planes_mantenimiento (maquina_id, tarea, frecuencia_dias, fecha_inicio)
  VALUES ('00000000-0000-0000-0000-0000000031d1', '  ', 15, CURRENT_DATE)$$, 'planes_mantenimiento');
INSERT INTO planes_mantenimiento (id, maquina_id, tarea, frecuencia_dias, fecha_inicio) VALUES
  ('00000000-0000-0000-0000-0000000031e1', '00000000-0000-0000-0000-0000000031d1', 'Lubricar cilindro', 15, CURRENT_DATE - 20),
  ('00000000-0000-0000-0000-0000000031e2', '00000000-0000-0000-0000-0000000031d2', 'Limpieza', 7, CURRENT_DATE - 10),
  ('00000000-0000-0000-0000-0000000031e3', '00000000-0000-0000-0000-0000000031d3', 'Agujas', 30, CURRENT_DATE - 40),
  ('00000000-0000-0000-0000-0000000031e4', '00000000-0000-0000-0000-0000000031d1', 'Otra tarea', 30, CURRENT_DATE),
  ('00000000-0000-0000-0000-0000000031e5', '00000000-0000-0000-0000-0000000031d4', 'En falla', 30, CURRENT_DATE);

-- ── Iniciar ────────────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e1', NULL)$$, 'mecánico');
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e2', '00000000-0000-0000-0000-0000000031f1')$$, 'ocupada');
SELECT pg_temp.verificar((SELECT estado = 'ocupada' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000031d2'), 'la máquina ocupada sigue ocupada');
-- Malograda sin falla abierta (estado puesto a mano): tampoco
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e5', '00000000-0000-0000-0000-0000000031f1')$$, 'malograda');
-- Mecánico dado de baja: no
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e1', '00000000-0000-0000-0000-0000000031f2')$$, 'no está activo');
-- Falla abierta: no se inicia
INSERT INTO averias_maquinas (id, maquina_id, estado, descripcion_operador) VALUES
  ('00000000-0000-0000-0000-0000000031aa', '00000000-0000-0000-0000-0000000031d3', 'pendiente', 'x');
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e3', '00000000-0000-0000-0000-0000000031f1')$$, 'falla');
UPDATE averias_maquinas SET estado = 'resuelto' WHERE id = '00000000-0000-0000-0000-0000000031aa';
-- Desde standby sí
SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e3', '00000000-0000-0000-0000-0000000031f1');
SELECT pg_temp.verificar((SELECT estado = 'mantenimiento' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000031d3'), 'standby → mantenimiento');
-- Plan desactivado: no se inicia
UPDATE planes_mantenimiento SET activo = false WHERE id = '00000000-0000-0000-0000-0000000031e4';
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e4', '00000000-0000-0000-0000-0000000031f1')$$, 'desactivado');
UPDATE planes_mantenimiento SET activo = true WHERE id = '00000000-0000-0000-0000-0000000031e4';

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_m ON COMMIT DROP AS
  SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e1', '00000000-0000-0000-0000-0000000031f1') AS id;
RESET ROLE;
GRANT SELECT ON t_m TO authenticated;
SELECT pg_temp.verificar((SELECT estado = 'mantenimiento' AND detalle_estado = 'MANTENIMIENTO PREVENTIVO' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000031d1'),
  'activa → mantenimiento preventivo');
-- Un solo mantenimiento en curso por plan y por máquina
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e1', '00000000-0000-0000-0000-0000000031f1')$$, 'en curso');
SELECT pg_temp.debe_fallar($$SELECT iniciar_mantenimiento_preventivo('00000000-0000-0000-0000-0000000031e4', '00000000-0000-0000-0000-0000000031f1')$$, 'en curso');
-- Nadie con sesión escribe directamente
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE mantenimientos_preventivos SET costo_mano_obra = 999;
    RAISE EXCEPTION 'FALLO: con sesión se cambió un mantenimiento sin su función';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;

-- ── Repuestos en el preventivo ─────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT usar_repuesto_en_mantenimiento((SELECT id FROM t_m), '00000000-0000-0000-0000-0000000031b1', 6)$$,
  'Solo hay 5 unidades de Aceite 031; no se pueden usar 6');
CREATE TEMP TABLE t_egr ON COMMIT DROP AS SELECT count(*) AS n FROM egresos_adicionales;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_uso ON COMMIT DROP AS SELECT usar_repuesto_en_mantenimiento((SELECT id FROM t_m), '00000000-0000-0000-0000-0000000031b1', 3) AS id;
RESET ROLE;
SELECT pg_temp.verificar((SELECT stock_actual = 2 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000031b1'), 'usar 3 de 5 deja 2');
SELECT quitar_repuesto_de_mantenimiento((SELECT id FROM t_uso));
SELECT pg_temp.verificar((SELECT stock_actual = 5 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000031b1'), 'quitar devuelve el stock');
SELECT usar_repuesto_en_mantenimiento((SELECT id FROM t_m), '00000000-0000-0000-0000-0000000031b1', 2);
SELECT pg_temp.verificar((SELECT count(*) FROM egresos_adicionales) = (SELECT n FROM t_egr), 'usar repuestos no crea egreso');

-- ── Terminar ───────────────────────────────────────────────────────────────
SELECT pg_temp.debe_fallar($$SELECT terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'ok', -1)$$, 'negativ');
SELECT pg_temp.debe_fallar($$SELECT terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'ok', 'NaN')$$, 'no es un número');
SELECT pg_temp.debe_fallar($$SELECT terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'ok', 1000000.01)$$, '1 000 000');
-- Exactamente el tope se acepta (en una subtransacción que se deshace)
DO $$
BEGIN
  BEGIN
    PERFORM terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'tope', 1000000);
    RAISE EXCEPTION 'tope_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'tope_ok' THEN RAISE EXCEPTION 'FALLO: 1 000 000 exacto debería aceptarse (%)', SQLERRM; END IF;
  END;
END $$;
SELECT terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'Lubricado y ajustado', 40);
SELECT pg_temp.verificar((SELECT estado = 'terminado' AND costo_mano_obra = 40 AND costo_repuestos = 16 AND fecha_fin IS NOT NULL
  FROM mantenimientos_preventivos WHERE id = (SELECT id FROM t_m)), 'terminado: mano de obra 40 y repuestos 2 × 8 = 16');
SELECT pg_temp.verificar((SELECT ultima_fecha = (NOW() AT TIME ZONE 'America/Lima')::date FROM planes_mantenimiento WHERE id = '00000000-0000-0000-0000-0000000031e1'),
  'el plan cuenta desde hoy (día de Lima)');
SELECT pg_temp.verificar((SELECT estado = 'activa' AND detalle_estado = 'OPERATIVA' FROM maquinas WHERE id = '00000000-0000-0000-0000-0000000031d1'),
  'la máquina vuelve a activa');
SELECT pg_temp.debe_fallar($$SELECT terminar_mantenimiento_preventivo((SELECT id FROM t_m), 'otra vez', 40)$$, 'en curso');
SELECT pg_temp.debe_fallar($$SELECT usar_repuesto_en_mantenimiento((SELECT id FROM t_m), '00000000-0000-0000-0000-0000000031b1', 1)$$, 'en curso');
SELECT pg_temp.debe_fallar($$SELECT quitar_repuesto_de_mantenimiento((SELECT id FROM mantenimiento_repuestos WHERE mantenimiento_id = (SELECT id FROM t_m)))$$, 'en curso');
SELECT pg_temp.verificar((SELECT stock_actual = 3 FROM repuestos WHERE id = '00000000-0000-0000-0000-0000000031b1'), 'tras terminar, el stock no vuelve');
-- Un plan con historial no se borra (ni con sesión, ni en cascada)
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM planes_mantenimiento WHERE id = '00000000-0000-0000-0000-0000000031e4';
    RAISE EXCEPTION 'FALLO: con sesión se borró un plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END $$;
SELECT pg_temp.debe_fallar($$DELETE FROM planes_mantenimiento WHERE id = '00000000-0000-0000-0000-0000000031e1'$$, 'foreign key');

-- ── Historia clínica ───────────────────────────────────────────────────────
INSERT INTO turnos_produccion (id, tejedor_id, fecha, horario, duracion_horas, estado) VALUES
  ('00000000-0000-0000-0000-0000000031c7', '00000000-0000-0000-0000-0000000031a1', CURRENT_DATE - 1, 'noche', 12, 'cerrado');
INSERT INTO reportes_produccion (turno_id, maquina_id, catalogo_media_id, docenas_producidas, fecha) VALUES
  ('00000000-0000-0000-0000-0000000031c7', '00000000-0000-0000-0000-0000000031d1', '00000000-0000-0000-0000-0000000031c1', 30, CURRENT_DATE - 1);
INSERT INTO averias_maquinas (id, maquina_id, estado, descripcion_operador, fecha_reporte, reportado_por_id, mecanico_id, asignado_a) VALUES
  ('00000000-0000-0000-0000-0000000031ab', '00000000-0000-0000-0000-0000000031d1', 'resuelto', 'Aguja rota', NOW() - INTERVAL '3 days',
   '00000000-0000-0000-0000-0000000031a1', '00000000-0000-0000-0000-0000000031f1', 'Juan Pérez');
INSERT INTO reparaciones (averia_id, mecanico_id, descripcion_tecnico, costo_repuestos, costo_mano_obra) VALUES
  ('00000000-0000-0000-0000-0000000031ab', '00000000-0000-0000-0000-0000000031f1', 'Cambio de aguja', 12, 20);

-- Remallado (máquina remalladora) y repuesto usado en una falla
INSERT INTO lotes_remallado (id, catalogo_media_id, maquina_remalladora_id, estado) VALUES
  ('00000000-0000-0000-0000-0000000031b7', '00000000-0000-0000-0000-0000000031c1', '00000000-0000-0000-0000-0000000031d5', 'completado');
INSERT INTO reportes_remallado (lote_id, remalladora_id, maquina_id, docenas_remalladas, docenas_restantes, fecha) VALUES
  ('00000000-0000-0000-0000-0000000031b7', '00000000-0000-0000-0000-0000000031a1', '00000000-0000-0000-0000-0000000031d5', 12, 0, CURRENT_DATE);
-- El repuesto lo puso otro mecánico (Luis), distinto del asignado a la falla (Juan)
INSERT INTO averia_repuestos (averia_id, repuesto_id, cantidad, costo_unitario, mecanico_id) VALUES
  ('00000000-0000-0000-0000-0000000031ab', '00000000-0000-0000-0000-0000000031b1', 1, 8, '00000000-0000-0000-0000-0000000031f2');

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_h ON COMMIT DROP AS SELECT * FROM vista_historia_maquina WHERE maquina_id = '00000000-0000-0000-0000-0000000031d1';
CREATE TEMP TABLE t_h5 ON COMMIT DROP AS SELECT * FROM vista_historia_maquina WHERE maquina_id = '00000000-0000-0000-0000-0000000031d5';
RESET ROLE;
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'produccion' AND cantidad = 30 AND turno = 'noche' AND persona = 'Tejedor 031' AND detalle = 'M031'),
  'historia: producción con turno, tejedor y producto');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'falla' AND detalle = 'Aguja rota' AND persona = 'Tejedor 031' AND mecanico = 'Juan Pérez'),
  'historia: falla con quién reportó y mecánico');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'reparacion' AND costo = 32 AND mecanico = 'Juan Pérez'),
  'historia: reparación con costo total y mecánico');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'preventivo' AND costo = 40 AND detalle = 'Lubricar cilindro — Lubricado y ajustado' AND mecanico = 'Juan Pérez'),
  'historia: preventivo con tarea, mano de obra y mecánico');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'repuesto' AND detalle = 'Aceite 031' AND cantidad = 2 AND costo = 16),
  'historia: repuesto usado en el preventivo');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h WHERE tipo = 'repuesto' AND cantidad = 1 AND costo = 8 AND mecanico = 'Luis Baja'),
  'historia: repuesto usado en una falla, con el mecánico que lo usó');
SELECT pg_temp.verificar((SELECT count(*) = count(DISTINCT evento_id) AND bool_and(evento_id IS NOT NULL) FROM vista_historia_maquina),
  'cada evento tiene un identificador único (orden estable por páginas)');
SELECT pg_temp.verificar((SELECT count(*) = 1 FROM t_h5 WHERE tipo = 'produccion' AND cantidad = 12 AND persona = 'Tejedor 031' AND detalle = 'M031'),
  'historia: producción de remallado en la máquina remalladora');
SELECT pg_temp.verificar(NOT EXISTS (SELECT 1 FROM t_h WHERE maquina_id <> '00000000-0000-0000-0000-0000000031d1'), 'historia filtrada por máquina');

-- ── Sin sesión no se toca nada ─────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.debe_fallar('SELECT count(*) FROM planes_mantenimiento', 'permission denied');
SELECT pg_temp.debe_fallar('SELECT count(*) FROM vista_historia_maquina', 'permission denied');
RESET ROLE;

ROLLBACK;
