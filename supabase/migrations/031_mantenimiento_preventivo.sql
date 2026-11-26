-- ==============================================================================
-- Migración 031: Fase 4 — mantenimiento preventivo e historia clínica de máquinas
-- Spec: 02-DOCS/wiki/sdd/specs/fase-4-mantenimiento-preventivo.md (aprobada 2026-11-26)
--
-- 1. Planes de mantenimiento preventivo por máquina, cada N días. La próxima
--    fecha es (última vez o fecha de inicio) + N días; la calcula la app
--    (lib/domain/mantenimiento.ts) con ultima_fecha, fecha_inicio y frecuencia.
-- 2. Cada mantenimiento: al iniciarlo con un mecánico la máquina pasa a
--    "mantenimiento"; se usan repuestos del stock (sin egreso: el gasto se contó
--    al comprar); al terminarlo con nota y mano de obra la máquina vuelve a
--    "activa" y el plan cuenta desde hoy. Todo con funciones atómicas.
-- 3. vista_historia_maquina: producción, fallas, reparaciones, repuestos usados
--    y preventivos de cada máquina, una fila por evento (permisos de quien consulta).
--
-- Permisos (lección de la 030): planes con leer/crear/cambiar (se desactivan, no se borran); los
-- mantenimientos y sus repuestos solo lectura (se escriben por sus funciones);
-- la vista solo lectura; nada para anon. Reversión: supabase/scripts/revertir_031.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planes_mantenimiento (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maquina_id       UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  tarea            TEXT NOT NULL CHECK (btrim(tarea) <> ''),
  frecuencia_dias  INTEGER NOT NULL CHECK (frecuencia_dias > 0),
  fecha_inicio     DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
  ultima_fecha     DATE,
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS planes_mantenimiento_maquina_idx ON public.planes_mantenimiento (maquina_id);

CREATE TABLE IF NOT EXISTS public.mantenimientos_preventivos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- RESTRICT: el historial de mantenimientos no se borra en cascada (los planes se desactivan)
  plan_id          UUID NOT NULL REFERENCES public.planes_mantenimiento(id) ON DELETE RESTRICT,
  maquina_id       UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE RESTRICT,
  mecanico_id      UUID REFERENCES public.mecanicos(id) ON DELETE SET NULL,
  estado           TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'terminado')),
  fecha_inicio     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_fin        TIMESTAMPTZ,
  nota             TEXT,
  costo_mano_obra  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo_mano_obra >= 0),
  costo_repuestos  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo_repuestos >= 0),
  registrado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
-- Un solo mantenimiento en curso por plan y por máquina
CREATE UNIQUE INDEX IF NOT EXISTS mantenimientos_en_curso_plan_uq ON public.mantenimientos_preventivos (plan_id) WHERE estado = 'en_curso';
CREATE UNIQUE INDEX IF NOT EXISTS mantenimientos_en_curso_maquina_uq ON public.mantenimientos_preventivos (maquina_id) WHERE estado = 'en_curso';

CREATE TABLE IF NOT EXISTS public.mantenimiento_repuestos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mantenimiento_id UUID NOT NULL REFERENCES public.mantenimientos_preventivos(id) ON DELETE CASCADE,
  repuesto_id      UUID NOT NULL REFERENCES public.repuestos(id),
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario   NUMERIC(12,2) NOT NULL DEFAULT 0,
  registrado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mantenimiento_repuestos_mant_idx ON public.mantenimiento_repuestos (mantenimiento_id);

-- ------------------------------------------------------------------------------
-- 2. FUNCIONES
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_mantenimiento_preventivo(p_plan_id UUID, p_mecanico_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_plan RECORD;
  v_maq  RECORD;
  v_mec  RECORD;
  v_id   UUID;
BEGIN
  IF p_mecanico_id IS NULL THEN RAISE EXCEPTION 'Elige el mecánico que hace el mantenimiento'; END IF;
  SELECT id, maquina_id, tarea, activo INTO v_plan FROM planes_mantenimiento WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan de mantenimiento no encontrado'; END IF;
  IF NOT v_plan.activo THEN RAISE EXCEPTION 'El plan "%" está desactivado', v_plan.tarea; END IF;
  SELECT activo, nombre, apellido INTO v_mec FROM mecanicos WHERE id = p_mecanico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elige el mecánico que hace el mantenimiento'; END IF;
  IF NOT v_mec.activo THEN RAISE EXCEPTION 'El mecánico % % no está activo', v_mec.nombre, v_mec.apellido; END IF;

  SELECT id, codigo, estado INTO v_maq FROM maquinas WHERE id = v_plan.maquina_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM mantenimientos_preventivos WHERE maquina_id = v_maq.id AND estado = 'en_curso') THEN
    RAISE EXCEPTION 'La máquina % ya tiene un mantenimiento en curso', v_maq.codigo;
  END IF;
  IF EXISTS (SELECT 1 FROM averias_maquinas WHERE maquina_id = v_maq.id AND estado IN ('pendiente', 'en_reparacion')) THEN
    RAISE EXCEPTION 'La máquina % tiene una falla abierta: primero repárala', v_maq.codigo;
  END IF;
  -- Transiciones de lib/domain/machines.ts: a mantenimiento desde activa, standby o inactiva
  IF v_maq.estado NOT IN ('activa', 'standby', 'inactiva') THEN
    RAISE EXCEPTION 'La máquina % está % y no puede pasar a mantenimiento', v_maq.codigo, v_maq.estado;
  END IF;

  INSERT INTO mantenimientos_preventivos (plan_id, maquina_id, mecanico_id, registrado_por)
  VALUES (v_plan.id, v_maq.id, p_mecanico_id, auth.uid())
  RETURNING id INTO v_id;
  UPDATE maquinas SET estado = 'mantenimiento', detalle_estado = 'MANTENIMIENTO PREVENTIVO' WHERE id = v_maq.id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usar_repuesto_en_mantenimiento(p_mantenimiento_id UUID, p_repuesto_id UUID, p_cantidad INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado TEXT;
  v_rep    RECORD;
  v_id     UUID;
BEGIN
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  SELECT estado INTO v_estado FROM mantenimientos_preventivos WHERE id = p_mantenimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mantenimiento no encontrado'; END IF;
  IF v_estado <> 'en_curso' THEN RAISE EXCEPTION 'Solo se usan repuestos en un mantenimiento en curso'; END IF;
  SELECT id, nombre, stock_actual, costo_unitario INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;
  IF p_cantidad > v_rep.stock_actual THEN
    RAISE EXCEPTION 'Solo hay % unidades de %; no se pueden usar %', v_rep.stock_actual, v_rep.nombre, p_cantidad;
  END IF;
  UPDATE repuestos SET stock_actual = stock_actual - p_cantidad WHERE id = p_repuesto_id;
  INSERT INTO mantenimiento_repuestos (mantenimiento_id, repuesto_id, cantidad, costo_unitario, registrado_por)
  VALUES (p_mantenimiento_id, p_repuesto_id, p_cantidad, COALESCE(v_rep.costo_unitario, 0), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.quitar_repuesto_de_mantenimiento(p_uso_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uso    RECORD;
  v_estado TEXT;
BEGIN
  SELECT id, mantenimiento_id, repuesto_id, cantidad INTO v_uso FROM mantenimiento_repuestos WHERE id = p_uso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese repuesto ya no está en el mantenimiento'; END IF;
  SELECT estado INTO v_estado FROM mantenimientos_preventivos WHERE id = v_uso.mantenimiento_id FOR UPDATE;
  IF v_estado <> 'en_curso' THEN RAISE EXCEPTION 'Solo se quitan repuestos de un mantenimiento en curso'; END IF;
  PERFORM 1 FROM repuestos WHERE id = v_uso.repuesto_id FOR UPDATE;
  UPDATE repuestos SET stock_actual = stock_actual + v_uso.cantidad WHERE id = v_uso.repuesto_id;
  DELETE FROM mantenimiento_repuestos WHERE id = p_uso_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.terminar_mantenimiento_preventivo(p_mantenimiento_id UUID, p_nota TEXT, p_costo_mano_obra NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_m         RECORD;
  v_repuestos NUMERIC(12,2);
BEGIN
  -- NaN pasaría el CHECK >= 0 (en Postgres NaN es mayor que todo) y arruinaría las sumas de gasto
  IF p_costo_mano_obra = 'NaN'::numeric THEN RAISE EXCEPTION 'La mano de obra no es un número válido'; END IF;
  IF COALESCE(p_costo_mano_obra, 0) < 0 THEN RAISE EXCEPTION 'La mano de obra no puede ser negativa'; END IF;
  IF COALESCE(p_costo_mano_obra, 0) > 1000000 THEN RAISE EXCEPTION 'La mano de obra no puede pasar de S/ 1 000 000'; END IF;
  SELECT id, plan_id, maquina_id, estado INTO v_m FROM mantenimientos_preventivos WHERE id = p_mantenimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mantenimiento no encontrado'; END IF;
  IF v_m.estado <> 'en_curso' THEN RAISE EXCEPTION 'Solo se termina un mantenimiento en curso'; END IF;
  -- Mismo orden de bloqueo que iniciar: plan y después máquina
  PERFORM 1 FROM planes_mantenimiento WHERE id = v_m.plan_id FOR UPDATE;
  PERFORM 1 FROM maquinas WHERE id = v_m.maquina_id FOR UPDATE;

  SELECT COALESCE(sum(cantidad * costo_unitario), 0) INTO v_repuestos FROM mantenimiento_repuestos WHERE mantenimiento_id = v_m.id;
  UPDATE mantenimientos_preventivos
     SET estado = 'terminado', fecha_fin = NOW(), nota = NULLIF(btrim(COALESCE(p_nota, '')), ''),
         costo_mano_obra = round(COALESCE(p_costo_mano_obra, 0), 2), costo_repuestos = v_repuestos
   WHERE id = v_m.id;
  -- Día de Lima (la base está en UTC): después de las 19:00 en Lima, CURRENT_DATE ya es mañana
  UPDATE planes_mantenimiento SET ultima_fecha = (NOW() AT TIME ZONE 'America/Lima')::date WHERE id = v_m.plan_id;
  UPDATE maquinas SET estado = 'activa', detalle_estado = 'OPERATIVA' WHERE id = v_m.maquina_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. HISTORIA CLÍNICA (una fila por evento; momento ordena dentro del día)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vista_historia_maquina WITH (security_invoker = true) AS
  SELECT r.maquina_id, r.fecha, r.created_at AS momento, 'produccion'::text AS tipo, t.horario AS turno,
         c.codigo AS detalle, r.docenas_producidas AS cantidad, NULL::numeric AS costo, u.nombre AS persona, NULL::text AS mecanico
    FROM reportes_produccion r
    LEFT JOIN turnos_produccion t ON t.id = r.turno_id
    LEFT JOIN usuarios u ON u.id = t.tejedor_id
    LEFT JOIN catalogo_medias c ON c.id = r.catalogo_media_id
  UNION ALL
  SELECT r.maquina_id, r.fecha, r.created_at, 'produccion', NULL, c.codigo, r.docenas_remalladas, NULL, u.nombre, NULL
    FROM reportes_remallado r
    LEFT JOIN lotes_remallado l ON l.id = r.lote_id
    LEFT JOIN catalogo_medias c ON c.id = l.catalogo_media_id
    LEFT JOIN usuarios u ON u.id = r.remalladora_id
  UNION ALL
  SELECT a.maquina_id, (a.fecha_reporte AT TIME ZONE 'America/Lima')::date, a.fecha_reporte, 'falla', NULL, a.descripcion_operador, NULL, NULL,
         u.nombre, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM averias_maquinas a
    LEFT JOIN usuarios u ON u.id = a.reportado_por_id
    LEFT JOIN mecanicos m ON m.id = a.mecanico_id
  UNION ALL
  SELECT a.maquina_id, (rp.fecha_reparacion AT TIME ZONE 'America/Lima')::date, rp.fecha_reparacion, 'reparacion', NULL, rp.descripcion_tecnico, NULL,
         rp.costo_repuestos + rp.costo_mano_obra, NULL, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM reparaciones rp
    JOIN averias_maquinas a ON a.id = rp.averia_id
    LEFT JOIN mecanicos m ON m.id = rp.mecanico_id
  UNION ALL
  SELECT a.maquina_id, (ar.created_at AT TIME ZONE 'America/Lima')::date, ar.created_at, 'repuesto', NULL, re.nombre, ar.cantidad,
         ar.cantidad * ar.costo_unitario, NULL, COALESCE(btrim(m.nombre) || ' ' || btrim(m.apellido), a.asignado_a)
    FROM averia_repuestos ar
    JOIN averias_maquinas a ON a.id = ar.averia_id
    JOIN repuestos re ON re.id = ar.repuesto_id
    LEFT JOIN mecanicos m ON m.id = ar.mecanico_id
  UNION ALL
  SELECT mp.maquina_id, (mr.created_at AT TIME ZONE 'America/Lima')::date, mr.created_at, 'repuesto', NULL, re.nombre, mr.cantidad,
         mr.cantidad * mr.costo_unitario, NULL, btrim(m.nombre) || ' ' || btrim(m.apellido)
    FROM mantenimiento_repuestos mr
    JOIN mantenimientos_preventivos mp ON mp.id = mr.mantenimiento_id
    JOIN repuestos re ON re.id = mr.repuesto_id
    LEFT JOIN mecanicos m ON m.id = mp.mecanico_id
  UNION ALL
  SELECT mp.maquina_id, (COALESCE(mp.fecha_fin, mp.fecha_inicio) AT TIME ZONE 'America/Lima')::date, COALESCE(mp.fecha_fin, mp.fecha_inicio),
         'preventivo', NULL,
         pl.tarea || CASE WHEN mp.estado = 'en_curso' THEN ' (en curso)' ELSE COALESCE(' — ' || mp.nota, '') END,
         NULL, mp.costo_mano_obra, NULL, btrim(m.nombre) || ' ' || btrim(m.apellido)
    FROM mantenimientos_preventivos mp
    JOIN planes_mantenimiento pl ON pl.id = mp.plan_id
    LEFT JOIN mecanicos m ON m.id = mp.mecanico_id;

-- ------------------------------------------------------------------------------
-- 4. PERMISOS (exactos para authenticated; nada para anon)
-- ------------------------------------------------------------------------------
ALTER TABLE public.planes_mantenimiento       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mantenimientos_preventivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mantenimiento_repuestos    ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.planes_mantenimiento;
CREATE POLICY durey_usuarios_con_sesion ON public.planes_mantenimiento FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.mantenimientos_preventivos;
CREATE POLICY durey_usuarios_con_sesion ON public.mantenimientos_preventivos FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.mantenimiento_repuestos;
CREATE POLICY durey_usuarios_con_sesion ON public.mantenimiento_repuestos FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.planes_mantenimiento, public.mantenimientos_preventivos, public.mantenimiento_repuestos,
                    public.vista_historia_maquina FROM PUBLIC, anon, authenticated;
-- Sin DELETE: un plan se desactiva (activo = false), no se borra
GRANT SELECT, INSERT, UPDATE ON TABLE public.planes_mantenimiento TO authenticated;
GRANT SELECT ON TABLE public.mantenimientos_preventivos, public.mantenimiento_repuestos, public.vista_historia_maquina TO authenticated;
GRANT ALL ON TABLE public.planes_mantenimiento, public.mantenimientos_preventivos, public.mantenimiento_repuestos TO service_role;
GRANT SELECT ON TABLE public.vista_historia_maquina TO service_role;

REVOKE ALL ON FUNCTION public.iniciar_mantenimiento_preventivo(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.usar_repuesto_en_mantenimiento(UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_repuesto_de_mantenimiento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.terminar_mantenimiento_preventivo(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_mantenimiento_preventivo(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.usar_repuesto_en_mantenimiento(UUID, UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quitar_repuesto_de_mantenimiento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminar_mantenimiento_preventivo(UUID, TEXT, NUMERIC) TO authenticated, service_role;

COMMIT;
