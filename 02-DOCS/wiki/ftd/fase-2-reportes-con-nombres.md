---
author: ryuk2345
branch: fase-2/reportes-con-nombres
status: in-progress
---
# Fase 2 — Reportes con nombres

## Intent
Que cada reporte de producción diga quién hizo el trabajo, no solo cuánto. Plan de fases: [plan-fases](../plan-fases.md).

## Scope
Dentro:
- Tejido / Producción: turno (día/noche), encargado (tejedor del turno) y operarios (Calendario de Turnos, área tejido, misma fecha y turno).
- Remallado: remalladora y máquina.
- Planchado y Preparado: ya tenían planchador y preparador; la lógica pasa a `lib/domain/reportes.ts`.
- Mantenimiento: quién reportó la falla y el técnico que la reparó.
- Hoja/tabla "Resumen por persona" (Excel y PDF) en tejido, remallado, planchado y preparado.
- Corrección encontrada en el camino: `formatearFecha` mostraba un día menos en Lima para fechas sin hora (columnas DATE).

Fuera (decidido por el usuario 2026-11-25): operario por máquina y turno → Fase 5; reporte de Volteado → no (pregunta al cliente); quién despachó → Fase 6. Sin migración.

## Checklist
- [x] T1 `lib/domain/reportes.ts` con las filas de cada reporte y el resumen — prueba: tests/e2e/16 (15 tests), escritos antes del código (rojo sin el módulo).
- [x] T2 `formatearFecha`: fecha sin hora = ese día en Lima — prueba: test con TZ America/Lima (con el código anterior daba 19/11 para 2026-11-20, comprobado con node).
- [x] T3 Página de Reportes usa el dominio; consultas con encargado, operarios, remalladora, máquina, reportado por y técnico — prueba: Playwright descarga el Excel y lo lee.
- [x] T4 Mock: remalladora y máquina en `reportes_remallado`, técnico en `reparaciones` — prueba: Playwright en modo mock.
- [x] T5 Controles: npm test, Playwright, build, tsc, lint de los archivos tocados.
- [ ] T6 `rsc risk`, revisión, PR y fusión.

## Evidence
- Base real (solo lectura, 2026-11-25): una sola clave foránea a `usuarios` en `reportes_remallado`, `turnos_produccion`, `averias_maquinas`, `reparaciones` y `asignaciones_turno`; las relaciones de PostgREST no son ambiguas.
- `npm test`: 17 archivos / 199 tests en verde (15 nuevos en tests/e2e/16).
- `npm run test:browser`: 41/41 (3 nuevos en tests/browser/reportes-con-nombres.spec.ts: Excel de tejido con turno, encargado, operarios y resumen; Excel de remallado con remalladora y máquina; PDF de tejido sin errores; zona horaria Lima, fecha 05/01/2026).
- `npm run build`: compila. `npx tsc --noEmit`: sin errores. ESLint en los archivos tocados: 0 errores (corregido un `prefer-const` previo en la página).
- Regla 2 de AGENTS.md: sin cambios de modelo de datos. Regla 3: la lógica de las filas vive en `lib/domain/reportes.ts`; la fecha, en `formatearFecha`.

## Next
`rsc risk`, revisión, PR y fusión. Después: Fase 3 (Repuestos y mecánicos, ASDD; antes ratificar la constitución).
