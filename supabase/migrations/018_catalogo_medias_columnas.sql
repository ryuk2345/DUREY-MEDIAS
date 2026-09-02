-- ==============================================================================
-- Migración 018: Asegurar columnas de SKU y Precios en catalogo_medias
-- Permite registrar nuevos productos con SKU para pistolas lectoras y precio sugerido
-- ==============================================================================

BEGIN;

-- 1. Agregar columna SKU (única para lector de barras) si no existe
ALTER TABLE public.catalogo_medias 
  ADD COLUMN IF NOT EXISTS sku TEXT UNIQUE;

-- 2. Agregar columna precio_venta_sugerido si no existe
ALTER TABLE public.catalogo_medias 
  ADD COLUMN IF NOT EXISTS precio_venta_sugerido NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 3. Agregar columna peso_docena_g si no existe
ALTER TABLE public.catalogo_medias 
  ADD COLUMN IF NOT EXISTS peso_docena_g NUMERIC(10,2) NOT NULL DEFAULT 360.00;

COMMIT;
