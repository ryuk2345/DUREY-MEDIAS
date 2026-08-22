-- Migración 008: Estandarización de Códigos de Máquina Secuenciales (M01-M06)
-- CORRECCIÓN: La tabla se llama 'averias_maquinas', no 'averias'.
-- Los UPDATEs de descripciones quedaron sin efecto; se re-aplican en migración 009.

BEGIN;

-- 1. Actualizar los códigos en la tabla maquinas
UPDATE maquinas SET codigo = 'M01' WHERE codigo = 'A-01';
UPDATE maquinas SET codigo = 'M02' WHERE codigo = 'A-02';
UPDATE maquinas SET codigo = 'M03' WHERE codigo = 'B-01';
UPDATE maquinas SET codigo = 'M04' WHERE codigo = 'A-03';
UPDATE maquinas SET codigo = 'M05' WHERE codigo = 'R-01';
UPDATE maquinas SET codigo = 'M06' WHERE codigo = 'R-02';

-- 2. Actualizar descripciones en averías (tabla corregida: averias_maquinas)
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'A-01', 'M01') WHERE descripcion_operador LIKE '%A-01%';
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'A-02', 'M02') WHERE descripcion_operador LIKE '%A-02%';
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'B-01', 'M03') WHERE descripcion_operador LIKE '%B-01%';
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'A-03', 'M04') WHERE descripcion_operador LIKE '%A-03%';
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'R-01', 'M05') WHERE descripcion_operador LIKE '%R-01%';
UPDATE averias_maquinas SET descripcion_operador = REPLACE(descripcion_operador, 'R-02', 'M06') WHERE descripcion_operador LIKE '%R-02%';

COMMIT;
