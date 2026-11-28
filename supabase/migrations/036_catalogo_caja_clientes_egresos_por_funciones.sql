-- ==============================================================================
-- Migración 036: Fase 7 — SKU y código fijos, catálogo, caja, clientes y egresos
-- solo por funciones con módulo, y gastos de materia prima por pagos reales
-- Spec: 02-DOCS/wiki/sdd/specs/fase-7-transversal.md (aprobada 2026-11-27)
-- Plan: 02-DOCS/wiki/sdd/plans/fase-7-transversal.md
--
-- 1. egresos_adicionales.comprobante_url (Egresos ya la enviaba y fallaba).
-- 2. El código de un producto no cambia; el SKU solo se pone si estaba vacío (2-A, P2-A).
-- 3. Funciones de catálogo, caja, clientes y egresos con exigir_modulo; sin escritura
--    directa con sesión en sus tablas (P3-A).
-- 4. vista_gastos_materia_prima: compras al contado recibidas por su fecha y pagos a
--    proveedores por su fecha (P1-A). Balance y Egresos la leen.
-- Lo ya registrado no se borra ni se cambia. Reversión: supabase/scripts/revertir_036.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. COLUMNA QUE FALTABA
-- ------------------------------------------------------------------------------
ALTER TABLE public.egresos_adicionales ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

-- ------------------------------------------------------------------------------
-- 2. AYUDA: EXIGIR UNO DE VARIOS MÓDULOS (solo para funciones)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exigir_algun_modulo(p_modulos TEXT[])
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM usuarios u JOIN modulos_por_rol mr ON mr.rol = u.rol
     WHERE u.id = v_uid AND u.activo AND mr.modulo = ANY (p_modulos)
  ) THEN
    RAISE EXCEPTION 'Tu rol no tiene acceso al módulo %', array_to_string(p_modulos, ' ni al módulo ');
  END IF;
  RETURN v_uid;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. SKU Y CÓDIGO FIJOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_identidad_producto()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.codigo IS DISTINCT FROM OLD.codigo OR (OLD.sku IS NOT NULL AND NEW.sku IS DISTINCT FROM OLD.sku) THEN
    RAISE EXCEPTION 'El SKU y el código de % no se cambian: van en sacos y ventas', OLD.codigo;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalogo_medias_identidad_fija
  BEFORE UPDATE OF sku, codigo ON public.catalogo_medias
  FOR EACH ROW EXECUTE FUNCTION public.proteger_identidad_producto();

-- ------------------------------------------------------------------------------
-- 4. CATÁLOGO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_producto(p_datos JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM exigir_modulo('catalogo');
  IF COALESCE(btrim(p_datos->>'modelo'), '') = '' OR COALESCE(btrim(p_datos->>'publico'), '') = ''
     OR COALESCE(btrim(p_datos->>'diseno_color'), '') = '' OR COALESCE(btrim(p_datos->>'talla'), '') = '' THEN
    RAISE EXCEPTION 'Completa modelo, público, color y talla';
  END IF;
  IF COALESCE(btrim(p_datos->>'codigo'), '') = '' THEN RAISE EXCEPTION 'Falta el código del producto'; END IF;
  IF COALESCE((p_datos->>'costo_produccion_docena')::NUMERIC, -1) < 0 OR COALESCE((p_datos->>'precio_venta_sugerido')::NUMERIC, 0) < 0 THEN
    RAISE EXCEPTION 'El costo y el precio no pueden ser negativos';
  END IF;
  INSERT INTO catalogo_medias (sku, codigo, modelo, publico, diseno_color, talla, costo_produccion_docena, precio_venta_sugerido, es_crudo, estado)
  VALUES (NULLIF(btrim(p_datos->>'sku'), ''), btrim(p_datos->>'codigo'), btrim(p_datos->>'modelo'), btrim(p_datos->>'publico'),
          btrim(p_datos->>'diseno_color'), btrim(p_datos->>'talla'), (p_datos->>'costo_produccion_docena')::NUMERIC,
          COALESCE((p_datos->>'precio_venta_sugerido')::NUMERIC, 0), COALESCE((p_datos->>'es_crudo')::BOOLEAN, false), 'activo')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Edita todo menos el código; el SKU solo se pone si estaba vacío (el disparador lo exige)
CREATE OR REPLACE FUNCTION public.editar_producto(p_id UUID, p_datos JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actual RECORD;
BEGIN
  PERFORM exigir_modulo('catalogo');
  SELECT * INTO v_actual FROM catalogo_medias WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF COALESCE(btrim(p_datos->>'modelo'), '') = '' OR COALESCE(btrim(p_datos->>'publico'), '') = ''
     OR COALESCE(btrim(p_datos->>'diseno_color'), '') = '' OR COALESCE(btrim(p_datos->>'talla'), '') = '' THEN
    RAISE EXCEPTION 'Completa modelo, público, color y talla';
  END IF;
  IF COALESCE((p_datos->>'costo_produccion_docena')::NUMERIC, -1) < 0 OR COALESCE((p_datos->>'precio_venta_sugerido')::NUMERIC, 0) < 0 THEN
    RAISE EXCEPTION 'El costo y el precio no pueden ser negativos';
  END IF;
  UPDATE catalogo_medias SET
    sku = CASE WHEN v_actual.sku IS NULL THEN NULLIF(btrim(p_datos->>'sku'), '') ELSE v_actual.sku END,
    modelo = btrim(p_datos->>'modelo'), publico = btrim(p_datos->>'publico'),
    diseno_color = btrim(p_datos->>'diseno_color'), talla = btrim(p_datos->>'talla'),
    costo_produccion_docena = (p_datos->>'costo_produccion_docena')::NUMERIC,
    precio_venta_sugerido = COALESCE((p_datos->>'precio_venta_sugerido')::NUMERIC, 0),
    es_crudo = COALESCE((p_datos->>'es_crudo')::BOOLEAN, v_actual.es_crudo),
    updated_at = NOW()
   WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_producto(p_id UUID, p_estado TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_modulo('catalogo');
  IF p_estado NOT IN ('activo', 'inactivo') THEN RAISE EXCEPTION 'Estado de producto inválido'; END IF;
  UPDATE catalogo_medias SET estado = p_estado, updated_at = NOW() WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_producto(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_codigo TEXT;
BEGIN
  PERFORM exigir_modulo('catalogo');
  SELECT codigo INTO v_codigo FROM catalogo_medias WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  BEGIN
    DELETE FROM catalogo_medias WHERE id = p_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'No se puede eliminar %: ya tiene producción, stock o ventas. Desactívalo en su lugar', v_codigo;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_modelo_media(p_nombre TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM exigir_modulo('catalogo');
  IF COALESCE(btrim(p_nombre), '') = '' THEN RAISE EXCEPTION 'Ingresa el nombre del modelo'; END IF;
  INSERT INTO modelos_media (nombre) VALUES (btrim(p_nombre)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. CAJA DIARIA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.abrir_caja(p_asesora_id UUID, p_saldo_inicial NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoy DATE := (NOW() AT TIME ZONE 'America/Lima')::date;
  v_id  UUID;
BEGIN
  PERFORM exigir_modulo('ventas');
  IF p_asesora_id IS NULL OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_asesora_id AND activo) THEN
    RAISE EXCEPTION 'Elige la vendedora de la caja';
  END IF;
  IF COALESCE(p_saldo_inicial, -1) < 0 THEN RAISE EXCEPTION 'El saldo inicial no puede ser negativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('durey_caja_' || p_asesora_id::text));
  IF EXISTS (SELECT 1 FROM cajas_diarias WHERE asesora_id = p_asesora_id AND fecha = v_hoy) THEN
    RAISE EXCEPTION 'Esa vendedora ya abrió su caja de hoy';
  END IF;
  INSERT INTO cajas_diarias (asesora_id, fecha, saldo_inicial, estado)
  VALUES (p_asesora_id, v_hoy, p_saldo_inicial, 'abierta') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Esperado en efectivo = inicial + ventas + cobros − pagos a proveedores (como calcularEfectivoEsperadoCaja)
CREATE OR REPLACE FUNCTION public.cerrar_caja(p_caja_id UUID, p_declarado_efectivo NUMERIC, p_justificacion TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caja       RECORD;
  v_esperado   NUMERIC;
  v_diferencia NUMERIC;
  v_estado     TEXT;
BEGIN
  PERFORM exigir_modulo('ventas');
  SELECT * INTO v_caja FROM cajas_diarias WHERE id = p_caja_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF v_caja.estado <> 'abierta' THEN RAISE EXCEPTION 'La caja ya está cerrada'; END IF;
  IF COALESCE(p_declarado_efectivo, -1) < 0 THEN RAISE EXCEPTION 'El efectivo contado no puede ser negativo'; END IF;
  v_esperado := round(COALESCE(v_caja.saldo_inicial, 0) + COALESCE(v_caja.ventas_efectivo, 0) + COALESCE(v_caja.cobros_efectivo, 0)
                      - COALESCE(v_caja.pagos_efectivo, 0), 2);
  v_diferencia := round(p_declarado_efectivo - v_esperado, 2);
  v_estado := CASE WHEN v_diferencia = 0 THEN 'cerrada_cuadrada' WHEN v_diferencia < 0 THEN 'cerrada_faltante' ELSE 'cerrada_sobrante' END;
  IF v_estado <> 'cerrada_cuadrada' AND COALESCE(btrim(p_justificacion), '') = '' THEN
    RAISE EXCEPTION 'Escribe la justificación del faltante o sobrante';
  END IF;
  UPDATE cajas_diarias SET saldo_esperado_efectivo = v_esperado, saldo_declarado_efectivo = p_declarado_efectivo,
         diferencia = v_diferencia, estado = v_estado, justificacion = NULLIF(btrim(p_justificacion), '')
   WHERE id = p_caja_id;
  RETURN jsonb_build_object('estado', v_estado, 'diferencia', v_diferencia, 'esperado', v_esperado);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. CLIENTES
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_cliente(p_id UUID, p_datos JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_doc  TEXT := btrim(COALESCE(p_datos->>'numero_documento', ''));
  v_tipo TEXT := COALESCE(NULLIF(p_datos->>'tipo_documento', ''), CASE WHEN length(btrim(COALESCE(p_datos->>'numero_documento', ''))) = 11 THEN 'ruc' ELSE 'dni' END);
  v_id   UUID;
BEGIN
  PERFORM exigir_modulo('clientes');
  IF COALESCE(btrim(p_datos->>'nombre'), '') = '' THEN RAISE EXCEPTION 'El nombre o razón social es obligatorio'; END IF;
  IF v_doc = '' THEN RAISE EXCEPTION 'El número de DNI o RUC es obligatorio'; END IF;
  IF v_tipo NOT IN ('dni', 'ruc') THEN RAISE EXCEPTION 'Tipo de documento inválido'; END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE numero_documento = v_doc AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'Ya hay un cliente con el documento %', v_doc;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO clientes (tipo_documento, numero_documento, nombre, telefono, direccion)
    VALUES (v_tipo, v_doc, btrim(p_datos->>'nombre'), NULLIF(btrim(p_datos->>'telefono'), ''), NULLIF(btrim(p_datos->>'direccion'), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE clientes SET tipo_documento = v_tipo, numero_documento = v_doc, nombre = btrim(p_datos->>'nombre'),
           telefono = NULLIF(btrim(p_datos->>'telefono'), ''), direccion = NULLIF(btrim(p_datos->>'direccion'), '')
     WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_cliente(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT;
BEGIN
  PERFORM exigir_modulo('clientes');
  SELECT nombre INTO v_nombre FROM clientes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM ventas WHERE cliente_id = p_id) THEN
    RAISE EXCEPTION 'No se puede eliminar a %: tiene ventas registradas', v_nombre;
  END IF;
  DELETE FROM clientes WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. EGRESOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_egreso(p_concepto TEXT, p_monto NUMERIC, p_categoria TEXT, p_fecha DATE, p_comprobante_url TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM exigir_algun_modulo(ARRAY['egresos', 'materia_prima']);
  IF COALESCE(btrim(p_concepto), '') = '' THEN RAISE EXCEPTION 'Escribe el concepto del gasto'; END IF;
  IF COALESCE(p_monto, 0) <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  IF COALESCE(btrim(p_categoria), '') = '' THEN RAISE EXCEPTION 'Elige la categoría del gasto'; END IF;
  INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha, comprobante_url)
  VALUES (btrim(p_concepto), p_monto, btrim(p_categoria), COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date), NULLIF(btrim(p_comprobante_url), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_egreso(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_modulo('egresos');
  PERFORM 1 FROM egresos_adicionales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Egreso no encontrado'; END IF;
  IF EXISTS (SELECT 1 FROM compras_repuestos WHERE egreso_id = p_id) THEN
    RAISE EXCEPTION 'Este gasto viene de una compra de repuestos: no se elimina aquí';
  END IF;
  DELETE FROM egresos_adicionales WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. GASTOS DE MATERIA PRIMA POR PAGOS REALES (P1-A)
-- ------------------------------------------------------------------------------
CREATE VIEW public.vista_gastos_materia_prima WITH (security_invoker = true) AS
SELECT c.fecha, c.costo_total AS monto, 'contado'::TEXT AS origen, c.id AS compra_id
  FROM public.compras_materia_prima c
 WHERE COALESCE(c.condicion_pago, 'contado') = 'contado' AND c.estado = 'recibida'
UNION ALL
SELECT p.fecha, p.monto, 'cuota'::TEXT AS origen, q.compra_id
  FROM public.pagos_proveedores p
  LEFT JOIN public.cuotas_compras q ON q.id = p.cuota_compra_id;

-- ------------------------------------------------------------------------------
-- 9. PERMISOS
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.vista_gastos_materia_prima FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vista_gastos_materia_prima TO authenticated;
GRANT ALL ON TABLE public.vista_gastos_materia_prima TO service_role;

-- Catálogo, caja, clientes, egresos y compras/pagos de materia prima: con sesión solo se leen;
-- se escriben por sus funciones (las de compras y pagos ya existían: 024 y 027)
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cajas_diarias, public.clientes, public.egresos_adicionales,
  public.catalogo_medias, public.modelos_media, public.compras_materia_prima, public.cuotas_compras, public.pagos_proveedores FROM authenticated;

REVOKE ALL ON FUNCTION public.exigir_algun_modulo(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exigir_algun_modulo(TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION public.proteger_identidad_producto() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.crear_producto(jsonb)', 'public.editar_producto(uuid, jsonb)', 'public.cambiar_estado_producto(uuid, text)',
    'public.eliminar_producto(uuid)', 'public.crear_modelo_media(text)', 'public.abrir_caja(uuid, numeric)',
    'public.cerrar_caja(uuid, numeric, text)', 'public.guardar_cliente(uuid, jsonb)', 'public.eliminar_cliente(uuid)',
    'public.registrar_egreso(text, numeric, text, date, text)', 'public.eliminar_egreso(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

COMMIT;
