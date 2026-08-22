-- Migración 007: Asignaciones de Turno Dinámicas y Rol de Operador Genérico

BEGIN;

-- 1. Crear la tabla de asignaciones de turno
CREATE TABLE IF NOT EXISTS asignaciones_turno (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operador_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  area         TEXT NOT NULL CHECK (area IN ('tejido', 'enlace', 'volteado', 'planchado', 'preparado', 'almacen')),
  fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
  turno        TEXT NOT NULL CHECK (turno IN ('dia', 'noche')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (operador_id, fecha, turno)
);

-- Crear índices para acelerar búsquedas de asignación diaria
CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_fecha ON asignaciones_turno(fecha);
CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_area ON asignaciones_turno(area);
CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_operador ON asignaciones_turno(operador_id);

-- 2. Migración de Datos: Respaldar roles históricos asignando turnos predeterminados
-- Crea una asignación de hoy para cada operario basado en su rol rígido actual
INSERT INTO asignaciones_turno (operador_id, area, fecha, turno)
SELECT 
  id as operador_id,
  CASE 
    WHEN rol = 'tejedor'     THEN 'tejido'
    WHEN rol = 'remalladora' THEN 'enlace'
    WHEN rol = 'volteador'   THEN 'volteado'
    WHEN rol = 'planchador'  THEN 'planchado'
    WHEN rol = 'preparador'  THEN 'preparado'
    WHEN rol = 'almacenero'  THEN 'almacen'
    WHEN rol = 'operador'    THEN 'tejido'  -- usuarios ya migrados → default tejido
  END as area,
  CURRENT_DATE as fecha,
  'dia' as turno
FROM usuarios
WHERE rol IN ('tejedor', 'remalladora', 'volteador', 'planchador', 'preparador', 'almacenero', 'operador')
  AND NOT EXISTS (  -- no duplicar si ya tienen asignación hoy
    SELECT 1 FROM asignaciones_turno a
    WHERE a.operador_id = usuarios.id
      AND a.fecha = CURRENT_DATE
      AND a.turno = 'dia'
  );

-- 3. PRIMERO: Eliminar el constraint viejo (006 no incluía 'operador')
--    Sin este paso el UPDATE de abajo falla con violación de constraint
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;

-- 4. SEGUNDO: Migrar perfiles al rol genérico (ahora sin constraint que lo bloquee)
UPDATE usuarios
SET rol = 'operador'
WHERE rol IN ('tejedor', 'remalladora', 'volteador', 'planchador', 'preparador', 'almacenero');

-- 5. TERCERO: Agregar el nuevo constraint (datos ya actualizados, seguro)
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN (
  'admin', 'supervisor', 'operador', 'vendedora', 'tecnico'
));

COMMIT;
