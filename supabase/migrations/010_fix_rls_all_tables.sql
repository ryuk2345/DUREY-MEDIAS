-- Migración 010: Corrección y Apertura Total de Políticas RLS para todas las tablas del sistema
-- Permite insertar, actualizar, seleccionar y eliminar datos en todas las tablas sin bloqueos de RLS.

BEGIN;

-- 1. Deshabilitar RLS en todas las tablas públicas para evitar bloqueos por falta de token JWT
ALTER TABLE IF EXISTS public.materia_prima DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.compras_materia_prima DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.movimientos_materia_prima DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cuotas_compras DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.proveedores DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.catalogo_medias DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.maquinas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.marcas_maquinas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asignaciones_turno DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.turnos_produccion DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.turno_maquinas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reportes_produccion DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.lotes_remallado DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reportes_remallado DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lotes_volteado DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reportes_volteado DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.cronograma_planchado DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reportes_planchado DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cronograma_preparado DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.paquetes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.movimientos_stock DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.minidepositos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_listo_voltear DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stock_listo_planchar DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ventas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.items_venta DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cuotas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cobros DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cajas_diarias DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.guias_remision DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.repuestos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.averias_maquinas DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reparaciones DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.egresos_adicionales DISABLE ROW LEVEL SECURITY;

-- 2. Conceder todos los privilegios a los roles de Supabase (anon, authenticated, service_role)
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

COMMIT;
