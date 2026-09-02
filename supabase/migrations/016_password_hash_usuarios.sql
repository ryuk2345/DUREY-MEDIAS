-- ==============================================================================
-- Migración 016: Agregar password_hash y debe_cambiar_password a usuarios
-- Cierra la vulnerabilidad crítica de login sin validación de contraseña
-- ==============================================================================

BEGIN;

-- 1. Agregar columna de hash de contraseña (nullable: usuarios existentes
--    sin hash asignado quedan bloqueados hasta que el admin les asigne una)
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Agregar flag para forzar cambio de contraseña en primer login
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
