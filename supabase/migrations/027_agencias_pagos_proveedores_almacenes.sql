-- ==============================================================================
-- Migración 027: Fase 1 — agencias, pagos a proveedores y almacenes
--
-- 1. Agencias de transporte en una tabla (antes: 4 nombres fijos en el código).
--    Se siembran las 4 de siempre + las que ya aparecen en guías antiguas.
--    guias_remision.agencia sigue siendo texto: las guías antiguas no cambian.
-- 2. Pagos a proveedores: cada pago de una cuota queda en `pagos_proveedores`
--    con fecha, monto y método. Si es en efectivo y con fecha de hoy, se resta
--    de la caja abierta del día (nueva columna cajas_diarias.pagos_efectivo),
--    igual que los cobros de ventas suman (migración 023). Sin caja abierta, el
--    pago igual queda en el historial (mismo criterio que los cobros).
--    Las cuotas ya pagadas pasan al historial (sin tocar ninguna caja).
-- 3. Reprogramar la fecha de vencimiento de una cuota pendiente.
--    Quien paga es el usuario de la sesión (auth.uid()); el parámetro p_usuario_id
--    solo se usa si no hay sesión (service_role). La caja elegida: la de quien
--    paga; si no tiene, la caja general (sin asesora); si no, la más antigua.
-- 4. Almacenes (tabla `ubicaciones`): crear (reactiva uno eliminado con el mismo
--    nombre), renombrar y desactivar (borrado suave).
--    No se desactiva un almacén con paquetes dentro (estado distinto de
--    'entregado'): las filas antiguas siguen apuntando a él y el historial no se pierde.
--
-- Permisos: solo `authenticated` y `service_role` (la 026 cerró la base a quien
-- no inició sesión). Tablas nuevas con RLS y la política durey_usuarios_con_sesion.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. AGENCIAS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agencias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Datos primero (las 4 fijas + las usadas en guías), constraint de unicidad después
INSERT INTO public.agencias (nombre)
SELECT DISTINCT ON (lower(btrim(n))) btrim(n)
  FROM (
    SELECT unnest(ARRAY['Shalom', 'Olva Courier', 'Marvisur', 'Flores Cargo']) AS n
    UNION ALL
    SELECT agencia FROM public.guias_remision WHERE COALESCE(btrim(agencia), '') <> ''
  ) s
 WHERE NOT EXISTS (SELECT 1 FROM public.agencias a WHERE lower(btrim(a.nombre)) = lower(btrim(s.n)))
 ORDER BY lower(btrim(n)), n;

CREATE UNIQUE INDEX IF NOT EXISTS agencias_nombre_unico ON public.agencias (lower(btrim(nombre)));

CREATE OR REPLACE FUNCTION public.registrar_agencia(p_nombre TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
  v_id     UUID;
BEGIN
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre de la agencia';
  END IF;
  SELECT id INTO v_id FROM agencias WHERE lower(btrim(nombre)) = lower(v_nombre) FOR UPDATE;
  IF v_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM agencias WHERE id = v_id AND activo) THEN
      RAISE EXCEPTION 'La agencia % ya está registrada', v_nombre;
    END IF;
    UPDATE agencias SET activo = true WHERE id = v_id;  -- se había dado de baja: se reactiva
    RETURN v_id;
  END IF;
  INSERT INTO agencias (nombre) VALUES (v_nombre) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. PAGOS A PROVEEDORES
-- ------------------------------------------------------------------------------
ALTER TABLE public.cajas_diarias ADD COLUMN IF NOT EXISTS pagos_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pagos_proveedores (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cuota_compra_id  UUID REFERENCES public.cuotas_compras(id) ON DELETE SET NULL,
  proveedor_id     UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  monto            NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago      TEXT NOT NULL CHECK (metodo_pago IN ('efectivo', 'transferencia', 'yape_plin', 'otro')),
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  comprobante_url  TEXT,
  caja_id          UUID REFERENCES public.cajas_diarias(id) ON DELETE SET NULL,
  registrado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pagos_proveedores_fecha_idx ON public.pagos_proveedores (fecha DESC);
CREATE INDEX IF NOT EXISTS pagos_proveedores_proveedor_idx ON public.pagos_proveedores (proveedor_id);

-- Historial: las cuotas ya pagadas antes de esta migración (no tocan ninguna caja)
INSERT INTO public.pagos_proveedores (cuota_compra_id, proveedor_id, monto, metodo_pago, fecha, comprobante_url)
SELECT q.id, c.proveedor_id, q.monto,
       CASE lower(btrim(COALESCE(q.metodo_pago, '')))
         WHEN 'efectivo' THEN 'efectivo'
         WHEN 'transferencia' THEN 'transferencia'
         WHEN 'yape/plin' THEN 'yape_plin'
         ELSE 'otro'
       END,
       COALESCE(q.fecha_pago, LEAST(q.fecha_vencimiento, CURRENT_DATE)),
       q.comprobante_url
  FROM public.cuotas_compras q
  JOIN public.compras_materia_prima c ON c.id = q.compra_id
 WHERE q.estado = 'pagada'
   AND q.monto > 0
   AND NOT EXISTS (SELECT 1 FROM public.pagos_proveedores p WHERE p.cuota_compra_id = q.id);

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_cuota_id         UUID,
  p_metodo_pago      TEXT,
  p_fecha            DATE DEFAULT NULL,
  p_comprobante_url  TEXT DEFAULT NULL,
  p_usuario_id       UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cuota    cuotas_compras%ROWTYPE;
  v_prov_id  UUID;
  v_fecha    DATE := COALESCE(p_fecha, CURRENT_DATE);
  v_caja_id  UUID;
  v_pago_id  UUID;
  v_etiqueta TEXT;
  v_usuario  UUID := COALESCE(auth.uid(), p_usuario_id);  -- la sesión manda; el parámetro no se puede suplantar
  v_caja_de  UUID;
BEGIN
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'transferencia', 'yape_plin', 'otro') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF v_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura';
  END IF;

  SELECT * INTO v_cuota FROM cuotas_compras WHERE id = p_cuota_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuota no encontrada';
  END IF;
  IF v_cuota.estado = 'pagada' THEN
    RAISE EXCEPTION 'Esta cuota ya fue pagada';
  END IF;
  IF COALESCE(v_cuota.monto, 0) <= 0 THEN
    RAISE EXCEPTION 'La cuota no tiene monto a pagar';
  END IF;
  SELECT proveedor_id INTO v_prov_id FROM compras_materia_prima WHERE id = v_cuota.compra_id;

  -- Efectivo de hoy: sale de la caja abierta del día (la de quien paga; si no
  -- tiene, la caja general; si no, la más antigua)
  IF p_metodo_pago = 'efectivo' AND v_fecha = CURRENT_DATE THEN
    SELECT id, asesora_id INTO v_caja_id, v_caja_de FROM cajas_diarias
     WHERE fecha = CURRENT_DATE AND estado = 'abierta'
     ORDER BY COALESCE(asesora_id = v_usuario, false) DESC, (asesora_id IS NULL) DESC, created_at
     LIMIT 1
     FOR UPDATE;
    IF v_caja_id IS NOT NULL THEN
      UPDATE cajas_diarias SET pagos_efectivo = pagos_efectivo + v_cuota.monto WHERE id = v_caja_id;
    END IF;
  END IF;

  INSERT INTO pagos_proveedores (cuota_compra_id, proveedor_id, monto, metodo_pago, fecha, comprobante_url, caja_id, registrado_por)
  VALUES (v_cuota.id, v_prov_id, v_cuota.monto, p_metodo_pago, v_fecha, NULLIF(btrim(COALESCE(p_comprobante_url, '')), ''), v_caja_id, v_usuario)
  RETURNING id INTO v_pago_id;

  v_etiqueta := CASE p_metodo_pago
    WHEN 'efectivo' THEN 'Efectivo' WHEN 'transferencia' THEN 'Transferencia'
    WHEN 'yape_plin' THEN 'Yape/Plin' ELSE 'Otro' END;
  UPDATE cuotas_compras
     SET estado = 'pagada', fecha_pago = v_fecha, metodo_pago = v_etiqueta,
         comprobante_url = NULLIF(btrim(COALESCE(p_comprobante_url, '')), '')
   WHERE id = v_cuota.id;

  RETURN jsonb_build_object('pago_id', v_pago_id, 'caja_id', v_caja_id, 'monto', v_cuota.monto,
                            'descontado_de_caja', v_caja_id IS NOT NULL,
                            'caja_de', CASE WHEN v_caja_id IS NULL THEN NULL
                                            WHEN v_caja_de IS NULL THEN 'Caja general'
                                            ELSE (SELECT nombre FROM usuarios WHERE id = v_caja_de) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.reprogramar_cuota_compra(p_cuota_id UUID, p_fecha_vencimiento DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_estado TEXT;
BEGIN
  IF p_fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'Indica la nueva fecha de vencimiento';
  END IF;
  SELECT estado INTO v_estado FROM cuotas_compras WHERE id = p_cuota_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuota no encontrada';
  END IF;
  IF v_estado = 'pagada' THEN
    RAISE EXCEPTION 'Una cuota pagada no se puede reprogramar';
  END IF;
  UPDATE cuotas_compras SET fecha_vencimiento = p_fecha_vencimiento WHERE id = p_cuota_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. ALMACENES (ubicaciones): renombrar y desactivar
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_ubicacion(p_nombre TEXT, p_tipo TEXT DEFAULT 'salon')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
  v_id     UUID;
  v_activo BOOLEAN;
BEGIN
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre del almacén';
  END IF;
  IF COALESCE(p_tipo, '') NOT IN ('salon', 'almacen_general') THEN
    RAISE EXCEPTION 'Tipo de almacén inválido';
  END IF;
  SELECT id, activo INTO v_id, v_activo FROM ubicaciones WHERE lower(btrim(nombre)) = lower(v_nombre) LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN
    IF v_activo THEN
      RAISE EXCEPTION 'Ya existe un almacén llamado %', v_nombre;
    END IF;
    UPDATE ubicaciones SET activo = true WHERE id = v_id;  -- se había eliminado: se reactiva con su historial
    RETURN v_id;
  END IF;
  INSERT INTO ubicaciones (nombre, tipo, activo) VALUES (v_nombre, p_tipo, true) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.renombrar_ubicacion(p_id UUID, p_nombre TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre TEXT := btrim(COALESCE(p_nombre, ''));
BEGIN
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre del almacén';
  END IF;
  PERFORM 1 FROM ubicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Almacén no encontrado';
  END IF;
  IF EXISTS (SELECT 1 FROM ubicaciones WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_nombre) AND activo) THEN
    RAISE EXCEPTION 'Ya existe un almacén llamado %', v_nombre;
  END IF;
  IF EXISTS (SELECT 1 FROM ubicaciones WHERE id <> p_id AND lower(btrim(nombre)) = lower(v_nombre)) THEN
    RAISE EXCEPTION 'El nombre % pertenece a un almacén eliminado. Créalo con ese nombre para reactivarlo.', v_nombre;
  END IF;
  UPDATE ubicaciones SET nombre = v_nombre WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.desactivar_ubicacion(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nombre    TEXT;
  v_paquetes  INTEGER;
BEGIN
  SELECT nombre INTO v_nombre FROM ubicaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Almacén no encontrado';
  END IF;
  SELECT count(*) INTO v_paquetes FROM paquetes WHERE ubicacion_id = p_id AND estado <> 'entregado';
  IF v_paquetes > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar %: tiene % paquete(s) dentro. Muévelos o despáchalos primero.', v_nombre, v_paquetes;
  END IF;
  UPDATE ubicaciones SET activo = false WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. PERMISOS: solo usuarios con sesión y service_role
-- ------------------------------------------------------------------------------
ALTER TABLE public.agencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_proveedores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.agencias;
CREATE POLICY durey_usuarios_con_sesion ON public.agencias FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS durey_usuarios_con_sesion ON public.pagos_proveedores;
CREATE POLICY durey_usuarios_con_sesion ON public.pagos_proveedores FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.agencias, public.pagos_proveedores FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agencias, public.pagos_proveedores TO authenticated;
GRANT ALL ON TABLE public.agencias, public.pagos_proveedores TO service_role;

REVOKE ALL ON FUNCTION public.registrar_agencia(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_pago_proveedor(UUID, TEXT, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reprogramar_cuota_compra(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crear_ubicacion(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.renombrar_ubicacion(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.desactivar_ubicacion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_agencia(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(UUID, TEXT, DATE, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reprogramar_cuota_compra(UUID, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_ubicacion(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.renombrar_ubicacion(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.desactivar_ubicacion(UUID) TO authenticated, service_role;

COMMIT;
