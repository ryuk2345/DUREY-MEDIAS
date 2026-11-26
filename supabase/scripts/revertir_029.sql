-- ==============================================================================
-- REVERSIÓN de la migración 029 (repuestos y mecánicos)
--
-- Usar SOLO si, después de la 029, Mantenimiento, Máquinas o Repuestos dejan de
-- funcionar. ATENCIÓN: borra las tablas nuevas y lo registrado en ellas
-- (mecánicos, compras de repuestos y repuestos usados en fallas). El stock y
-- los egresos que esas operaciones ya movieron NO se deshacen. Requiere
-- confirmación escrita del dueño antes de ejecutarse en la base real.
-- ==============================================================================

BEGIN;

-- Funciones nuevas
DROP FUNCTION IF EXISTS public.cerrar_reparacion_averia(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.quitar_repuesto_de_averia(UUID);
DROP FUNCTION IF EXISTS public.usar_repuesto_en_averia(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS public.iniciar_reparacion_mecanico(UUID, UUID);
DROP FUNCTION IF EXISTS public.asignar_mecanico_averia(UUID, UUID);
DROP FUNCTION IF EXISTS public.registrar_compra_repuesto(UUID, INTEGER, NUMERIC, TEXT, DATE, UUID, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS public._caja_abierta_hoy(UUID);

-- Tablas y columnas nuevas
DROP TABLE IF EXISTS public.averia_repuestos;
DROP TABLE IF EXISTS public.compras_repuestos;
ALTER TABLE public.reparaciones     DROP COLUMN IF EXISTS mecanico_id;
ALTER TABLE public.averias_maquinas DROP COLUMN IF EXISTS mecanico_id;
DROP TABLE IF EXISTS public.mecanicos;

-- Rol tecnico otra vez permitido
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol = ANY (ARRAY[
  'admin', 'supervisor', 'disenador', 'tejedor', 'remalladora', 'remallador', 'planchador',
  'preparador', 'almacenero', 'vendedora', 'tecnico', 'operador']));

-- Ajuste manual como en la 024/028 (la salida vuelve a crear egreso)
CREATE OR REPLACE FUNCTION public.ajustar_stock_repuesto(
  p_repuesto_id UUID,
  p_tipo        TEXT,
  p_cantidad    INTEGER,
  p_motivo      TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rep   RECORD;
  v_nuevo INTEGER;
BEGIN
  IF p_tipo NOT IN ('ingreso', 'salida') THEN RAISE EXCEPTION 'Tipo de ajuste inválido'; END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;

  SELECT id, nombre, stock_actual, costo_unitario INTO v_rep FROM repuestos WHERE id = p_repuesto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Repuesto no encontrado'; END IF;
  IF p_tipo = 'salida' AND p_cantidad > v_rep.stock_actual THEN
    RAISE EXCEPTION 'Solo hay % unidades de %; no se pueden sacar %', v_rep.stock_actual, v_rep.nombre, p_cantidad;
  END IF;

  v_nuevo := v_rep.stock_actual + CASE WHEN p_tipo = 'ingreso' THEN p_cantidad ELSE -p_cantidad END;
  UPDATE repuestos SET stock_actual = v_nuevo WHERE id = p_repuesto_id;

  IF p_tipo = 'salida' THEN
    INSERT INTO egresos_adicionales (concepto, monto, categoria, fecha)
    VALUES (
      'Consumo repuesto: ' || v_rep.nombre || ' (' || p_cantidad || ' uds.) — ' || COALESCE(NULLIF(btrim(p_motivo), ''), 'Mantenimiento'),
      p_cantidad * COALESCE(v_rep.costo_unitario, 0),
      'repuestos',
      CURRENT_DATE
    );
  END IF;

  RETURN v_nuevo;
END;
$$;

-- Funciones de antes, otra vez disponibles para la web
GRANT EXECUTE ON FUNCTION public.iniciar_reparacion_averia(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_reparacion_averia(UUID, TEXT, NUMERIC, NUMERIC, UUID) TO authenticated, service_role;

COMMIT;
