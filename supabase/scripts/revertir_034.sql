-- ==============================================================================
-- REVERSIÓN de la migración 034 (un SKU por saco, kardex, traslados, despacho por sacos, bloqueo por rol)
--
-- Usar SOLO si, después de la 034, Almacén, Despacho, Ventas o Preparado dejan de funcionar.
-- ATENCIÓN: borra el detalle de los despachos hechos con la 034 (pedido frente a entregado);
-- las guías quedan sin "despachado por" y el kardex pierde SKU, venta y guía.
-- Requiere confirmación escrita del dueño antes de ejecutarse en la base real.
-- ==============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.despachar_venta_sacos(UUID, TEXT, UUID[]);
DROP FUNCTION IF EXISTS public.trasladar_saco(UUID, UUID);

-- Funciones como estaban en la 033 (texto exacto de la base)
CREATE OR REPLACE FUNCTION public.registrar_venta(p_cliente jsonb, p_asesora_id uuid, p_tipo_pago text, p_monto_adelanto numeric, p_items jsonb, p_cuotas jsonb, p_metodo_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_id UUID;
  v_venta_id   UUID;
  v_codigo     TEXT;
  v_total      NUMERIC;
  v_cobrado    NUMERIC;
BEGIN
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
    VALUES (v_venta_id, p_asesora_id, v_cobrado, p_metodo_pago, 'validado', CURRENT_DATE);
    PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_cobrado, TRUE);
  END IF;

  RETURN jsonb_build_object('venta_id', v_venta_id, 'codigo_venta', v_codigo, 'total_soles', v_total, 'monto_cobrado', v_cobrado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_cuotas(p_cuota_ids uuid[], p_metodo_pago text, p_comprobante_url text, p_asesora_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total  NUMERIC := 0;
  v_cuota  RECORD;
BEGIN
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
    VALUES (v_cuota.venta_id, v_cuota.id, COALESCE(p_asesora_id, v_cuota.asesora_id), v_cuota.monto, p_metodo_pago, 'validado', CURRENT_DATE);
    v_total := v_total + v_cuota.monto;
  END LOOP;

  PERFORM _sumar_a_caja(p_asesora_id, p_metodo_pago, v_total, FALSE);
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.almacenar_paquete(p_paquete_id uuid, p_ubicacion_id uuid, p_codigo_paquete text, p_catalogo_media_id uuid, p_docenas numeric, p_total_pares numeric, p_detalles jsonb, p_tipo_movimiento text, p_referencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_paq RECORD;
  v_id  UUID;
BEGIN
  IF p_ubicacion_id IS NULL OR NOT EXISTS (SELECT 1 FROM ubicaciones WHERE id = p_ubicacion_id) THEN
    RAISE EXCEPTION 'Selecciona un salón de destino válido';
  END IF;

  IF p_paquete_id IS NOT NULL THEN
    SELECT id, codigo_paquete, estado, docenas INTO v_paq FROM paquetes WHERE id = p_paquete_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Paquete no encontrado';
    END IF;
    -- Transiciones permitidas hacia 'almacenado': pendiente_almacenar, preparado_envio (o ya almacenado)
    IF v_paq.estado NOT IN ('pendiente_almacenar', 'preparado_envio', 'almacenado') THEN
      RAISE EXCEPTION 'El paquete % no se puede almacenar (estado: %)', v_paq.codigo_paquete, v_paq.estado;
    END IF;
    UPDATE paquetes SET estado = 'almacenado', ubicacion_id = p_ubicacion_id, updated_at = NOW() WHERE id = p_paquete_id;
    v_id := p_paquete_id;
  ELSE
    IF COALESCE(btrim(p_codigo_paquete), '') = '' OR COALESCE(p_docenas, 0) <= 0 THEN
      RAISE EXCEPTION 'Indica el código del paquete y una cantidad de docenas mayor a 0';
    END IF;
    INSERT INTO paquetes (codigo_paquete, catalogo_media_id, docenas, total_pares, ubicacion_id, detalles_contenido, estado)
    VALUES (btrim(p_codigo_paquete), p_catalogo_media_id, p_docenas, p_total_pares, p_ubicacion_id, p_detalles, 'almacenado')
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO movimientos_stock (tipo, referencia, paquete_id, ubicacion_id, docenas)
  VALUES (COALESCE(p_tipo_movimiento, 'ingreso_salon'), p_referencia, v_id, p_ubicacion_id,
          COALESCE(p_docenas, (SELECT docenas FROM paquetes WHERE id = v_id)));

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_ubicacion(p_nombre text, p_tipo text DEFAULT 'salon'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.renombrar_ubicacion(p_id uuid, p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.desactivar_ubicacion(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.registrar_agencia(p_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


GRANT INSERT, UPDATE, DELETE ON TABLE public.movimientos_stock, public.guias_remision, public.ventas, public.items_venta, public.cuotas, public.cobros, public.ubicaciones, public.agencias TO authenticated;
GRANT UPDATE, DELETE ON TABLE public.paquetes TO authenticated;
GRANT EXECUTE ON FUNCTION public.despachar_venta(UUID, TEXT, JSONB) TO authenticated;

DROP TABLE IF EXISTS public.despacho_detalle;
ALTER TABLE public.guias_remision DROP COLUMN IF EXISTS despachado_por;
DROP INDEX IF EXISTS public.movimientos_stock_ubicacion_idx;
ALTER TABLE public.movimientos_stock DROP COLUMN IF EXISTS guia_id;
ALTER TABLE public.movimientos_stock DROP COLUMN IF EXISTS venta_id;
ALTER TABLE public.movimientos_stock DROP COLUMN IF EXISTS catalogo_media_id;
ALTER TABLE public.paquetes DROP CONSTRAINT IF EXISTS paquetes_un_solo_sku;

COMMIT;
