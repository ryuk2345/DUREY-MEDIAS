-- Migración 999: Purga absoluta de datos de prueba
-- Limpia absolutamente todo el sistema, conservando exclusivamente la cuenta de administrador.

BEGIN;

-- Desactivar triggers temporalmente para evitar interrupciones durante el truncado
SET CONSTRAINTS ALL DEFERRED;

-- 1. Truncar tablas operativas y de configuración de catálogo/máquinas con CASCADE
TRUNCATE TABLE 
  -- Producción/Tejido
  public.reportes_produccion,
  public.turno_maquinas,
  public.turnos_produccion,
  public.asignaciones_turno,
  -- Remallado
  public.reportes_remallado,
  public.lotes_remallado,
  -- Volteado
  public.reportes_volteado,
  public.lotes_volteado,
  -- Planchado
  public.reportes_planchado,
  public.cronograma_planchado,
  -- Preparado
  public.cronograma_preparado,
  -- Ventas/Clientes
  public.cobros,
  public.cuotas,
  public.items_venta,
  public.ventas,
  public.cajas_diarias,
  public.guias_remision,
  public.clientes,
  -- Mantenimiento
  public.reparaciones,
  public.averias_maquinas,
  public.egresos_adicionales,
  public.cuotas_compras,
  public.repuestos,
  -- Materia Prima
  public.movimientos_materia_prima,
  public.compras_materia_prima,
  public.materia_prima,
  public.proveedores,
  -- Stock
  public.paquetes,
  public.movimientos_stock,
  public.stock_listo_voltear,
  public.stock_listo_planchar,
  public.minidepositos,
  -- Catálogo y Máquinas
  public.catalogo_medias,
  public.maquinas,
  public.marcas_maquinas
CASCADE;

-- 2. Limpieza en la tabla de usuarios
-- Eliminar todo usuario excepto el administrador
DELETE FROM public.usuarios 
WHERE email != 'admin@durey.com';

-- Reiniciar estado y disponibilidad del administrador
UPDATE public.usuarios 
SET estado = 'disponible' 
WHERE email = 'admin@durey.com';

COMMIT;
