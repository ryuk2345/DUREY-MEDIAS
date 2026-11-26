---
type: plan
title: Plan — Fase 4, mantenimiento preventivo e historia clínica
spec: ../specs/fase-4-mantenimiento-preventivo.md
branch: fase-4/mantenimiento-preventivo
timestamp: 2026-11-26T15:45:00Z
---

# Plan — Fase 4

## Modelo (migración 031)
- `planes_mantenimiento` (máquina, tarea, frecuencia_dias > 0, fecha_inicio, ultima_fecha, activo). Próxima fecha = (ultima_fecha o fecha_inicio) + frecuencia_dias; la calcula `lib/domain/mantenimiento.ts`.
- `mantenimientos_preventivos` (plan, máquina, mecánico, estado en_curso/terminado, inicio, fin, nota, mano de obra, costo de repuestos). Un solo en curso por plan y por máquina (índices únicos parciales).
- `mantenimiento_repuestos` (mantenimiento, repuesto, cantidad, costo del momento).
- Funciones atómicas: `iniciar_mantenimiento_preventivo`, `usar_repuesto_en_mantenimiento`, `quitar_repuesto_de_mantenimiento`, `terminar_mantenimiento_preventivo`.
- `vista_historia_maquina` (security_invoker): producción (tejido y remallado), fallas, reparaciones, repuestos usados (fallas y preventivos) y preventivos, una fila por evento.
- Permisos exactos: planes con leer/crear/cambiar/borrar; mantenimientos y sus repuestos solo lectura (se escriben por sus funciones); vista solo lectura. Nada para anon.

## Aplicación
- `lib/domain/mantenimiento.ts`: próxima fecha, estado (al día / próximo ≤ 3 días / vencido / inactivo), agrupación de la historia por semana, totales, filas para PDF y Excel.
- `gastoMantenimiento` suma también la mano de obra de los preventivos terminados (Panel, Balance, Egresos, Materia Prima).
- Mantenimiento: pestaña Preventivo (planes, avisos, iniciar con mecánico, repuestos, terminar).
- Máquinas: aviso de preventivo vencido o próximo y enlace a la historia.
- Historia clínica: `app/dashboard/maquinas/[id]/historia` con período, día/semana, PDF y Excel.
- Mock: tablas, funciones y la vista de historia.

## Tareas
| # | Tarea | Riesgo | Hecho cuando |
|---|---|---|---|
| T0 | Pendientes Fase 3 / 030 (redondeo del mock, tests) | 1 | tests verdes |
| T1 | Test SQL 031 (rojo) + migración 031 + reversión | 2 | `probar_migraciones.sh` verde + "PASA reversión 031" |
| T2 | `lib/domain/mantenimiento.ts` + tests | 1 | `npm test` |
| T3 | Mock: tablas, funciones, vista + tests | 1 | `npm test` |
| T4 | Pestaña Preventivo | 2 | Playwright |
| T5 | Avisos en Máquinas y Mantenimiento | 1 | Playwright |
| T6 | Historia clínica + PDF/Excel | 1 | Playwright descarga ambos |
| T7 | Gasto de mantenimiento con preventivos | 2 (money) | tests |
| T8 | Cierre: pruebas completas, panel de 3, PR | 2 | DoD |
| T9 | Tras fusionar: 031 en base real + permisos exactos + advisors | 2 | SQL |
