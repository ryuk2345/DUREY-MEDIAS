-- =====================================================
-- MIGRACIÓN 009: Corrección de Inconsistencias del Modelo de Datos
-- Auditoría: 8 divergencias entre SQL, tipos TS y UI
-- SEGURA: Migra datos antes de cambiar constraints
-- =====================================================

BEGIN;

-- -------------------------------------------------------
-- FIX 1: paquetes.estado — Eliminar 'en_transito' del constraint
-- La tabla ya no usa ese estado (eliminado de TS en sesión anterior)
-- -------------------------------------------------------

-- Migrar datos existentes antes de tocar el constraint
UPDATE paquetes
SET estado = 'preparado_envio'
WHERE estado = 'en_transito';

-- Reescribir constraint
ALTER TABLE paquetes DROP CONSTRAINT IF EXISTS paquetes_estado_check;
ALTER TABLE paquetes ADD CONSTRAINT paquetes_estado_check
  CHECK (estado IN ('pendiente_almacenar','almacenado','preparado_envio','entregado'));

-- -------------------------------------------------------
-- FIX 2: cuotas_compras.estado — Unificar género a 'pagada'
-- La migración 004 usó 'pagado' (masculino) inconsistente
-- con cuotas de ventas que usan 'pagada' (femenino)
-- -------------------------------------------------------

UPDATE cuotas_compras
SET estado = 'pagada'
WHERE estado = 'pagado';

ALTER TABLE cuotas_compras DROP CONSTRAINT IF EXISTS cuotas_compras_estado_check;
ALTER TABLE cuotas_compras ADD CONSTRAINT cuotas_compras_estado_check
  CHECK (estado IN ('pendiente','pagada'));

-- -------------------------------------------------------
-- FIX 3: maquinas.tipo — Agregar 'planchadora' al constraint
-- La UI ya ofrecía esta opción pero SQL la rechazaba silenciosamente
-- -------------------------------------------------------

ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_tipo_check;
ALTER TABLE maquinas ADD CONSTRAINT maquinas_tipo_check
  CHECK (tipo IN ('tejedora','remalladora','planchadora'));

-- -------------------------------------------------------
-- FIX 4: usuarios.estado — Agregar constraint formal
-- El campo era TEXT libre; estandarizamos los valores válidos
-- -------------------------------------------------------

-- Normalizar cualquier 'en_turno' heredado (era sinónimo de 'ocupada')
UPDATE usuarios
SET estado = 'ocupada'
WHERE estado = 'en_turno';

-- Limpiar cualquier otro valor inesperado → 'disponible'
UPDATE usuarios
SET estado = 'disponible'
WHERE estado NOT IN ('disponible','ocupada','en_reparacion');

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_estado_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_estado_check
  CHECK (estado IN ('disponible','ocupada','en_reparacion'));

-- -------------------------------------------------------
-- FIX 5: Corregir las descripciones de averías que la
-- migración 008 no pudo actualizar (usaba tabla 'averias'
-- en vez de 'averias_maquinas')
-- -------------------------------------------------------

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'A-01', 'M01')
WHERE descripcion_operador LIKE '%A-01%';

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'A-02', 'M02')
WHERE descripcion_operador LIKE '%A-02%';

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'B-01', 'M03')
WHERE descripcion_operador LIKE '%B-01%';

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'A-03', 'M04')
WHERE descripcion_operador LIKE '%A-03%';

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'R-01', 'M05')
WHERE descripcion_operador LIKE '%R-01%';

UPDATE averias_maquinas
SET descripcion_operador = REPLACE(descripcion_operador, 'R-02', 'M06')
WHERE descripcion_operador LIKE '%R-02%';

-- -------------------------------------------------------
-- FIX 6: ventas.estado — Eliminar 'en_transito' del constraint
-- (análogo al fix de paquetes, misma inconsistencia)
-- -------------------------------------------------------

UPDATE ventas
SET estado = 'despachado'
WHERE estado = 'en_transito';

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_estado_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_estado_check
  CHECK (estado IN ('pendiente','despachado','entregado','cerrado'));

-- -------------------------------------------------------
-- DISABLE RLS en las nuevas tablas que puedan haber
-- quedado sin esta configuración
-- -------------------------------------------------------
ALTER TABLE cuotas_compras DISABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------
-- FIX 7: lotes_remallado.minideposito_id — Hacer nullable
-- El nuevo flujo de Remallado ya no requiere minidepositos,
-- por lo que la restricción NOT NULL de la base de datos bloqueaba inserciones.
-- -------------------------------------------------------
ALTER TABLE lotes_remallado ALTER COLUMN minideposito_id DROP NOT NULL;

COMMIT;

-- =====================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar manualmente):
-- SELECT estado, COUNT(*) FROM paquetes GROUP BY estado;
-- SELECT estado, COUNT(*) FROM cuotas_compras GROUP BY estado;
-- SELECT tipo, COUNT(*) FROM maquinas GROUP BY tipo;
-- SELECT estado, COUNT(*) FROM usuarios GROUP BY estado;
-- SELECT estado, COUNT(*) FROM ventas GROUP BY estado;
-- =====================================================
