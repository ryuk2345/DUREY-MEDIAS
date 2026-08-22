<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# DUREY — Reglas de Desarrollo para Agentes de IA

Este archivo define las reglas de modificación del codebase DUREY que **todo agente de IA debe respetar antes de escribir cualquier línea de código**. Las reglas son ejecutables: existen tests y linters que las verifican.

---

## REGLA 1 — Busca antes de crear

**Antes de implementar cualquier función, hook, componente o lógica nueva, DEBES buscar si ya existe algo equivalente.**

### Dónde buscar primero

| Qué necesitas | Dónde mirar |
|---|---|
| Lógica de estado de máquina / transiciones | `lib/domain/machines.ts` — `validarTransicionEstadoMaquina()` |
| Cálculo de stock por tipo de media | Vista SQL `vista_stock_medias` (consumir con Supabase, no calcular en cliente) |
| Formatos de moneda, fecha, semana | `lib/utils/index.ts` — `formatearMoneda()`, `formatearFecha()`, `getSemanaAnio()` |
| Generación de códigos (SKU, paquete, venta) | `lib/utils/index.ts` — `generarSkuMedia()`, `generarCodigoPaquete()`, etc. |
| Roles y módulos accesibles por rol | `lib/utils/index.ts` — `MODULOS_POR_ROL`, `ROLES_LABELS` |
| Componentes de UI reutilizables | `components/ui/` — Button, ConfirmDialog, EmptyState, StockNotification, etc. |
| Cliente de Supabase (cliente) | `lib/supabase/client.ts` — siempre usar `createClient()`, nunca instanciar directamente |
| Cliente de Supabase (servidor) | `lib/supabase/server.ts` — solo en Server Components y Route Handlers |

### Protocolo de búsqueda obligatorio

```bash
# Antes de crear, ejecuta:
grep -r "nombreFuncion\|conceptoClave" app/ lib/ components/ --include="*.ts" --include="*.tsx" -l
```

Si encuentras algo similar en **3 o más lugares distintos** → extráelo a `lib/utils/index.ts` o `lib/domain/`.

---

## REGLA 2 — Checklist obligatorio para cambios al modelo de datos

Cualquier modificación al schema de la base de datos (nueva tabla, nueva columna, cambio de constraint, cambio de valor de estado) **requiere actualizar TODOS estos archivos en el mismo commit**:

### Archivos de Schema SQL
- [ ] `supabase/migrations/0XX_nombre_descriptivo.sql` — nueva migración numerada (nunca modificar migraciones anteriores)
- [ ] Script siempre dentro de `BEGIN; ... COMMIT;`
- [ ] Migrar datos existentes ANTES de agregar constraints nuevos

### Tipos TypeScript
- [ ] Si hay un tipo `interface` o `type` en la página que usa esa tabla → actualizar el campo afectado
- [ ] Si el campo es un estado (string enum) → verificar que el tipo TS coincida exactamente con el CHECK de SQL

### Archivos de lógica de negocio
- [ ] `lib/domain/machines.ts` — si cambia `EstadoMaquina` o sus transiciones
- [ ] `lib/utils/index.ts` — si cambia `MODULOS_POR_ROL`, `ROLES_LABELS`, o funciones de formato

### Datos mock (desarrollo local)
- [ ] `lib/supabase/mockDb.ts` — si la tabla tiene semillas en el mock
- [ ] `mock_db.json` — si hay datos de prueba que usan el campo/valor cambiado

### Tests
- [ ] Verificar que `npm test` pasa sin errores tras la migración
- [ ] Si el cambio afecta a un flujo crítico → agregar/actualizar el test E2E correspondiente en `tests/e2e/`

### Tabla de flujo → archivos críticos

| Flujo | Archivos clave a revisar |
|---|---|
| **Tejido** | `app/dashboard/produccion/page.tsx`, `turnos_produccion`, `turno_maquinas`, `reportes_produccion` |
| **Remallado** | `app/dashboard/remallado/page.tsx`, `lotes_remallado`, `stock_listo_voltear` |
| **Volteado** | `app/dashboard/volteado/page.tsx`, `lotes_volteado`, `stock_listo_planchar` |
| **Planchado** | `app/dashboard/planchado/page.tsx`, `cronograma_planchado`, `stock_listo_planchar` |
| **Preparado** | `app/dashboard/preparado/page.tsx`, `cronograma_preparado`, `paquetes` |
| **Almacén/Despacho** | `app/dashboard/almacen/page.tsx`, `app/dashboard/despacho/page.tsx`, `paquetes`, `ventas`, `guias_remision` |
| **Roles / Turnos** | `lib/utils/index.ts` (`MODULOS_POR_ROL`), `app/(auth)/login/page.tsx`, `app/dashboard/page.tsx`, `asignaciones_turno` |
| **Máquinas** | `lib/domain/machines.ts`, `app/dashboard/maquinas/page.tsx`, `app/dashboard/mantenimiento/page.tsx` |
| **Stock** | Vista SQL `vista_stock_medias` (consumida en `StockNotification`, `despacho/page.tsx`, `ventas/page.tsx`) |

---

## REGLA 3 — Cero lógica de negocio duplicada entre frontend y backend

### Principio: Single Source of Truth

Toda lógica de negocio **debe vivir en un solo lugar**. Si esa lógica existe en el frontend, NO se reimplementa en otro componente.

### Fuentes únicas de verdad establecidas

| Regla de negocio | Ubicación canónica |
|---|---|
| Transiciones válidas de estado de máquina | `lib/domain/machines.ts` → `validarTransicionEstadoMaquina()` |
| Stock disponible de medias | Vista SQL `vista_stock_medias` (Supabase) |
| Roles y permisos de módulo | `lib/utils/index.ts` → `MODULOS_POR_ROL` |
| Formato de moneda | `lib/utils/index.ts` → `formatearMoneda()` |
| Formato de fecha | `lib/utils/index.ts` → `formatearFecha()` |
| Generación de códigos | `lib/utils/index.ts` → `generarCodigoPaquete()`, `generarCodigoVenta()`, etc. |
| Semana/año actual | `lib/utils/index.ts` → `getSemanaAnio()` |

### Lo que está PROHIBIDO

```typescript
// ❌ MAL — Cálculo de stock en cliente (ya fue reemplazado)
const stock = paquetes.reduce((acc, p) => acc + p.cantidad, 0)

// ✅ BIEN — Consultar vista SQL
const { data } = await supabase.from('vista_stock_medias').select('*')

// ❌ MAL — Reimplementar validación de transición de máquina
if (maquina.estado === 'activa' || maquina.estado === 'standby') { ... }

// ✅ BIEN — Usar la función del dominio
const { valido, error } = validarTransicionEstadoMaquina(maquina.estado, 'ocupada')

// ❌ MAL — Lógica de roles inline en un componente
if (userRol === 'tejedor' || userRol === 'operador') { mostrarBoton() }

// ✅ BIEN — Consultar MODULOS_POR_ROL
if (MODULOS_POR_ROL[userRol]?.includes('produccion')) { mostrarBoton() }
```

### Si necesitas lógica reutilizable nueva

1. Extráela a `lib/domain/<area>.ts` o `lib/utils/index.ts`
2. Escribe un test unitario en `tests/`
3. Importa desde todos los lugares que la necesiten

---

## REGLA 4 — Los tests E2E son obligatorios antes de mergear flujos críticos

### Flujos críticos que requieren tests verdes

| Flujo | Test E2E | Comando |
|---|---|---|
| Registrar producción (tejido) | `tests/e2e/01-registro-produccion.test.ts` | `npm test` |
| Cambio de turno de operador | `tests/e2e/02-cambio-turno-operador.test.ts` | `npm test` |
| Completar etapa (remallado/volteado/planchado) | `tests/e2e/03-completar-etapa-proceso.test.ts` | `npm test` |
| Escalamiento de incidencia a supervisor | `tests/e2e/04-escalamiento-incidencia.test.ts` | `npm test` |

### Protocolo obligatorio antes de mergear

```bash
# 1. Ejecutar la suite completa
npm test

# Salida esperada:
# Test Files  4 passed (4)
#      Tests  60 passed (60)

# 2. Si modificaste un flujo crítico, agregar/actualizar el test correspondiente
# 3. Si el test falla → el merge está BLOQUEADO hasta corregir la causa raíz
```

### Qué cuenta como "flujo crítico"

Un cambio toca un flujo crítico si modifica cualquiera de:
- Las tablas de stock: `stock_listo_voltear`, `stock_listo_planchar`, `paquetes`, `ventas`
- Las tablas de proceso: `turnos_produccion`, `lotes_remallado`, `lotes_volteado`, `cronograma_planchado`
- Las reglas de transición de estado en `lib/domain/machines.ts`
- La lógica de `asignaciones_turno` o `MODULOS_POR_ROL`
- El flujo de avería/reparación en `averias_maquinas`

### Agregar tests para cambios nuevos

Si introduces un comportamiento nuevo en un flujo crítico, **agrega el test ANTES o al mismo tiempo** que el código de producción (Test-Driven, no Test-After):

```typescript
// tests/e2e/0X-nombre-flujo.test.ts
it('[NEGOCIO] BLOQUEA <comportamiento inválido>', () => {
  const result = servicio.accion({ ...parametros_invalidos })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('mensaje esperado')
})
```

---

## Convenciones de nomenclatura

| Elemento | Convención | Ejemplo |
|---|---|---|
| Migración SQL | `00N_descripcion_snake_case.sql` | `009_corregir_inconsistencias_modelo.sql` |
| Estado de lote/proceso | snake_case, género consistente | `'en_proceso'`, `'completado'`, `'pagada'` |
| Estado de máquina | definido en `lib/domain/machines.ts` | `'activa'`, `'ocupada'`, `'malograda'` |
| Código de máquina | `M` + 2 dígitos | `M01` … `M06` |
| Estado de paquete/venta | sin `'en_transito'` (eliminado) | `'preparado_envio'`, `'entregado'` |
| Test E2E | `0N-nombre-flujo.test.ts` | `01-registro-produccion.test.ts` |

---

## Resumen rápido — Antes de cada PR

```
☐ ¿Existe ya algo similar? (grep antes de crear)
☐ ¿Toqué el modelo de datos? → checklist completo de Regla 2
☐ ¿Hay lógica duplicada? → moverla a lib/domain/ o lib/utils/
☐ ¿Afecta un flujo crítico? → npm test pasa en verde
```

