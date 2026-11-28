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
  -- Solo enlaces web: un «javascript:» guardado se ejecutaría al abrir el comprobante
  IF NULLIF(btrim(p_comprobante_url), '') IS NOT NULL AND btrim(p_comprobante_url) !~* '^https?://' THEN
    RAISE EXCEPTION 'El comprobante debe ser un enlace que empiece con http:// o https://';
  END IF;
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
-- 8b. LA CAJA DEL DÍA ES LA DE LIMA (hallazgo del panel: abrir_caja usa la fecha de Lima y
--     estas funciones buscaban la caja con CURRENT_DATE, que en el servidor es UTC: después
--     de las 7 p. m. las ventas, cobros y pagos en efectivo no entraban a la caja abierta).
--     Mismo texto que antes, solo cambia CURRENT_DATE por la fecha de Lima.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sumar_a_caja(p_asesora_id uuid, p_metodo text, p_monto numeric, p_es_venta boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caja_id UUID;
  v_efectivo BOOLEAN := (p_metodo = 'efectivo');
BEGIN
  IF COALESCE(p_monto, 0) <= 0 THEN RETURN; END IF;
  SELECT id INTO v_caja_id FROM cajas_diarias
   WHERE fecha = (NOW() AT TIME ZONE 'America/Lima')::date AND estado = 'abierta'
   ORDER BY (asesora_id IS NOT DISTINCT FROM p_asesora_id) DESC, created_at
   LIMIT 1
   FOR UPDATE;
  IF v_caja_id IS NULL THEN RETURN; END IF;  -- sin caja abierta: el cobro igual queda en `cobros`

  UPDATE cajas_diarias SET
    ventas_efectivo = ventas_efectivo + CASE WHEN p_es_venta AND v_efectivo THEN p_monto ELSE 0 END,
    ventas_digital  = ventas_digital  + CASE WHEN p_es_venta AND NOT v_efectivo THEN p_monto ELSE 0 END,
    cobros_efectivo = cobros_efectivo + CASE WHEN NOT p_es_venta AND v_efectivo THEN p_monto ELSE 0 END,
    cobros_digital  = cobros_digital  + CASE WHEN NOT p_es_venta AND NOT v_efectivo THEN p_monto ELSE 0 END
  WHERE id = v_caja_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_cuota_id uuid, p_metodo_pago text, p_fecha date DEFAULT NULL::date, p_comprobante_url text DEFAULT NULL::text, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuota    cuotas_compras%ROWTYPE;
  v_prov_id  UUID;
  v_fecha    DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
  v_caja_id  UUID;
  v_pago_id  UUID;
  v_etiqueta TEXT;
  v_usuario  UUID := COALESCE(auth.uid(), p_usuario_id);  -- la sesión manda; el parámetro no se puede suplantar
  v_caja_de  UUID;
BEGIN
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'transferencia', 'yape_plin', 'otro') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF v_fecha > (NOW() AT TIME ZONE 'America/Lima')::date THEN
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
  IF p_metodo_pago = 'efectivo' AND v_fecha = (NOW() AT TIME ZONE 'America/Lima')::date THEN
    SELECT id, asesora_id INTO v_caja_id, v_caja_de FROM cajas_diarias
     WHERE fecha = (NOW() AT TIME ZONE 'America/Lima')::date AND estado = 'abierta'
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
$function$;

CREATE OR REPLACE FUNCTION public.registrar_compra_repuesto(p_repuesto_id uuid, p_cantidad integer, p_precio_unitario numeric, p_metodo_pago text, p_fecha date DEFAULT NULL::date, p_proveedor_id uuid DEFAULT NULL::uuid, p_de_caja boolean DEFAULT false, p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rep       RECORD;
  v_fecha     DATE := COALESCE(p_fecha, (NOW() AT TIME ZONE 'America/Lima')::date);
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
  IF v_fecha > (NOW() AT TIME ZONE 'America/Lima')::date THEN RAISE EXCEPTION 'La fecha de compra no puede ser futura'; END IF;
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
  IF p_metodo_pago = 'efectivo' AND COALESCE(p_de_caja, false) AND v_fecha = (NOW() AT TIME ZONE 'America/Lima')::date AND v_total > 0 THEN
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
$function$;

CREATE OR REPLACE FUNCTION public._caja_abierta_hoy(p_usuario uuid)
 RETURNS TABLE(caja_id uuid, asesora_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, c.asesora_id FROM cajas_diarias c
   WHERE c.fecha = (NOW() AT TIME ZONE 'America/Lima')::date AND c.estado = 'abierta'
   ORDER BY COALESCE(c.asesora_id = p_usuario, false) DESC, (c.asesora_id IS NULL) DESC, c.created_at
   LIMIT 1
$function$;

-- Ventas y cobros guardan el cobro con la fecha de Lima, la misma de la caja (panel, ronda 2)
CREATE OR REPLACE FUNCTION public.registrar_venta(p_cliente jsonb, p_asesora_id uuid, p_tipo_pago text, p_monto_adelanto numeric, p_items jsonb, p_cuotas jsonb, p_metodo_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cliente_id UUID;
  v_venta_id   UUID;
  v_codigo     TEXT;
  v_total      NUMERIC;
  v_cobrado    NUMERIC;
  v_falta      RECORD;
BEGIN
  PERFORM exigir_modulo('ventas');  -- 034: el rol debe tener el módulo
  IF p_asesora_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona la vendedora / asesora encargada';
  END IF;
  IF COALESCE(btrim(p_cliente->>'nombre'), '') = '' THEN
    RAISE EXCEPTION 'Ingresa el nombre o razón social del cliente';
  END IF;
  IF COALESCE(btrim(p_cliente->>'numero_documento'), '') = '' THEN
    RAISE EXCEPTION 'Ingresa el DNI o RUC del cliente';
  END IF;
  IF p_tipo_pago NOT IN ('directo', 'cuotas') THEN
    RAISE EXCEPTION 'Tipo de pago inválido';
  END IF;
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'yape', 'plin', 'transferencia') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto a la venta';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
    WHERE i.catalogo_media_id IS NULL OR COALESCE(i.docenas, 0) <= 0 OR COALESCE(i.precio_docena, 0) < 0
  ) THEN
    RAISE EXCEPTION 'Cada producto necesita una media, docenas mayores a 0 y un precio válido';
  END IF;
  IF p_tipo_pago = 'cuotas' AND (p_cuotas IS NULL OR jsonb_array_length(p_cuotas) = 0) THEN
    RAISE EXCEPTION 'Una venta a cuotas necesita su cronograma de pagos';
  END IF;

  -- 035: los crudos no se venden; no se vende más de lo que hay en sacos menos lo ya
  -- vendido sin despachar (decisión del dueño 2026-11-27, 2-A). El cerrojo evita que dos
  -- ventas a la vez tomen el mismo stock.
  PERFORM pg_advisory_xact_lock(hashtext('durey_stock_venta'));
  SELECT c.codigo INTO v_codigo
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
    JOIN catalogo_medias c ON c.id = i.catalogo_media_id
   WHERE c.es_crudo ORDER BY c.codigo LIMIT 1;
  IF v_codigo IS NOT NULL THEN
    RAISE EXCEPTION 'No se vende %: es un producto crudo', v_codigo;
  END IF;
  SELECT c.codigo, x.pedidas, COALESCE(s.vendibles, 0) AS hay INTO v_falta
    FROM (SELECT i.catalogo_media_id, SUM(i.docenas) AS pedidas
            FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC)
           GROUP BY i.catalogo_media_id) x
    JOIN catalogo_medias c ON c.id = x.catalogo_media_id
    LEFT JOIN vista_stock_vendible s ON s.catalogo_media_id = x.catalogo_media_id
   WHERE x.pedidas > COALESCE(s.vendibles, 0)
   ORDER BY c.codigo LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'No hay stock suficiente de %: pides % docenas y hay % para vender', v_falta.codigo, v_falta.pedidas, GREATEST(v_falta.hay, 0);
  END IF;
  v_codigo := NULL;

  SELECT SUM(i.docenas * i.precio_docena) INTO v_total
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC);
  IF COALESCE(p_monto_adelanto, 0) < 0 OR COALESCE(p_monto_adelanto, 0) > v_total THEN
    RAISE EXCEPTION 'El adelanto debe estar entre 0 y el total de la venta';
  END IF;

  INSERT INTO clientes (tipo_documento, numero_documento, nombre, telefono, direccion)
  VALUES (
    COALESCE(NULLIF(p_cliente->>'tipo_documento', ''), 'dni'),
    btrim(p_cliente->>'numero_documento'),
    btrim(p_cliente->>'nombre'),
    COALESCE(btrim(p_cliente->>'telefono'), ''),
    COALESCE(btrim(p_cliente->>'direccion'), '')
  )
  ON CONFLICT (numero_documento) DO UPDATE
    SET tipo_documento = EXCLUDED.tipo_documento,
        nombre = EXCLUDED.nombre,
        telefono = EXCLUDED.telefono,
        direccion = EXCLUDED.direccion
  RETURNING id INTO v_cliente_id;

  PERFORM pg_advisory_xact_lock(hashtext('durey_codigo_venta'));
  SELECT _siguiente_codigo('V-', 1001, count(*),
           max(NULLIF(regexp_replace(codigo_venta, '\D', '', 'g'), '')::INTEGER))
    INTO v_codigo FROM ventas;

  INSERT INTO ventas (codigo_venta, cliente_id, asesora_id, tipo_pago, total_soles, monto_adelanto, estado)
  VALUES (v_codigo, v_cliente_id, p_asesora_id, p_tipo_pago, v_total, COALESCE(p_monto_adelanto, 0), 'pendiente')
  RETURNING id INTO v_venta_id;

  INSERT INTO items_venta (venta_id, catalogo_media_id, docenas, precio_docena)
  SELECT v_venta_id, i.catalogo_media_id, i.docenas, i.precio_docena
    FROM jsonb_to_recordset(p_items) AS i(catalogo_media_id UUID, docenas NUMERIC, precio_docena NUMERIC);

  IF p_tipo_pago = 'cuotas' THEN
    INSERT INTO cuotas (venta_id, numero_cuota, monto, fecha_vencimiento, estado)
    SELECT v_venta_id, c.numero_cuota, c.monto, c.fecha_vencimiento, 'pendiente'
      FROM jsonb_to_recordset(p_cuotas) AS c(numero_cuota INTEGER, monto NUMERIC, fecha_vencimiento DATE);
  END IF;

  -- Cobro al momento de la venta: total (contado) o adelanto (cuotas)
  v_cobrado := CASE WHEN p_tipo_pago = 'directo' THEN v_total ELSE COALESCE(p_monto_adelanto, 0) END;
  IF v_cobrado > 0 THEN
    INSERT INTO cobros (venta_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
    VALUES (v_venta_id, p_asesora_id, v_cobrado, p_metodo_pago, 'validado', (NOW() AT TIME ZONE 'America/Lima')::date);
    PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_cobrado, TRUE);
  END IF;

  RETURN jsonb_build_object('venta_id', v_venta_id, 'codigo_venta', v_codigo, 'total_soles', v_total, 'monto_cobrado', v_cobrado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_cuotas(p_cuota_ids uuid[], p_metodo_pago text, p_comprobante_url text, p_asesora_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total  NUMERIC := 0;
  v_cuota  RECORD;
BEGIN
  PERFORM exigir_modulo('ventas');  -- 034: el rol debe tener el módulo
  IF p_cuota_ids IS NULL OR array_length(p_cuota_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecciona al menos una cuota';
  END IF;
  IF COALESCE(p_metodo_pago, '') NOT IN ('efectivo', 'yape', 'plin', 'transferencia') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;
  IF (SELECT count(*) FROM cuotas WHERE id = ANY(p_cuota_ids)) <> array_length(p_cuota_ids, 1) THEN
    RAISE EXCEPTION 'Una de las cuotas no existe';
  END IF;

  FOR v_cuota IN
    SELECT q.id, q.venta_id, q.numero_cuota, q.monto, q.estado, v.asesora_id, v.codigo_venta
      FROM cuotas q JOIN ventas v ON v.id = q.venta_id
     WHERE q.id = ANY(p_cuota_ids)
     ORDER BY q.id
     FOR UPDATE OF q
  LOOP
    IF v_cuota.estado = 'pagada' THEN
      RAISE EXCEPTION 'La cuota N° % de la venta % ya está pagada', v_cuota.numero_cuota, v_cuota.codigo_venta;
    END IF;
    UPDATE cuotas SET estado = 'pagada', metodo_pago = p_metodo_pago, comprobante_url = p_comprobante_url WHERE id = v_cuota.id;
    INSERT INTO cobros (venta_id, cuota_id, asesora_id, monto, metodo_pago, estado_validacion, fecha)
    VALUES (v_cuota.venta_id, v_cuota.id, COALESCE(p_asesora_id, v_cuota.asesora_id), v_cuota.monto, p_metodo_pago, 'validado', (NOW() AT TIME ZONE 'America/Lima')::date);
    v_total := v_total + v_cuota.monto;
  END LOOP;

  PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_total, FALSE);
  RETURN v_total;
END;
$function$;

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
