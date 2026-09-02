-- ==============================================================================
-- Migración 017: Ampliar roles permitidos en la tabla 'usuarios'
-- Permite registrar operadores, diseñadores y todas las funciones del sistema
-- ==============================================================================

BEGIN;

-- 1. Eliminar la restricción de chequeo anterior si existe
ALTER TABLE public.usuarios 
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

-- 2. Crear la nueva restricción con todos los roles del sistema DUREY
ALTER TABLE public.usuarios 
  ADD CONSTRAINT usuarios_rol_check CHECK (
    rol IN (
      'admin',
      'supervisor',
      'disenador',
      'tejedor',
      'remalladora',
      'remallador',
      'planchador',
      'preparador',
      'almacenero',
      'vendedora',
      'tecnico',
      'operador'
    )
  );

COMMIT;
