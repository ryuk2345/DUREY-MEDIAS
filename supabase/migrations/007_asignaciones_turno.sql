-- Migración 007: Asignaciones de Turno Dinámicas y Rol de Operador Genérico

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
    WHEN rol = 'tejedor' THEN 'tejido'
    WHEN rol = 'remalladora' THEN 'enlace'
    WHEN rol = 'volteador' THEN 'volteado'
    WHEN rol = 'planchador' THEN 'planchado'
    WHEN rol = 'preparador' THEN 'preparado'
    WHEN rol = 'almacenero' THEN 'almacen'
  END as area,
  CURRENT_DATE as fecha,
  'dia' as turno
FROM usuarios
WHERE rol IN ('tejedor', 'remalladora', 'volteador', 'planchador', 'preparador', 'almacenero')
ON CONFLICT (operador_id, fecha, turno) DO NOTHING;

-- 3. Actualizar la restricción CHECK en usuarios.rol
-- Primero removemos la restricción vieja y creamos la nueva que incluye 'operador' y remueve los antiguos
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN (
  'admin', 'supervisor', 'operador', 'vendedora', 'tecnico'
));

-- 4. Migrar los perfiles de usuarios existentes al rol genérico
UPDATE usuarios 
SET rol = 'operador' 
WHERE rol IN ('tejedor', 'remalladora', 'volteador', 'planchador', 'preparador', 'almacenero');
