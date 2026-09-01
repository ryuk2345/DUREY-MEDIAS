-- Migración 011: Agregar tipo_empaque a materia_prima (Bolsas, Conos y Cajas)
-- Permite clasificar la materia prima según su tipo de presentación física.

BEGIN;

-- 1. Agregar columna tipo_empaque con valor por defecto 'cono'
ALTER TABLE public.materia_prima 
ADD COLUMN IF NOT EXISTS tipo_empaque TEXT NOT NULL DEFAULT 'cono' 
CHECK (tipo_empaque IN ('bolsa', 'cono', 'caja'));

-- 2. Actualizar la restricción única para permitir el mismo material y color en diferentes empaques
DO $$
BEGIN
  -- Eliminar restricción única anterior si existe
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'materia_prima_material_color_key'
  ) THEN
    ALTER TABLE public.materia_prima DROP CONSTRAINT materia_prima_material_color_key;
  END IF;
END $$;

-- 3. Crear nueva restricción única con tipo_empaque
ALTER TABLE public.materia_prima 
DROP CONSTRAINT IF EXISTS materia_prima_material_color_empaque_key;

ALTER TABLE public.materia_prima 
ADD CONSTRAINT materia_prima_material_color_empaque_key 
UNIQUE (material, color, tipo_empaque);

COMMIT;
