-- ==============================================================================
-- Migración 029: Fase 3 — repuestos y mecánicos
-- Spec: 02-DOCS/wiki/sdd/specs/fase-3-repuestos-mecanicos.md (aprobada 2026-11-25)
--
-- 1. Mecánicos: tabla propia (nombre, apellido, teléfono). No son usuarios.
--    Fallas y reparaciones apuntan al mecánico; `asignado_a` (texto) y
--    `reparaciones.tecnico_id` se conservan para el historial.
-- 2. Compras de repuestos (al contado): suben el stock, el costo unitario pasa a
--    ser el último precio pagado y se crea un egreso "repuestos" por el total.
--    Efectivo de la caja del día (casilla del formulario): resta de la caja
--    abierta de hoy, con la misma regla que los pagos a proveedores (027).
-- 3. Repuestos usados en una falla en reparación: se descuentan del stock con el
--    costo del momento, sin egreso (el gasto se contó al comprar). Al cerrar la
--    reparación, el costo de repuestos es la suma de lo usado.
-- 4. El ajuste manual de stock ya no crea egreso (solo corrige inventario).
-- 5. El rol `tecnico` desaparece: el CHECK de usuarios.rol ya no lo admite.
--    No se borra ni se cambia ningún usuario: si existiera alguno con ese rol,
--    la migración se detiene con un mensaje.
--
-- Permisos: solo `authenticated` y `service_role`; tablas nuevas con RLS y la
-- política durey_usuarios_con_sesion; funciones con search_path fijo.
-- Reversión: supabase/scripts/revertir_029.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. Guarda: ningún usuario con rol tecnico (no se tocan datos de usuarios)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  SELECT count(*) INTO v_n FROM public.usuarios WHERE rol = 'tecnico';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Hay % usuario(s) con rol tecnico. Cámbiales el rol antes de aplicar la 029.', v_n;
  END IF;
END $$;

ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol = ANY (ARRAY[
  'admin', 'supervisor', 'disenador', 'tejedor', 'remalladora', 'remallador', 'planchador',
  'preparador', 'almacenero', 'vendedora', 'operador']));

-- ------------------------------------------------------------------------------
-- 1. MECÁNICOS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mecanicos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  apellido    TEXT NOT NULL CHECK (btrim(apellido) <> ''),
  telefono    TEXT NOT NULL CHECK (btrim(telefono) <> ''),
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Nombre fijo de la clave: las pantallas lo usan para pedir la relación sin ambigüedad
ALTER TABLE public.averias_maquinas ADD COLUMN IF NOT EXISTS mecanico_id UUID
  CONSTRAINT averias_maquinas_mecanico_id_fkey REFERENCES public.mecanicos(id) ON DELETE SET NULL;
ALTER TABLE public.reparaciones     ADD COLUMN IF NOT EXISTS mecanico_id UUID
  CONSTRAINT reparaciones_mecanico_id_fkey REFERENCES public.mecanicos(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 2. COMPRAS DE REPUESTOS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras_repuestos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repuesto_id      UUID NOT NULL REFERENCES public.repuestos(id),
  proveedor_id     UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  total            NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  metodo_pago      TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'transferencia', 'yape_plin', 'otro')),
  de_caja          BOOLEAN NOT NULL DEFAULT false,
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  caja_id          UUID REFERENCES public.cajas_diarias(id) ON DELETE SET NULL,
  egreso_id        UUID REFERENCES public.egresos_adicionales(id) ON DELETE SET NULL,
  registrado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS compras_repuestos_repuesto_idx ON public.compras_repuestos (repuesto_id, fecha DESC);

-- ------------------------------------------------------------------------------
-- 3. REPUESTOS USADOS EN CADA FALLA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.averia_repuestos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  averia_id       UUID NOT NULL REFERENCES public.averias_maquinas(id) ON DELETE CASCADE,
  repuesto_id     UUID NOT NULL REFERENCES public.repuestos(id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  mecanico_id     UUID REFERENCES public.mecanicos(id) ON DELETE SET NULL,
  registrado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS averia_repuestos_averia_idx ON public.averia_repuestos (averia_id);

-- ------------------------------------------------------------------------------
-- 4. FUNCIONES
-- ------------------------------------------------------------------------------

-- Caja abierta de hoy para quien paga: la suya; si no tiene, la general; si no, la más antigua (regla de la 027)
CREATE OR REPLACE FUNCTION public._caja_abierta_hoy(p_usuario UUID)
RETURNS TABLE (caja_id UUID, asesora_id UUID)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT c.id, c.asesora_id FROM cajas_diarias c
   WHERE c.fecha = CURRENT_DATE AND c.estado = 'abierta'
   ORDER BY COALESCE(c.asesora_id = p_usuario, false) DESC, (c.asesora_id IS NULL) DESC, c.created_at
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.registrar_compra_repuesto(
  p_repuesto_id      UUID,
  p_cantidad         INTEGER,
  p_precio_unitario  NUMERIC,
  p_metodo_pago      TEXT,
  p_fecha            DATE DEFAULT NULL,
  p_proveedor_id     UUID DEFAULT NULL,
  p_de_caja          BOOLEAN DEFAULT false,
  p_usuario_id       UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rep       RECORD;
  v_fecha     DATE := COALESCE(p_fecha, CURRENT_DATE);
  v_precio    NUMERIC(12,2) := round(p_precio_unitario, 2);  -- se guarda con 2 decimales: el total se calcula con ese mismo precio
  v_total     NUMERIC(12,2);
  v_usuario   UUID := COALESCE(auth.uid(), p_usuario_id);  -- la sesión manda; el parámetro solo sin sesión
  v_caja_id   UUID;
  v_caja_de   UUID;
  v_egreso_id UUID;
  v_compra_id UUID;
BEGIN
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  IF p_precio_unitario IS NULL OR p_precio_unitario < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'transferencia', 'yape_plin', 'otro') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF v_fecha > CURRENT_DATE THEN RAISE EXCEPTION 'La fecha de compra no puede ser futura'; END IF;
  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM proveedores WHERE id = p_proveedor_id) THEN
    RAISE EXCEPTION 'Proveedor no encontrado';
  END IF;

  SELECT id, nombre INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;

  v_total := p_cantidad * v_precio;
  UPDATE repuestos SET stock_actual = stock_actual + p_cantidad, costo_unitario = v_precio WHERE id = p_repuesto_id;

  IF v_total > 0 THEN
    INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha)
    VALUES ('Compra repuesto: ' || v_rep.nombre || ' (' || p_cantidad || ' uds.)', v_total, 'repuestos', v_fecha)
    RETURNING id INTO v_egreso_id;
  END IF;

  -- Efectivo de la venta del día: sale de la caja abierta de hoy
  IF p_metodo_pago = 'efectivo' AND COALESCE(p_de_caja, false) AND v_fecha = CURRENT_DATE AND v_total > 0 THEN
    SELECT c.caja_id, c.asesora_id INTO v_caja_id, v_caja_de FROM _caja_abierta_hoy(v_usuario) c;
    IF v_caja_id IS NOT NULL THEN
      PERFORM 1 FROM cajas_diarias WHERE id = v_caja_id FOR UPDATE;
      UPDATE cajas_diarias SET pagos_efectivo = pagos_efectivo + v_total WHERE id = v_caja_id;
    END IF;
  END IF;

  INSERT INTO compras_repuestos (repuesto_id, proveedor_id, cantidad, precio_unitario, total, metodo_pago, de_caja, fecha, caja_id, egreso_id, registrado_por)
  VALUES (p_repuesto_id, p_proveedor_id, p_cantidad, v_precio, v_total, p_metodo_pago,
          p_metodo_pago = 'efectivo' AND COALESCE(p_de_caja, false), v_fecha, v_caja_id, v_egreso_id, v_usuario)
  RETURNING id INTO v_compra_id;

  RETURN jsonb_build_object('compra_id', v_compra_id, 'egreso_id', v_egreso_id, 'total', v_total,
                            'caja_id', v_caja_id, 'descontado_de_caja', v_caja_id IS NOT NULL,
                            'caja_de', CASE WHEN v_caja_id IS NULL THEN NULL
                                            WHEN v_caja_de IS NULL THEN 'Caja general'
                                            ELSE (SELECT nombre FROM usuarios WHERE id = v_caja_de) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.asignar_mecanico_averia(p_averia_id UUID, p_mecanico_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado TEXT;
  v_mec    RECORD;
BEGIN
  SELECT estado INTO v_estado FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avería no encontrada'; END IF;
  IF v_estado = 'resuelto' THEN RAISE EXCEPTION 'La avería ya está resuelta'; END IF;
  SELECT nombre, apellido, activo INTO v_mec FROM mecanicos WHERE id = p_mecanico_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Elige un mecánico'; END IF;
  IF NOT v_mec.activo THEN RAISE EXCEPTION 'El mecánico % % no está activo', v_mec.nombre, v_mec.apellido; END IF;
  UPDATE averias_maquinas
     SET mecanico_id = p_mecanico_id, asignado_a = btrim(v_mec.nombre) || ' ' || btrim(v_mec.apellido)
   WHERE id = p_averia_id;
END;
$$;

-- Iniciar la reparación: "cuando entra el mecánico" (obligatorio)
CREATE OR REPLACE FUNCTION public.iniciar_reparacion_mecanico(p_averia_id UUID, p_mecanico_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_averia RECORD;
  v_maq    RECORD;
BEGIN
  IF p_mecanico_id IS NULL THEN RAISE EXCEPTION 'Elige el mecánico que hace la reparación'; END IF;
  SELECT id, maquina_id, estado INTO v_averia FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avería no encontrada'; END IF;
  IF v_averia.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se puede iniciar la reparación de una avería pendiente (estado actual: %)', v_averia.estado;
  END IF;
  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = v_averia.maquina_id FOR UPDATE;
  IF v_maq.estado <> 'malograda' THEN
    RAISE EXCEPTION 'La máquina % debe estar malograda para iniciar la reparación (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  PERFORM asignar_mecanico_averia(p_averia_id, p_mecanico_id);
  UPDATE averias_maquinas SET estado = 'en_reparacion' WHERE id = p_averia_id;
  UPDATE maquinas SET estado = 'mantenimiento', detalle_estado = 'EN REPARACIÓN' WHERE id = v_averia.maquina_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usar_repuesto_en_averia(p_averia_id UUID, p_repuesto_id UUID, p_cantidad INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_averia RECORD;
  v_rep    RECORD;
  v_id     UUID;
BEGIN
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  SELECT id, estado, mecanico_id INTO v_averia FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avería no encontrada'; END IF;
  IF v_averia.estado <> 'en_reparacion' THEN
    RAISE EXCEPTION 'Solo se usan repuestos en una avería en reparación (estado actual: %)', v_averia.estado;
  END IF;
  SELECT id, nombre, stock_actual, costo_unitario INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;
  IF p_cantidad > v_rep.stock_actual THEN
    RAISE EXCEPTION 'Solo hay % unidades de %; no se pueden usar %', v_rep.stock_actual, v_rep.nombre, p_cantidad;
  END IF;

  UPDATE repuestos SET stock_actual = stock_actual - p_cantidad WHERE id = p_repuesto_id;
  INSERT INTO averia_repuestos (averia_id, repuesto_id, cantidad, costo_unitario, mecanico_id, registrado_por)
  VALUES (p_averia_id, p_repuesto_id, p_cantidad, COALESCE(v_rep.costo_unitario, 0), v_averia.mecanico_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.quitar_repuesto_de_averia(p_uso_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uso    RECORD;
  v_estado TEXT;
BEGIN
  SELECT id, averia_id, repuesto_id, cantidad INTO v_uso FROM averia_repuestos WHERE id = p_uso_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese repuesto ya no está en la avería'; END IF;
  SELECT estado INTO v_estado FROM averias_maquinas WHERE id = v_uso.averia_id FOR UPDATE;
  IF v_estado <> 'en_reparacion' THEN
    RAISE EXCEPTION 'Solo se quitan repuestos de una avería en reparación (estado actual: %)', v_estado;
  END IF;
  PERFORM 1 FROM repuestos WHERE id = v_uso.repuesto_id FOR UPDATE;
  UPDATE repuestos SET stock_actual = stock_actual + v_uso.cantidad WHERE id = v_uso.repuesto_id;
  DELETE FROM averia_repuestos WHERE id = p_uso_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cerrar_reparacion_averia(p_averia_id UUID, p_descripcion TEXT, p_costo_mano_obra NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_averia    RECORD;
  v_maq       RECORD;
  v_repuestos NUMERIC(12,2);
  v_id        UUID;
BEGIN
  IF COALESCE(btrim(p_descripcion), '') = '' THEN RAISE EXCEPTION 'Completa el diagnóstico técnico'; END IF;
  IF COALESCE(p_costo_mano_obra, 0) < 0 THEN RAISE EXCEPTION 'La mano de obra no puede ser negativa'; END IF;
  SELECT id, maquina_id, estado, mecanico_id INTO v_averia FROM averias_maquinas WHERE id = p_averia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Avería no encontrada'; END IF;
  IF v_averia.estado <> 'en_reparacion' THEN
    RAISE EXCEPTION 'Primero inicia la reparación (estado actual de la avería: %)', v_averia.estado;
  END IF;
  SELECT codigo, estado INTO v_maq FROM maquinas WHERE id = v_averia.maquina_id FOR UPDATE;
  IF v_maq.estado <> 'mantenimiento' THEN
    RAISE EXCEPTION 'La máquina % debe estar en mantenimiento para cerrar la reparación (estado: %)', v_maq.codigo, v_maq.estado;
  END IF;

  SELECT COALESCE(sum(cantidad * costo_unitario), 0) INTO v_repuestos FROM averia_repuestos WHERE averia_id = p_averia_id;
  INSERT INTO reparaciones (averia_id, mecanico_id, descripcion_tecnico, costo_repuestos, costo_mano_obra)
  VALUES (p_averia_id, v_averia.mecanico_id, btrim(p_descripcion), v_repuestos, COALESCE(p_costo_mano_obra, 0))
  RETURNING id INTO v_id;
  UPDATE averias_maquinas SET estado = 'resuelto' WHERE id = p_averia_id;
  UPDATE maquinas SET estado = 'activa', detalle_estado = 'OPERATIVA' WHERE id = v_averia.maquina_id;
  RETURN v_id;
END;
$$;

-- Ajuste manual: misma firma; ya no crea egreso (el gasto se cuenta al comprar)
CREATE OR REPLACE FUNCTION public.ajustar_stock_repuesto(
  p_repuesto_id UUID,
  p_tipo        TEXT,
  p_cantidad    INTEGER,
  p_motivo      TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rep   RECORD;
  v_nuevo INTEGER;
BEGIN
  IF p_tipo NOT IN ('ingreso', 'salida') THEN RAISE EXCEPTION 'Tipo de ajuste inválido'; END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  SELECT id, nombre, stock_actual INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;
  IF p_tipo = 'salida' AND p_cantidad > v_rep.stock_actual THEN
    RAISE EXCEPTION 'Solo hay % unidades de %; no se pueden sacar %', v_rep.stock_actual, v_rep.nombre, p_cantidad;
  END IF;
  v_nuevo := v_rep.stock_actual + CASE WHEN p_tipo = 'ingreso' THEN p_cantidad ELSE -p_cantidad END;
  UPDATE repuestos SET stock_actual = v_nuevo WHERE id = p_repuesto_id;
  RETURN v_nuevo;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. PERMISOS
-- ------------------------------------------------------------------------------
ALTER TABLE public.mecanicos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras_repuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.averia_repuestos  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.mecanicos;
CREATE POLICY durey_usuarios_con_sesion ON public.mecanicos FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.compras_repuestos;
CREATE POLICY durey_usuarios_con_sesion ON public.compras_repuestos FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.averia_repuestos;
CREATE POLICY durey_usuarios_con_sesion ON public.averia_repuestos FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.mecanicos, public.compras_repuestos, public.averia_repuestos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mecanicos TO authenticated;
-- Compras y usos solo se escriben por sus funciones atómicas
GRANT SELECT ON TABLE public.compras_repuestos, public.averia_repuestos TO authenticated;
GRANT ALL ON TABLE public.mecanicos, public.compras_repuestos, public.averia_repuestos TO service_role;

REVOKE ALL ON FUNCTION public._caja_abierta_hoy(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_compra_repuesto(UUID, INTEGER, NUMERIC, TEXT, DATE, UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asignar_mecanico_averia(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.iniciar_reparacion_mecanico(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.usar_repuesto_en_averia(UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_repuesto_de_averia(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cerrar_reparacion_averia(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra_repuesto(UUID, INTEGER, NUMERIC, TEXT, DATE, UUID, BOOLEAN, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asignar_mecanico_averia(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_reparacion_mecanico(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.usar_repuesto_en_averia(UUID, UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quitar_repuesto_de_averia(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_reparacion_averia(UUID, TEXT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._caja_abierta_hoy(UUID) TO service_role;

-- Reemplazadas por iniciar_reparacion_mecanico y cerrar_reparacion_averia
REVOKE EXECUTE ON FUNCTION public.iniciar_reparacion_averia(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_reparacion_averia(UUID, TEXT, NUMERIC, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
