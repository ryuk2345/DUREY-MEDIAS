---
author: ryuk2345
branch: fase-1/correcciones-botones
status: done
merged: 2026-11-25
pr: #14
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
- [x] T3 Migración 027: `agencias`, `pagos_proveedores`, RPCs — prueba: e2e (mock) + test SQL ejecutado en Postgres local (ver Evidence, 2026-11-25).
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
- Test SQL de la 027 ejecutado después de fusionar (2026-11-25), en un Postgres 16 local con roles y esquemas de Supabase simulados y las migraciones 002–027 aplicadas en orden: `supabase/tests/021` a `027` pasan todos.

## Aplicación en la base real (2026-11-25)
- Antes: la base real estaba en la 025 (huellas en el esquema; el historial de migraciones de Supabase está vacío porque todas se aplicaron desde el editor SQL). Las 41 tablas estaban sin RLS y abiertas a anon.
- 026 aplicada tal cual. Comprobado con SQL: 0 permisos de anon en tablas, vistas, columnas, secuencias y funciones; 41/41 tablas con RLS y política `durey_usuarios_con_sesion`. El usuario probó la web: funciona.
- 027 aplicada tal cual tras fusionar #14. Comprobado: 4 agencias (Flores Cargo, Marvisur, Olva Courier, Shalom), 1 pago antiguo en `pagos_proveedores`, 6 funciones nuevas, 43/43 tablas con RLS y la política, 0 permisos de anon.
- Advisors de seguridad: sin avisos nuevos. Quedaban avisos antiguos (vista SECURITY DEFINER y 5 funciones sin search_path): los resuelve la 028, ver [cierre-fase-1-migracion-028](cierre-fase-1-migracion-028.md).

## Next
Fusionado en main el 2026-11-25 (5782e63). Migraciones 026 y 027 aplicadas en la base real el 2026-11-25. Siguiente: Fase 2 del [plan de fases](../plan-fases.md).
