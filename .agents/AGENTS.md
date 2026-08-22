# DUREY — Workspace Agent Rules

Estas reglas aplican a **todo agente** que opere sobre el workspace `/DUREY REDINSEÑO/durey-app`.
Son un resumen ejecutivo de las reglas completas en [`AGENTS.md`](../durey-app/AGENTS.md).

---

## Contexto del proyecto

Sistema de gestión de producción para fábrica de medias DUREY (Peru).
- **Stack**: Next.js 16, React 19, Supabase, TypeScript, TailwindCSS v4
- **Base de datos**: Supabase (PostgreSQL). En desarrollo local: `mockDb.ts` + `mock_db.json`
- **Flujo productivo**: Tejido → Enlace (Remallado) → Volteado → Planchado → Preparado → Almacén/Despacho

## Reglas críticas

### REGLA 1: Busca antes de crear
Antes de escribir cualquier función o componente, revisar:
- `lib/domain/machines.ts` — transiciones de estado de máquina
- `lib/utils/index.ts` — formatos, roles, generación de códigos
- `components/ui/` — componentes reutilizables
- Vista SQL `vista_stock_medias` — stock de medias (no calcular en cliente)

### REGLA 2: Cambios al modelo de datos requieren checklist completo
Todo cambio a schema SQL debe actualizar **en el mismo commit**:
1. `supabase/migrations/0XX_descripcion.sql` (nueva, nunca modificar existentes)
2. Tipos TypeScript en las páginas que usan la tabla
3. `lib/domain/machines.ts` si cambia `EstadoMaquina`
4. `lib/utils/index.ts` si cambia `MODULOS_POR_ROL` o `ROLES_LABELS`
5. `lib/supabase/mockDb.ts` y `mock_db.json` si la tabla tiene datos mock
6. `npm test` debe pasar en verde

### REGLA 3: Cero lógica duplicada frontend/backend
- `validarTransicionEstadoMaquina()` — única fuente de verdad para transiciones de máquina
- `vista_stock_medias` — única fuente de verdad para stock (no calcular en cliente)
- `MODULOS_POR_ROL` — única fuente de verdad para permisos por rol
- Si necesitas lógica reutilizable → `lib/domain/<area>.ts` o `lib/utils/index.ts`

### REGLA 4: Tests E2E obligatorios antes de mergear flujos críticos
```bash
npm test   # debe mostrar: Tests  60 passed (60)
```
Si modificas producción/turnos/etapas/incidencias → el test correspondiente debe pasar.

## Estados válidos (fuentes de verdad)

| Entidad | Estados válidos |
|---|---|
| `maquinas.estado` | `activa`, `ocupada`, `malograda`, `mantenimiento`, `standby`, `inactiva` |
| `usuarios.estado` | `disponible`, `ocupada`, `en_reparacion` |
| `lotes_remallado.estado` | `en_proceso`, `completado`, `traspasado` |
| `lotes_volteado.estado` | `en_proceso`, `completado` |
| `paquetes.estado` | `pendiente_almacenar`, `almacenado`, `preparado_envio`, `entregado` |
| `ventas.estado` | `pendiente`, `despachado`, `entregado`, `cerrado` |
| `cuotas_compras.estado` | `pendiente`, `pagada` (femenino, consistente con cuotas de ventas) |
| `averias_maquinas.estado` | `pendiente`, `en_reparacion`, `resuelto` |
| `usuarios.rol` | `admin`, `supervisor`, `operador`, `vendedora`, `tecnico` (+ legacy: `tejedor`, `remalladora`, etc.) |
| `maquinas.tipo` | `tejedora`, `remalladora`, `planchadora` |
| `maquinas.codigo` | Formato `M01`–`M06` |

## Estructura de migraciones SQL

```sql
-- supabase/migrations/0XX_descripcion_snake_case.sql
BEGIN;
  -- Migrar datos existentes ANTES de agregar constraints
  UPDATE tabla SET campo = 'nuevo_valor' WHERE campo = 'valor_viejo';
  -- Luego agregar/reescribir constraint
  ALTER TABLE tabla DROP CONSTRAINT IF EXISTS tabla_campo_check;
  ALTER TABLE tabla ADD CONSTRAINT tabla_campo_check CHECK (campo IN (...));
COMMIT;
```

## Archivos por flujo crítico

| Flujo | Tablas | Página |
|---|---|---|
| Tejido | `turnos_produccion`, `turno_maquinas`, `reportes_produccion` | `app/dashboard/produccion/page.tsx` |
| Remallado | `lotes_remallado`, `stock_listo_voltear` | `app/dashboard/remallado/page.tsx` |
| Volteado | `lotes_volteado`, `stock_listo_planchar` | `app/dashboard/volteado/page.tsx` |
| Planchado | `cronograma_planchado`, `stock_listo_planchar` | `app/dashboard/planchado/page.tsx` |
| Preparado | `cronograma_preparado`, `paquetes` | `app/dashboard/preparado/page.tsx` |
| Almacén/Despacho | `paquetes`, `ventas`, `guias_remision` | `app/dashboard/almacen/page.tsx`, `despacho/page.tsx` |
| Incidencias | `averias_maquinas`, `reparaciones` | `app/dashboard/mantenimiento/page.tsx` |
| Turnos operadores | `asignaciones_turno` | `lib/utils/index.ts` (`MODULOS_POR_ROL`) |
