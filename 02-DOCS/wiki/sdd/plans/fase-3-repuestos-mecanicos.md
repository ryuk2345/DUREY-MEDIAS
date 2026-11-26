---
type: plan
title: Plan — Fase 3, repuestos y mecánicos
spec: ../specs/fase-3-repuestos-mecanicos.md
branch: fase-3/repuestos-mecanicos
timestamp: 2026-11-26T00:10:00Z
---

# Plan — Fase 3, repuestos y mecánicos

Spec aprobada: [fase-3-repuestos-mecanicos](../specs/fase-3-repuestos-mecanicos.md). Constitución v1.0.0.

## Modelo de datos (migración 029, en `BEGIN … COMMIT`)
- **Guarda previa:** si existe algún usuario con rol `tecnico`, la migración se detiene con un mensaje (no borra ni cambia usuarios). En la base real hay 0.
- `mecanicos` (nombre, apellido, teléfono, activo). Alta, edición y baja (activo = false) desde la pantalla: una sola tabla, sin RPC.
- `averias_maquinas.mecanico_id` y `reparaciones.mecanico_id` → `mecanicos`. `asignado_a` (texto) y `tecnico_id` se conservan para el historial.
- `compras_repuestos` (repuesto, proveedor opcional, cantidad, precio unitario, total, método, fecha, de_caja, caja, egreso, registrado_por).
- `averia_repuestos` (falla, repuesto, cantidad, costo unitario del momento, mecánico, registrado_por).
- `usuarios.rol`: el CHECK pierde `tecnico`.
- Tablas nuevas con RLS + `durey_usuarios_con_sesion`, permisos solo `authenticated`/`service_role`, funciones con `search_path = public, pg_temp`.

## Funciones atómicas (SECURITY DEFINER)
- `_caja_abierta_hoy(p_usuario)` (interna, sin EXECUTE para nadie): la caja de quien paga, si no la general, si no la más antigua (regla de la 027).
- `registrar_compra_repuesto(repuesto, cantidad, precio, método, fecha, proveedor, de_caja, usuario)`: stock += cantidad; costo_unitario = precio; egreso "repuestos" por el total; si efectivo + de_caja + fecha de hoy + total > 0 → `pagos_efectivo` de la caja elegida. Devuelve compra, egreso, caja y de quién.
- `asignar_mecanico_averia(falla, mecánico)`: falla no resuelta; mecánico activo; guarda `mecanico_id` y `asignado_a` = "Nombre Apellido".
- `iniciar_reparacion_mecanico(falla, mecánico)`: igual que `iniciar_reparacion_averia` + asigna mecánico (obligatorio).
- `usar_repuesto_en_averia(falla, repuesto, cantidad)`: falla en reparación; stock suficiente (mensaje del spec); descuenta y registra con el costo del momento. Sin egreso.
- `quitar_repuesto_de_averia(uso)`: falla en reparación; devuelve el stock y borra el uso.
- `cerrar_reparacion_averia(falla, diagnóstico, mano_obra)`: costo_repuestos = suma de usos; reparación con el mecánico de la falla; falla resuelta y máquina activa.
- `ajustar_stock_repuesto`: misma firma, ya no crea egreso.
- `registrar_reparacion_averia` e `iniciar_reparacion_averia`: se retira EXECUTE a `authenticated` (las reemplazan las nuevas).

## Aplicación
- `lib/domain/repuestos.ts`: filtro de repuestos, total de compra, costo de reparación, nombre de mecánico (tests).
- Materia Prima › Repuestos: buscador + filtro, "Registrar compra" (casilla «Pagado con efectivo de la caja del día» si es efectivo).
- Máquinas: pestaña Mecánicos; el formulario de falla elige mecánico (ya no técnicos-usuarios).
- Mantenimiento: iniciar con mecánico; repuestos usados (añadir/quitar); cierre con costo calculado.
- Ventas (caja): la línea "Pagos a proveedores" pasa a "Pagos a proveedores y compras".
- Reportes: Mantenimiento muestra el mecánico.
- Rol `tecnico` fuera: `MODULOS_POR_ROL`, `ROLES_LABELS`, login, cambio de contraseña, usuarios, `normalizarRol`.
- Mock: tablas y RPC nuevas (`mockRpcMantenimiento.ts`), semillas de mecánicos en lugar de usuarios técnicos.

## Pruebas
- SQL: `supabase/tests/029_*.test.sql` + `supabase/scripts/revertir_029.sql` (probados con `probar_migraciones.sh`).
- `tests/e2e/17-repuestos-mecanicos.test.ts` (dominio + RPC del mock).
- Playwright `tests/browser/repuestos-mecanicos.spec.ts`.

## Tareas
| # | Tarea | Criterio | Riesgo | Hecho cuando |
|---|---|---|---|---|
| T1 | Test SQL 029 (rojo) | AC1-AC6 | 2 | falla sin la 029 |
| T2 | Migración 029 + reversión | AC1-AC6 | 2 | `probar_migraciones.sh` verde + "PASA reversión 029" |
| T3 | `lib/domain/repuestos.ts` + tests | AC1, AC3 | 1 | tests verdes |
| T4 | Mock: tablas, semillas y RPC + tests e2e | AC1-AC4 | 1 | `npm test` verde |
| T5 | Repuestos: buscador, filtro, compra | AC1 | 2 (money) | Playwright compra |
| T6 | Máquinas: mecánicos; formulario de falla | AC4 | 1 | Playwright mecánico |
| T7 | Mantenimiento: iniciar, usar/quitar, cerrar | AC2, AC3 | 1 | Playwright falla completa |
| T8 | Quitar rol técnico | AC5 | 2 (auth) | tests + build |
| T9 | Caja y reportes | AC1 | 2 (money) | tests |
| T10 | Cierre: pruebas completas, panel de 3, PR | todos | 2 | DoD de la constitución |
| T11 | Tras fusionar: 029 en base real + verificación | — | 2 | SQL + advisors |
