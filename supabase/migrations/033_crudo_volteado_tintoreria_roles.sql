-- ==============================================================================
-- Migración 033: Fase 5B — medias en crudo, Volteado, Tintorería y bloqueo por rol
-- Spec: 02-DOCS/wiki/sdd/specs/fase-5-flujo-produccion.md (aprobada 2026-11-26)
-- Plan: 02-DOCS/wiki/sdd/plans/fase-5b-crudo-volteado-tintoreria.md
--
-- 1. Roles y módulos en la base: modulos_por_rol (= MODULOS_POR_ROL de
--    lib/utils/index.ts; una prueba compara las dos) y exigir_modulo(). Las
--    funciones de producción rechazan a quien no tenga el módulo (decisión del dueño).
--    Se permite el rol "volteador" (la 029 lo dejó fuera) y se crea "tintorero".
-- 2. Sin escritura directa de authenticated en las tablas de proceso: solo por funciones.
-- 3. Crudo: catalogo_medias.es_crudo y una media cruda por modelo, público y talla (Q1-A).
-- 4. Remallado → por voltear (si es cruda) → Volteado → por teñir → Tintorería →
--    por planchar con su SKU de color, con merma y motivo.
-- 5. Stock de fuera también en Remallado (solo registro), Volteado y Tintorería.
--
-- Lo ya registrado no se borra; lo que está en proceso con color sigue a planchado.
-- Reversión: supabase/scripts/revertir_033.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ROLES Y MÓDULOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol = ANY (ARRAY[
  'admin', 'supervisor', 'disenador', 'tejedor', 'remalladora', 'remallador', 'volteador', 'tintorero', 'planchador',
  'preparador', 'almacenero', 'vendedora', 'operador']));

CREATE TABLE IF NOT EXISTS public.modulos_por_rol (
  rol    TEXT NOT NULL,
  modulo TEXT NOT NULL,
  PRIMARY KEY (rol, modulo)
);
INSERT INTO public.modulos_por_rol (rol, modulo) VALUES
  ('admin', 'admin'),
  ('admin', 'usuarios'),
  ('admin', 'catalogo'),
  ('admin', 'maquinas'),
  ('admin', 'disenos'),
  ('admin', 'produccion'),
  ('admin', 'remallado'),
  ('admin', 'volteado'),
  ('admin', 'tintoreria'),
  ('admin', 'planchado'),
  ('admin', 'preparado'),
  ('admin', 'almacen'),
  ('admin', 'ventas'),
  ('admin', 'clientes'),
  ('admin', 'despacho'),
  ('admin', 'mantenimiento'),
  ('admin', 'materia_prima'),
  ('admin', 'reportes'),
  ('admin', 'egresos'),
  ('admin', 'balance'),
  ('admin', 'calendario'),
  ('supervisor', 'usuarios'),
  ('supervisor', 'catalogo'),
  ('supervisor', 'maquinas'),
  ('supervisor', 'disenos'),
  ('supervisor', 'produccion'),
  ('supervisor', 'remallado'),
  ('supervisor', 'volteado'),
  ('supervisor', 'tintoreria'),
  ('supervisor', 'planchado'),
  ('supervisor', 'preparado'),
  ('supervisor', 'almacen'),
  ('supervisor', 'ventas'),
  ('supervisor', 'clientes'),
  ('supervisor', 'despacho'),
  ('supervisor', 'materia_prima'),
  ('supervisor', 'reportes'),
  ('supervisor', 'calendario'),
  ('disenador', 'disenos'),
  ('disenador', 'catalogo'),
  ('disenador', 'maquinas'),
  ('tejedor', 'produccion'),
  ('tejedor', 'disenos'),
  ('tejedor', 'mantenimiento'),
  ('remalladora', 'remallado'),
  ('remalladora', 'mantenimiento'),
  ('remallador', 'remallado'),
  ('remallador', 'mantenimiento'),
  ('volteador', 'volteado'),
  ('tintorero', 'tintoreria'),
  ('planchador', 'planchado'),
  ('planchador', 'mantenimiento'),
  ('preparador', 'preparado'),
  ('almacenero', 'almacen'),
  ('almacenero', 'despacho'),
  ('almacenero', 'materia_prima'),
  ('vendedora', 'ventas'),
  ('vendedora', 'clientes'),
  ('vendedora', 'catalogo'),
  ('vendedora', 'despacho'),
  ('operador', 'produccion'),
  ('operador', 'remallado'),
  ('operador', 'tintoreria'),
  ('operador', 'disenos'),
  ('operador', 'planchado'),
  ('operador', 'preparado'),
  ('operador', 'almacen'),
  ('operador', 'mantenimiento')
ON CONFLICT DO NOTHING;

-- Quien llama debe tener una sesión de un usuario activo cuyo rol incluya el módulo
CREATE OR REPLACE FUNCTION public.exigir_modulo(p_modulo TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM usuarios u JOIN modulos_por_rol mr ON mr.rol = u.rol
     WHERE u.id = v_uid AND u.activo AND mr.modulo = p_modulo
  ) THEN
    RAISE EXCEPTION 'Tu rol no tiene acceso al módulo %', p_modulo;
  END IF;
  RETURN v_uid;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. CRUDO, POR TEÑIR Y TINTORERÍA
-- ------------------------------------------------------------------------------
ALTER TABLE public.catalogo_medias ADD COLUMN IF NOT EXISTS es_crudo BOOLEAN NOT NULL DEFAULT false;

-- Una sola media cruda por modelo, público y talla
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_medias_un_crudo_uq ON public.catalogo_medias (modelo, publico, talla) WHERE es_crudo;

-- Crea la media cruda de cada grupo que no la tiene (toma peso e hilo del primero del grupo).
-- El código es CRUDO-<MODELO>-<PÚBLICO>-<TALLA>; si dos grupos dan el mismo código
-- (por ejemplo "Clasica" y "clasica") se numera, y si aun así un grupo queda sin
-- crudo la migración falla en lugar de saltarlo en silencio. Devuelve cuántos creó.
CREATE OR REPLACE FUNCTION public.crear_crudos_faltantes()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n     INTEGER;
  v_falta RECORD;
BEGIN
  WITH grupos AS (
    SELECT DISTINCT ON (c.modelo, c.publico, c.talla) c.modelo, c.publico, c.talla, c.peso_docena_g, c.materia_prima_id,
           'CRUDO-' || upper(regexp_replace(btrim(c.modelo), '\s+', '-', 'g')) || '-' || upper(regexp_replace(btrim(c.publico), '\s+', '-', 'g'))
             || '-' || upper(regexp_replace(btrim(c.talla), '\s+', '-', 'g')) AS base
      FROM catalogo_medias c
     WHERE NOT c.es_crudo
       AND NOT EXISTS (SELECT 1 FROM catalogo_medias x WHERE x.es_crudo AND x.modelo = c.modelo AND x.publico = c.publico AND x.talla = c.talla)
     ORDER BY c.modelo, c.publico, c.talla, c.codigo
  ), numerados AS (
    SELECT g.*, row_number() OVER (PARTITION BY g.base ORDER BY g.modelo, g.publico, g.talla) AS n FROM grupos g
  )
  INSERT INTO catalogo_medias (codigo, modelo, publico, diseno_color, talla, costo_produccion_docena, estado, peso_docena_g, materia_prima_id, es_crudo)
  SELECT CASE WHEN n = 1 AND NOT EXISTS (SELECT 1 FROM catalogo_medias y WHERE y.codigo = base) THEN base ELSE base || '-' || n END,
         modelo, publico, 'CRUDO', talla, 0, 'activo', peso_docena_g, materia_prima_id, true
    FROM numerados;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  SELECT c.modelo, c.publico, c.talla INTO v_falta FROM catalogo_medias c
   WHERE NOT c.es_crudo AND NOT EXISTS (SELECT 1 FROM catalogo_medias x WHERE x.es_crudo AND x.modelo = c.modelo AND x.publico = c.publico AND x.talla = c.talla)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'No se pudo crear la media cruda de % / % / %', v_falta.modelo, v_falta.publico, v_falta.talla;
  END IF;
  RETURN v_n;
END;
$$;
SELECT public.crear_crudos_faltantes();

-- Marcar o desmarcar "cruda": con sesión exige el módulo Catálogo, y no se cambia si el
-- producto tiene stock o lotes en proceso (si no, ese stock quedaría atascado en la etapa equivocada)
CREATE OR REPLACE FUNCTION public.proteger_es_crudo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.es_crudo IS NOT DISTINCT FROM OLD.es_crudo THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.es_crudo THEN RETURN NEW; END IF;
  IF current_user IN ('authenticated', 'anon') AND NOT EXISTS (
    SELECT 1 FROM usuarios u JOIN modulos_por_rol mr ON mr.rol = u.rol
     WHERE u.id = auth.uid() AND u.activo AND mr.modulo = 'catalogo'
  ) THEN
    RAISE EXCEPTION 'Tu rol no tiene acceso al módulo catalogo';
  END IF;
  IF TG_OP = 'UPDATE' AND (
       EXISTS (SELECT 1 FROM stock_listo_voltear WHERE catalogo_media_id = OLD.id AND docenas > 0)
    OR EXISTS (SELECT 1 FROM stock_listo_tenir WHERE catalogo_media_id = OLD.id AND docenas > 0)
    OR EXISTS (SELECT 1 FROM stock_listo_planchar WHERE catalogo_media_id = OLD.id AND docenas > 0)
    OR EXISTS (SELECT 1 FROM stock_listo_preparar WHERE catalogo_media_id = OLD.id AND docenas > 0)
    OR EXISTS (SELECT 1 FROM lotes_remallado WHERE catalogo_media_id = OLD.id AND estado = 'en_proceso')
    OR EXISTS (SELECT 1 FROM lotes_volteado WHERE catalogo_media_id = OLD.id AND estado = 'en_proceso')
    OR EXISTS (SELECT 1 FROM lotes_tintoreria WHERE (crudo_id = OLD.id OR color_id = OLD.id) AND estado = 'en_tintoreria')
    OR EXISTS (SELECT 1 FROM productos_maquina WHERE catalogo_media_id = OLD.id AND hasta IS NULL)
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar si % es cruda: tiene stock, lotes en proceso o una máquina que la teje', OLD.codigo;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.stock_listo_tenir (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogo_media_id UUID NOT NULL UNIQUE REFERENCES public.catalogo_medias(id),
  docenas           NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (docenas >= 0),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lotes_tintoreria (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crudo_id           UUID NOT NULL REFERENCES public.catalogo_medias(id),
  color_id           UUID NOT NULL REFERENCES public.catalogo_medias(id),
  material           TEXT NOT NULL CHECK (material IN ('algodon', 'poliester')),
  docenas_enviadas   NUMERIC(10,2) NOT NULL CHECK (docenas_enviadas > 0),
  remalladora_id     UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  estado             TEXT NOT NULL DEFAULT 'en_tintoreria' CHECK (estado IN ('en_tintoreria', 'recibido')),
  docenas_recibidas  NUMERIC(10,2) CHECK (docenas_recibidas >= 0),
  docenas_merma      NUMERIC(10,2) CHECK (docenas_merma >= 0),
  motivo_merma       TEXT,
  enviado_por        UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  recibido_por       UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  fecha_envio        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_recepcion    TIMESTAMPTZ,
  CHECK (estado = 'en_tintoreria' OR (docenas_recibidas IS NOT NULL AND docenas_recibidas + docenas_merma = docenas_enviadas))
);
CREATE INDEX IF NOT EXISTS lotes_tintoreria_estado_idx ON public.lotes_tintoreria (estado);

DROP TRIGGER IF EXISTS catalogo_medias_proteger_es_crudo ON public.catalogo_medias;
CREATE TRIGGER catalogo_medias_proteger_es_crudo BEFORE INSERT OR UPDATE OF es_crudo ON public.catalogo_medias
  FOR EACH ROW EXECUTE FUNCTION public.proteger_es_crudo();

-- Stock de fuera: también en Remallado (solo registro), Volteado y Tintorería
ALTER TABLE public.ingresos_stock_fuera DROP CONSTRAINT IF EXISTS ingresos_stock_fuera_etapa_check;
ALTER TABLE public.ingresos_stock_fuera ADD CONSTRAINT ingresos_stock_fuera_etapa_check
  CHECK (etapa IN ('remallado', 'volteado', 'tintoreria', 'planchado', 'preparado'));

-- ------------------------------------------------------------------------------
-- 3. FUNCIONES DE PRODUCCIÓN CON BLOQUEO POR ROL
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iniciar_lote_remallado(p_maquina_id uuid, p_remalladora_id uuid, p_catalogo_media_id uuid, p_docenas numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_maq     RECORD;
  v_lote_id UUID;
BEGIN
  PERFORM exigir_modulo('remallado');  -- 033: el rol debe tener el módulo
  IF p_remalladora_id IS NULL THEN RAISE EXCEPTION 'Selecciona una operadora remalladora'; END IF;
  IF p_catalogo_media_id IS NULL THEN RAISE EXCEPTION 'Selecciona el tipo de media a remallar'; END IF;
  IF COALESCE(p_docenas, 0) <= 0 THEN RAISE EXCEPTION 'Las docenas asignadas deben ser mayores a 0'; END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = p_maquina_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona una máquina remalladora'; END IF;
  IF v_maq.estado <> 'activa' THEN
    RAISE EXCEPTION 'La máquina % no está disponible (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  INSERT INTO lotes_remallado (catalogo_media_id, remalladora_id, maquina_remalladora_id, docenas_asignadas, docenas_pendientes, estado)
  VALUES (p_catalogo_media_id, p_remalladora_id, p_maquina_id, p_docenas, p_docenas, 'en_proceso')
  RETURNING id INTO v_lote_id;

  UPDATE maquinas SET estado = 'ocupada' WHERE id = p_maquina_id;
  UPDATE usuarios SET estado = 'ocupada' WHERE id = p_remalladora_id;

  RETURN v_lote_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.traspasar_lote_remallado(p_lote_origen_id uuid, p_remalladora_destino_id uuid, p_maquina_destino_id uuid, p_docenas numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_origen  RECORD;
  v_maq     RECORD;
  v_lote_id UUID;
BEGIN
  PERFORM exigir_modulo('remallado');  -- 033: el rol debe tener el módulo
  IF COALESCE(p_docenas, 0) <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_remalladora_destino_id IS NULL THEN RAISE EXCEPTION 'Selecciona la remalladora destino'; END IF;

  SELECT id, catalogo_media_id, docenas_pendientes, estado INTO v_origen
    FROM lotes_remallado WHERE id = p_lote_origen_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de origen no encontrado'; END IF;
  IF v_origen.estado <> 'en_proceso' THEN
    RAISE EXCEPTION 'Solo se puede traspasar desde un lote en proceso (estado: %)', v_origen.estado;
  END IF;
  IF p_docenas > v_origen.docenas_pendientes THEN
    RAISE EXCEPTION 'La cantidad a traspasar (%) excede las docenas pendientes del lote de origen (%)', p_docenas, v_origen.docenas_pendientes;
  END IF;

  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = p_maquina_destino_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona la máquina destino'; END IF;
  IF v_maq.estado <> 'activa' THEN
    RAISE EXCEPTION 'La máquina destino % no está disponible (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  UPDATE lotes_remallado SET docenas_pendientes = docenas_pendientes - p_docenas WHERE id = p_lote_origen_id;

  INSERT INTO lotes_remallado (catalogo_media_id, remalladora_id, maquina_remalladora_id, docenas_asignadas, docenas_pendientes, estado)
  VALUES (v_origen.catalogo_media_id, p_remalladora_destino_id, p_maquina_destino_id, p_docenas, p_docenas, 'en_proceso')
  RETURNING id INTO v_lote_id;

  UPDATE maquinas SET estado = 'ocupada' WHERE id = p_maquina_destino_id;
  UPDATE usuarios SET estado = 'ocupada' WHERE id = p_remalladora_destino_id;

  RETURN v_lote_id;
END;
$function$;

-- Terminar remallado: el producto sale del lote (antes lo mandaba la pantalla).
-- Si es crudo queda por voltear; un lote con color (de antes) sigue a por planchar.
CREATE OR REPLACE FUNCTION public.finalizar_lote_remallado(p_lote_id uuid, p_docenas_remalladas numeric, p_docenas_restantes numeric, p_catalogo_media_id uuid, p_remalladora_id uuid, p_maquina_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lote  RECORD;
  v_crudo BOOLEAN;
BEGIN
  PERFORM exigir_modulo('remallado');
  IF p_docenas_remalladas IS NULL OR p_docenas_remalladas = 'NaN'::numeric OR p_docenas_remalladas < 0
     OR COALESCE(p_docenas_restantes, 0) < 0 OR p_docenas_restantes = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;
  SELECT id, catalogo_media_id, estado, docenas_pendientes INTO v_lote FROM lotes_remallado WHERE id = p_lote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de remallado no encontrado'; END IF;
  IF v_lote.estado <> 'en_proceso' THEN RAISE EXCEPTION 'Este lote ya no está en proceso (estado: %)', v_lote.estado; END IF;
  IF p_docenas_remalladas > v_lote.docenas_pendientes THEN
    RAISE EXCEPTION 'Se remallan % docenas y el lote tiene % pendientes', p_docenas_remalladas, v_lote.docenas_pendientes;
  END IF;
  SELECT es_crudo INTO v_crudo FROM catalogo_medias WHERE id = v_lote.catalogo_media_id;

  INSERT INTO reportes_remallado (lote_id, remalladora_id, maquina_id, docenas_remalladas, docenas_restantes, fecha)
  VALUES (p_lote_id, p_remalladora_id, p_maquina_id, p_docenas_remalladas, COALESCE(p_docenas_restantes, 0), (NOW() AT TIME ZONE 'America/Lima')::date);

  UPDATE lotes_remallado SET estado = 'completado', docenas_pendientes = COALESCE(p_docenas_restantes, 0) WHERE id = p_lote_id;

  IF p_docenas_remalladas > 0 THEN
    IF v_crudo THEN
      INSERT INTO stock_listo_voltear (catalogo_media_id, docenas) VALUES (v_lote.catalogo_media_id, p_docenas_remalladas)
      ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_voltear.docenas + EXCLUDED.docenas, updated_at = NOW();
    ELSE
      INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES (v_lote.catalogo_media_id, p_docenas_remalladas)
      ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_planchar.docenas + EXCLUDED.docenas, updated_at = NOW();
    END IF;
  END IF;

  IF p_remalladora_id IS NOT NULL THEN UPDATE usuarios SET estado = 'disponible' WHERE id = p_remalladora_id; END IF;
  IF p_maquina_id IS NOT NULL THEN UPDATE maquinas SET estado = 'activa' WHERE id = p_maquina_id; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_tejido(p_fecha date, p_horario text, p_encargado_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hoy   DATE := (NOW() AT TIME ZONE 'America/Lima')::date;
  v_fecha DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_turno RECORD;
  v_tid   UUID;
  v_r     RECORD;
  v_req   RECORD;
  v_mp    RECORD;
BEGIN
  PERFORM exigir_modulo('produccion');  -- 033: el rol debe tener el módulo
  IF p_horario IS NULL OR p_horario NOT IN ('dia', 'noche') THEN RAISE EXCEPTION 'Elige el turno: día o noche'; END IF;
  IF v_fecha > v_hoy THEN RAISE EXCEPTION 'No se registra producción de una fecha futura'; END IF;
  IF p_encargado_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_encargado_id AND activo) THEN
    RAISE EXCEPTION 'Elige el encargado del turno';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Anota la producción de al menos una máquina';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS t_items_tejido (maquina_id UUID, docenas NUMERIC, operario_id UUID) ON COMMIT DROP;
  TRUNCATE t_items_tejido;
  INSERT INTO t_items_tejido SELECT * FROM jsonb_to_recordset(p_items) AS i(maquina_id UUID, docenas NUMERIC, operario_id UUID);
  IF EXISTS (SELECT 1 FROM t_items_tejido WHERE maquina_id IS NULL) THEN RAISE EXCEPTION 'Falta la máquina en una fila'; END IF;
  IF (SELECT count(*) <> count(DISTINCT maquina_id) FROM t_items_tejido) THEN RAISE EXCEPTION 'Una máquina aparece más de una vez'; END IF;
  IF EXISTS (SELECT 1 FROM t_items_tejido WHERE docenas IS NULL OR docenas = 'NaN'::numeric OR docenas < 0 OR docenas > 10000) THEN
    RAISE EXCEPTION 'Las docenas deben ser un número entre 0 y 10 000';
  END IF;
  IF EXISTS (SELECT 1 FROM t_items_tejido i WHERE i.operario_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = i.operario_id AND u.activo)) THEN
    RAISE EXCEPTION 'Elige el operario de cada máquina';
  END IF;

  -- Máquinas: bloqueadas en orden; tejedoras, en marcha y con producto vigente
  PERFORM 1 FROM maquinas WHERE id IN (SELECT maquina_id FROM t_items_tejido) ORDER BY id FOR UPDATE;
  FOR v_r IN
    SELECT i.maquina_id, m.codigo, m.tipo, m.estado, pm.catalogo_media_id
      FROM t_items_tejido i
      LEFT JOIN maquinas m ON m.id = i.maquina_id
      LEFT JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL
     ORDER BY m.codigo
  LOOP
    IF v_r.codigo IS NULL THEN RAISE EXCEPTION 'Una de las máquinas no existe'; END IF;
    IF v_r.tipo <> 'tejedora' THEN RAISE EXCEPTION 'La máquina % no es tejedora', v_r.codigo; END IF;
    IF v_r.estado IN ('malograda', 'mantenimiento', 'inactiva') THEN
      RAISE EXCEPTION 'La máquina % está % y no registra producción', v_r.codigo, v_r.estado;
    END IF;
    IF v_r.catalogo_media_id IS NULL THEN RAISE EXCEPTION 'La máquina % no tiene producto asignado', v_r.codigo; END IF;
  END LOOP;

  -- Turno de esa fecha y horario (se crea la primera vez)
  INSERT INTO turnos_produccion (tejedor_id, fecha, horario, duracion_horas, estado, registro_24_6)
  VALUES (p_encargado_id, v_fecha, p_horario, 12, 'cerrado', true)
  ON CONFLICT (fecha, horario) WHERE registro_24_6 DO NOTHING;
  SELECT id, tejedor_id INTO v_turno FROM turnos_produccion WHERE fecha = v_fecha AND horario = p_horario AND registro_24_6 FOR UPDATE;
  v_tid := v_turno.id;
  IF v_turno.tejedor_id IS DISTINCT FROM p_encargado_id THEN
    RAISE EXCEPTION 'El turno ya tiene otro encargado (%)', (SELECT nombre FROM usuarios WHERE id = v_turno.tejedor_id);
  END IF;
  SELECT m.codigo INTO v_r FROM reportes_produccion r JOIN maquinas m ON m.id = r.maquina_id
   WHERE r.turno_id = v_tid AND r.maquina_id IN (SELECT maquina_id FROM t_items_tejido) ORDER BY m.codigo LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'La máquina % ya está registrada en este turno', v_r.codigo; END IF;

  -- Hilo por las docenas reales: docenas × peso por docena (bloqueando cada materia prima)
  FOR v_req IN
    SELECT c.materia_prima_id, SUM(i.docenas * COALESCE(c.peso_docena_g, 360) / 1000.0) AS necesario
      FROM t_items_tejido i
      JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL
      JOIN catalogo_medias c ON c.id = pm.catalogo_media_id
     WHERE c.materia_prima_id IS NOT NULL AND i.docenas > 0
     GROUP BY c.materia_prima_id ORDER BY c.materia_prima_id
  LOOP
    SELECT material, color, stock_kg INTO v_mp FROM materia_prima WHERE id = v_req.materia_prima_id FOR UPDATE;
    IF v_mp.stock_kg < v_req.necesario THEN
      RAISE EXCEPTION 'Falta de materia prima: se requieren % kg de % % pero solo quedan % kg',
        round(v_req.necesario, 2), v_mp.material, v_mp.color, round(v_mp.stock_kg, 2);
    END IF;
    UPDATE materia_prima SET stock_kg = stock_kg - v_req.necesario WHERE id = v_req.materia_prima_id;
    INSERT INTO movimientos_materia_prima (materia_prima_id, tipo, cantidad_kg, referencia_id)
    VALUES (v_req.materia_prima_id, 'consumo_produccion', v_req.necesario, v_tid);
  END LOOP;

  INSERT INTO reportes_produccion (turno_id, maquina_id, catalogo_media_id, docenas_producidas, fecha, operario_id, registrado_por)
  SELECT v_tid, i.maquina_id, pm.catalogo_media_id, round(i.docenas, 2), v_fecha, i.operario_id, auth.uid()
    FROM t_items_tejido i
    JOIN productos_maquina pm ON pm.maquina_id = i.maquina_id AND pm.hasta IS NULL;
  RETURN v_tid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_planchado(p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req   RECORD;
  v_stock NUMERIC;
  v_media TEXT;
  v_n     INTEGER;
BEGIN
  PERFORM exigir_modulo('planchado');  -- 033: el rol debe tener el módulo
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
    WHERE COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Ingresa al menos una docena planchada o defectuosa para guardar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
    WHERE COALESCE(i.docenas_planchadas, 0) < 0 OR COALESCE(i.docenas_defectuosas, 0) < 0 OR i.catalogo_media_id IS NULL
       OR i.docenas_planchadas = 'NaN'::numeric OR i.docenas_defectuosas = 'NaN'::numeric
  ) THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;

  FOR v_req IN
    SELECT i.catalogo_media_id, SUM(COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0)) AS total,
           SUM(COALESCE(i.docenas_planchadas, 0)) AS buenas
      FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
     GROUP BY i.catalogo_media_id
     HAVING SUM(COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0)) > 0
     ORDER BY i.catalogo_media_id
  LOOP
    SELECT docenas INTO v_stock FROM stock_listo_planchar WHERE catalogo_media_id = v_req.catalogo_media_id FOR UPDATE;
    IF COALESCE(v_stock, 0) < v_req.total THEN
      SELECT codigo INTO v_media FROM catalogo_medias WHERE id = v_req.catalogo_media_id;
      RAISE EXCEPTION 'No hay suficiente stock listo para planchar de %: se registran % docenas y hay %',
        COALESCE(v_media, 'la media'), v_req.total, COALESCE(v_stock, 0);
    END IF;
    UPDATE stock_listo_planchar SET docenas = docenas - v_req.total, updated_at = NOW()
     WHERE catalogo_media_id = v_req.catalogo_media_id;
    IF v_req.buenas > 0 THEN
      INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES (v_req.catalogo_media_id, v_req.buenas)
      ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_preparar.docenas + EXCLUDED.docenas, updated_at = NOW();
    END IF;
  END LOOP;

  INSERT INTO reportes_planchado (planchador_id, catalogo_media_id, docenas_planchadas, docenas_defectuosas, fecha)
  SELECT i.planchador_id, i.catalogo_media_id, COALESCE(i.docenas_planchadas, 0), COALESCE(i.docenas_defectuosas, 0),
         (NOW() AT TIME ZONE 'America/Lima')::date
    FROM jsonb_to_recordset(p_items) AS i(planchador_id UUID, catalogo_media_id UUID, docenas_planchadas NUMERIC, docenas_defectuosas NUMERIC)
   WHERE COALESCE(i.docenas_planchadas, 0) + COALESCE(i.docenas_defectuosas, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_produccion_preparado(p_preparador_id uuid, p_codigo_paquete text, p_ubicacion_id uuid, p_items jsonb, p_qr_data text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req     RECORD;
  v_stock   NUMERIC;
  v_media   TEXT;
  v_total   NUMERIC;
  v_paq     UUID;
BEGIN
  PERFORM exigir_modulo('preparado');  -- 033: el rol debe tener el módulo
  IF p_preparador_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_preparador_id AND activo) THEN
    RAISE EXCEPTION 'Elige el preparador';
  END IF;
  IF p_codigo_paquete IS NULL OR btrim(p_codigo_paquete) = '' THEN RAISE EXCEPTION 'Falta el código del saco'; END IF;
  IF p_ubicacion_id IS NULL OR NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id AND activo) THEN
    RAISE EXCEPTION 'Elige el salón que recibe el saco';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Anota las docenas preparadas';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS t_items_preparado (catalogo_media_id UUID, docenas NUMERIC, defectuosas NUMERIC) ON COMMIT DROP;
  TRUNCATE t_items_preparado;
  INSERT INTO t_items_preparado SELECT * FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, defectuosas NUMERIC);
  IF EXISTS (SELECT 1 FROM t_items_preparado WHERE catalogo_media_id IS NULL
             OR COALESCE(docenas, 0) < 0 OR COALESCE(defectuosas, 0) < 0
             OR docenas = 'NaN'::numeric OR defectuosas = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'Las docenas no pueden ser negativas';
  END IF;
  SELECT COALESCE(sum(COALESCE(docenas, 0)), 0) INTO v_total FROM t_items_preparado;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El saco debe llevar al menos una docena preparada'; END IF;

  FOR v_req IN
    SELECT catalogo_media_id, SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) AS total
      FROM t_items_preparado GROUP BY catalogo_media_id
     HAVING SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) > 0
     ORDER BY catalogo_media_id
  LOOP
    SELECT docenas INTO v_stock FROM stock_listo_preparar WHERE catalogo_media_id = v_req.catalogo_media_id FOR UPDATE;
    IF COALESCE(v_stock, 0) < v_req.total THEN
      SELECT codigo INTO v_media FROM catalogo_medias WHERE id = v_req.catalogo_media_id;
      RAISE EXCEPTION 'No hay suficiente stock por preparar de %: se registran % docenas y hay %',
        COALESCE(v_media, 'la media'), v_req.total, COALESCE(v_stock, 0);
    END IF;
    UPDATE stock_listo_preparar SET docenas = docenas - v_req.total, updated_at = NOW()
     WHERE catalogo_media_id = v_req.catalogo_media_id;
  END LOOP;

  INSERT INTO paquetes (codigo_paquete, preparador_id, catalogo_media_id, docenas, total_pares, qr_data, detalles_contenido, estado, ubicacion_id, fecha)
  VALUES (btrim(p_codigo_paquete), p_preparador_id,
          (SELECT catalogo_media_id FROM t_items_preparado WHERE COALESCE(docenas, 0) > 0 ORDER BY docenas DESC, catalogo_media_id LIMIT 1),
          v_total, round(v_total * 12), p_qr_data,
          (SELECT jsonb_agg(jsonb_build_object('catalogo_media_id', c.id, 'sku', COALESCE(c.sku, 'SKU-' || upper(c.codigo)), 'codigo', c.codigo,
                                               'docenas', x.docenas, 'pares', round(x.docenas * 12)) ORDER BY c.codigo)
             FROM (SELECT catalogo_media_id, SUM(COALESCE(docenas, 0)) AS docenas FROM t_items_preparado GROUP BY catalogo_media_id
                    HAVING SUM(COALESCE(docenas, 0)) > 0) x
             JOIN catalogo_medias c ON c.id = x.catalogo_media_id),
          'pendiente_almacenar', p_ubicacion_id,
          (NOW() AT TIME ZONE 'America/Lima')::date)
  RETURNING id INTO v_paq;

  INSERT INTO reportes_preparado (preparador_id, catalogo_media_id, paquete_id, docenas_preparadas, docenas_defectuosas, registrado_por)
  SELECT p_preparador_id, catalogo_media_id, v_paq, SUM(COALESCE(docenas, 0)), SUM(COALESCE(defectuosas, 0)), auth.uid()
    FROM t_items_preparado GROUP BY catalogo_media_id
   HAVING SUM(COALESCE(docenas, 0) + COALESCE(defectuosas, 0)) > 0;
  RETURN v_paq;
END;
$function$;

-- Volteado: tomar de por voltear
CREATE OR REPLACE FUNCTION public.iniciar_lote_volteado(p_volteador_id UUID, p_catalogo_media_id UUID, p_docenas NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stock NUMERIC;
  v_media TEXT;
  v_id    UUID;
BEGIN
  PERFORM exigir_modulo('volteado');
  IF p_volteador_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_volteador_id AND activo) THEN
    RAISE EXCEPTION 'Elige quién voltea';
  END IF;
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas <= 0 THEN RAISE EXCEPTION 'Las docenas deben ser mayores a 0'; END IF;
  SELECT docenas INTO v_stock FROM stock_listo_voltear WHERE catalogo_media_id = p_catalogo_media_id FOR UPDATE;
  IF COALESCE(v_stock, 0) < p_docenas THEN
    SELECT codigo INTO v_media FROM catalogo_medias WHERE id = p_catalogo_media_id;
    RAISE EXCEPTION 'No hay suficiente stock por voltear de %: se asignan % docenas y hay %', COALESCE(v_media, 'la media'), p_docenas, COALESCE(v_stock, 0);
  END IF;
  UPDATE stock_listo_voltear SET docenas = docenas - p_docenas, updated_at = NOW() WHERE catalogo_media_id = p_catalogo_media_id;
  INSERT INTO lotes_volteado (volteador_id, catalogo_media_id, docenas_asignadas, docenas_pendientes, estado)
  VALUES (p_volteador_id, p_catalogo_media_id, p_docenas, p_docenas, 'en_proceso')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Volteado: reportar lo volteado; si es crudo queda por teñir, si no por planchar
CREATE OR REPLACE FUNCTION public.reportar_lote_volteado(p_lote_id UUID, p_docenas NUMERIC, p_pares_defectuosos INTEGER, p_comentarios TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lote  RECORD;
  v_crudo BOOLEAN;
  v_pend  NUMERIC;
BEGIN
  PERFORM exigir_modulo('volteado');
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas <= 0 THEN RAISE EXCEPTION 'Ingresa las docenas volteadas'; END IF;
  IF COALESCE(p_pares_defectuosos, 0) < 0 THEN RAISE EXCEPTION 'Los pares defectuosos no pueden ser negativos'; END IF;
  SELECT id, volteador_id, catalogo_media_id, docenas_pendientes, estado INTO v_lote FROM lotes_volteado WHERE id = p_lote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de volteado no encontrado'; END IF;
  IF v_lote.estado <> 'en_proceso' THEN RAISE EXCEPTION 'Este lote ya está completado'; END IF;
  IF p_docenas > v_lote.docenas_pendientes THEN
    RAISE EXCEPTION 'Se reportan % docenas y el lote tiene % pendientes', p_docenas, v_lote.docenas_pendientes;
  END IF;
  SELECT es_crudo INTO v_crudo FROM catalogo_medias WHERE id = v_lote.catalogo_media_id;

  INSERT INTO reportes_volteado (lote_volteado_id, volteador_id, catalogo_media_id, docenas_volteadas, pares_defectuosos, comentarios, fecha)
  VALUES (v_lote.id, v_lote.volteador_id, v_lote.catalogo_media_id, p_docenas, COALESCE(p_pares_defectuosos, 0),
          NULLIF(btrim(COALESCE(p_comentarios, '')), ''), (NOW() AT TIME ZONE 'America/Lima')::date);
  v_pend := v_lote.docenas_pendientes - p_docenas;
  UPDATE lotes_volteado SET docenas_pendientes = v_pend, estado = CASE WHEN v_pend = 0 THEN 'completado' ELSE 'en_proceso' END WHERE id = v_lote.id;

  IF v_crudo THEN
    INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES (v_lote.catalogo_media_id, p_docenas)
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_tenir.docenas + EXCLUDED.docenas, updated_at = NOW();
  ELSE
    INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES (v_lote.catalogo_media_id, p_docenas)
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_planchar.docenas + EXCLUDED.docenas, updated_at = NOW();
  END IF;
END;
$$;

-- Tintorería: enviar un lote crudo con su SKU de color de destino
CREATE OR REPLACE FUNCTION public.enviar_lote_tintoreria(p_crudo_id UUID, p_color_id UUID, p_material TEXT, p_docenas NUMERIC, p_remalladora_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   UUID := exigir_modulo('tintoreria');
  v_crudo RECORD;
  v_color RECORD;
  v_stock NUMERIC;
  v_id    UUID;
BEGIN
  SELECT id, codigo, modelo, publico, talla, es_crudo INTO v_crudo FROM catalogo_medias WHERE id = p_crudo_id;
  IF NOT FOUND OR NOT v_crudo.es_crudo THEN RAISE EXCEPTION 'Elige la media cruda que se envía'; END IF;
  SELECT id, codigo, modelo, publico, talla, es_crudo, estado INTO v_color FROM catalogo_medias WHERE id = p_color_id;
  IF NOT FOUND OR v_color.es_crudo THEN RAISE EXCEPTION 'Elige el SKU de color en que vuelve'; END IF;
  IF v_color.estado <> 'activo' THEN RAISE EXCEPTION 'El SKU % está inactivo', v_color.codigo; END IF;
  IF v_color.modelo <> v_crudo.modelo OR v_color.publico <> v_crudo.publico OR v_color.talla <> v_crudo.talla THEN
    RAISE EXCEPTION 'El SKU % no es de la misma media (modelo, público y talla) que %', v_color.codigo, v_crudo.codigo;
  END IF;
  IF p_material IS NULL OR p_material NOT IN ('algodon', 'poliester') THEN RAISE EXCEPTION 'Elige el material: algodón o poliéster'; END IF;
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas <= 0 THEN RAISE EXCEPTION 'Las docenas deben ser mayores a 0'; END IF;
  IF p_remalladora_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_remalladora_id) THEN
    RAISE EXCEPTION 'Elige la operadora que remalló';
  END IF;
  SELECT docenas INTO v_stock FROM stock_listo_tenir WHERE catalogo_media_id = p_crudo_id FOR UPDATE;
  IF COALESCE(v_stock, 0) < p_docenas THEN
    RAISE EXCEPTION 'No hay suficiente stock por teñir de %: se envían % docenas y hay %', v_crudo.codigo, p_docenas, COALESCE(v_stock, 0);
  END IF;
  UPDATE stock_listo_tenir SET docenas = docenas - p_docenas, updated_at = NOW() WHERE catalogo_media_id = p_crudo_id;
  INSERT INTO lotes_tintoreria (crudo_id, color_id, material, docenas_enviadas, remalladora_id, enviado_por)
  VALUES (p_crudo_id, p_color_id, p_material, round(p_docenas, 2), p_remalladora_id, v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Tintorería: recibir el lote teñido; la diferencia es merma con motivo
CREATE OR REPLACE FUNCTION public.recibir_lote_tintoreria(p_lote_id UUID, p_docenas_recibidas NUMERIC, p_motivo_merma TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   UUID := exigir_modulo('tintoreria');
  v_lote  RECORD;
  v_merma NUMERIC;
BEGIN
  IF p_docenas_recibidas IS NULL OR p_docenas_recibidas = 'NaN'::numeric OR p_docenas_recibidas < 0 THEN
    RAISE EXCEPTION 'Ingresa las docenas recibidas';
  END IF;
  SELECT id, color_id, docenas_enviadas, estado INTO v_lote FROM lotes_tintoreria WHERE id = p_lote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de tintorería no encontrado'; END IF;
  IF v_lote.estado <> 'en_tintoreria' THEN RAISE EXCEPTION 'Este lote ya fue recibido'; END IF;
  IF round(p_docenas_recibidas, 2) > v_lote.docenas_enviadas THEN
    RAISE EXCEPTION 'Se reciben % docenas y se enviaron %', round(p_docenas_recibidas, 2), v_lote.docenas_enviadas;
  END IF;
  v_merma := v_lote.docenas_enviadas - round(p_docenas_recibidas, 2);
  IF v_merma > 0 AND btrim(COALESCE(p_motivo_merma, '')) = '' THEN
    RAISE EXCEPTION 'Faltan % docenas: indica el motivo de la merma', v_merma;
  END IF;
  UPDATE lotes_tintoreria
     SET estado = 'recibido', docenas_recibidas = round(p_docenas_recibidas, 2), docenas_merma = v_merma,
         motivo_merma = CASE WHEN v_merma > 0 THEN btrim(p_motivo_merma) END, recibido_por = v_uid, fecha_recepcion = NOW()
   WHERE id = v_lote.id;
  IF round(p_docenas_recibidas, 2) > 0 THEN
    INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES (v_lote.color_id, round(p_docenas_recibidas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_planchar.docenas + EXCLUDED.docenas, updated_at = NOW();
  END IF;
END;
$$;

-- Stock de fuera en cualquier etapa. Remallado solo registra (se asigna a mano, decisión C2);
-- Volteado y Tintorería reciben medias crudas; Planchado y Preparado, con color.
CREATE OR REPLACE FUNCTION public.ingresar_stock_fuera(p_etapa TEXT, p_catalogo_media_id UUID, p_docenas NUMERIC, p_origen TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  UUID;
  v_prod RECORD;
  v_id   UUID;
BEGIN
  IF p_etapa IS NULL OR p_etapa NOT IN ('remallado', 'volteado', 'tintoreria', 'planchado', 'preparado') THEN
    RAISE EXCEPTION 'Elige la etapa en la que están las medias';
  END IF;
  v_uid := exigir_modulo(p_etapa);
  IF p_docenas IS NULL OR p_docenas = 'NaN'::numeric OR p_docenas <= 0 OR p_docenas > 100000 THEN
    RAISE EXCEPTION 'Las docenas deben ser mayores a 0';
  END IF;
  IF p_origen IS NULL OR btrim(p_origen) = '' THEN RAISE EXCEPTION 'Indica de dónde vienen las medias'; END IF;
  SELECT id, codigo, es_crudo INTO v_prod FROM catalogo_medias WHERE id = p_catalogo_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elige el producto'; END IF;
  IF p_etapa IN ('remallado', 'volteado', 'tintoreria') AND NOT v_prod.es_crudo THEN
    RAISE EXCEPTION 'En % las medias están en crudo: elige la media cruda', p_etapa;
  END IF;
  IF p_etapa IN ('planchado', 'preparado') AND v_prod.es_crudo THEN
    RAISE EXCEPTION 'En % las medias ya tienen color: elige su SKU de color', p_etapa;
  END IF;

  IF p_etapa = 'volteado' THEN
    INSERT INTO stock_listo_voltear (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_voltear.docenas + EXCLUDED.docenas, updated_at = NOW();
  ELSIF p_etapa = 'tintoreria' THEN
    INSERT INTO stock_listo_tenir (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_tenir.docenas + EXCLUDED.docenas, updated_at = NOW();
  ELSIF p_etapa = 'planchado' THEN
    INSERT INTO stock_listo_planchar (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_planchar.docenas + EXCLUDED.docenas, updated_at = NOW();
  ELSIF p_etapa = 'preparado' THEN
    INSERT INTO stock_listo_preparar (catalogo_media_id, docenas) VALUES (p_catalogo_media_id, round(p_docenas, 2))
    ON CONFLICT (catalogo_media_id) DO UPDATE SET docenas = stock_listo_preparar.docenas + EXCLUDED.docenas, updated_at = NOW();
  END IF;
  INSERT INTO ingresos_stock_fuera (etapa, catalogo_media_id, docenas, origen, registrado_por)
  VALUES (p_etapa, p_catalogo_media_id, round(p_docenas, 2), btrim(p_origen), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. PERMISOS (exactos para authenticated; nada para anon)
-- ------------------------------------------------------------------------------
ALTER TABLE public.modulos_por_rol   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_listo_tenir ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_tintoreria  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.modulos_por_rol;
CREATE POLICY durey_usuarios_con_sesion ON public.modulos_por_rol FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.stock_listo_tenir;
CREATE POLICY durey_usuarios_con_sesion ON public.stock_listo_tenir FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.lotes_tintoreria;
CREATE POLICY durey_usuarios_con_sesion ON public.lotes_tintoreria FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.modulos_por_rol, public.stock_listo_tenir, public.lotes_tintoreria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.modulos_por_rol, public.stock_listo_tenir, public.lotes_tintoreria TO authenticated;
GRANT ALL ON TABLE public.modulos_por_rol, public.stock_listo_tenir, public.lotes_tintoreria TO service_role;

-- Tablas de proceso: con sesión solo se leen; se escriben por sus funciones (así el bloqueo por rol no se salta)
REVOKE INSERT, UPDATE, DELETE ON TABLE public.turnos_produccion, public.turno_maquinas, public.reportes_produccion, public.lotes_remallado, public.reportes_remallado, public.stock_listo_voltear, public.lotes_volteado, public.reportes_volteado, public.stock_listo_planchar, public.reportes_planchado FROM authenticated;

-- Sacos: se crean con registrar_produccion_preparado o almacenar_paquete (así no se salta el bloqueo de Preparado)
REVOKE INSERT ON TABLE public.paquetes FROM authenticated;

REVOKE ALL ON FUNCTION public.exigir_modulo(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exigir_modulo(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.crear_crudos_faltantes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_crudos_faltantes() TO service_role;
REVOKE ALL ON FUNCTION public.proteger_es_crudo() FROM PUBLIC, anon;
-- Tejido anterior a la 5A: ya no se usa desde la pantalla
REVOKE EXECUTE ON FUNCTION public.cargar_lote_produccion(UUID, TEXT, INTEGER, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_turno_produccion(UUID, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.iniciar_lote_volteado(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_lote_volteado(UUID, UUID, NUMERIC) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reportar_lote_volteado(UUID, NUMERIC, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reportar_lote_volteado(UUID, NUMERIC, INTEGER, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enviar_lote_tintoreria(UUID, UUID, TEXT, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_lote_tintoreria(UUID, UUID, TEXT, NUMERIC, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recibir_lote_tintoreria(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recibir_lote_tintoreria(UUID, NUMERIC, TEXT) TO authenticated, service_role;

COMMIT;
