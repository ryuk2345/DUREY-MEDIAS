---
author: ryuk2345
branch: fase-1/correcciones-botones
status: in-progress
---
# Fase 1 — Correcciones y botones

## Intent
Corregir lo que el cliente ve roto o confuso y añadir los botones que faltan, sin tocar los flujos de producción. Plan de fases: [plan-fases](../plan-fases.md).

## Scope
Dentro:
- Materia prima: dejar claro en pantalla que el stock sube al aprobar control de calidad, y que la compra a crédito crea sus cuotas.
- Cuentas por pagar: resumen en las cards de arriba, cambiar fecha de vencimiento, registrar pagos (fecha, monto, método); efectivo resta de la caja del día con RPC atómica.
- Máquinas: las 4 cards filtran la lista.
- Almacenes: editar nombre y borrado suave (bloqueado con paquetes dentro).
- Despacho: tabla `agencias` (migración 027) y botón para añadir.
- Tejido: botón "copiar asignación del día anterior" (máquinas+producto y operarios), rellena el formulario.

Fuera: Egresos/Balance a plazos (Fase 7), cualquier cambio de modelo no listado.

## Checklist
- [x] T1 Máquinas: filtros por card — prueba: test unitario de la función de filtro + Playwright.
- [x] T2 Almacenes: editar/eliminar — prueba: test de la regla "no eliminar con paquetes" + Playwright.
- [x] T3 Migración 027: `agencias`, `pagos_proveedores`, RPCs — prueba: e2e (mock) + test SQL escrito. El test SQL NO se ha ejecutado (no hay Postgres de prueba aquí).
- [x] T4 Despacho: agencias desde la tabla + añadir — prueba: e2e + Playwright (flujo-comercial).
- [x] T5 Cuentas por pagar: cards, reprogramar fecha, pagar con RPC — prueba: e2e del RPC + Playwright.
- [x] T6 Materia prima: estado claro (en camino / pendiente QC, cuotas visibles) — prueba: Playwright compra a crédito.
- [x] T7 Tejido: copiar asignación del día anterior — prueba: test de la función de copia + Playwright.
- [x] T8 Controles: npm test, Playwright, build, rsc risk (tier 2 → spec + panel de 3 revisores).

## Evidence
- Línea base en main (2026-11-25): `npm test` 15 archivos / 147 tests; `npm run test:browser` 34/34.
- Causa raíz del fallo de Materia Prima: la consulta de cuotas no traía `proveedor_id` de la compra → la deuda por proveedor salía en 0. Además el mock no resolvía la unión cuotas→compra (en modo local salía "Desconocido").
- `npm test`: 16 archivos / 173 tests en verde (26 nuevos en tests/e2e/15).
- `npm run test:browser`: 38/38 en verde (4 nuevos + agencia nueva en flujo-comercial).
- `npm run build`: compila.
- `npx tsc --noEmit`: sin errores.
- Lint: 0 errores nuevos frente a main en los archivos tocados (había 43 previos en esas páginas).
- `rsc risk`: tier 2 (migración CREATE TABLE) → spec [fase-1-correcciones-botones](../sdd/specs/fase-1-correcciones-botones.md), gate PASS.
- Panel de 3 revisores (correctitud, seguridad, tests) sobre 3e3733a: 0 bloqueos. Corregido en 9eb3ab7: quien paga sale de auth.uid(); elección de caja (propia, general, más antigua) y aviso de cuál; reactivar almacén eliminado al crearlo; cierre de caja relee la caja; cuotas sin monto; 11 tests nuevos que matan los mutantes que sobrevivían. Panel registrado en el ledger sobre 9eb3ab7.
- Tras correcciones: `npm test` 184/184; `npm run test:browser` 38/38; build OK; lint 0 errores nuevos.
- No corregido (anotado): fechas tomadas en UTC en todo el sistema (después de las 19:00 en Lima ya es "mañana"); patrón previo, a decidir con el usuario.
- No ejecutado: supabase/tests/027_*.test.sql (requiere Postgres de prueba).

## Next
PR y fusión. Luego: el usuario ejecuta la migración 027 en Supabase (antes de usar las pantallas nuevas en producción).
