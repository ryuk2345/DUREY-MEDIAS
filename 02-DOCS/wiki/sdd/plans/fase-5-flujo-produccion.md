---
type: plan
title: Plan — Fase 5A, tejido 24/6, preparado con la lógica de planchado y stock de fuera
tags: [sdd, plan, fase-5]
timestamp: 2026-11-26T22:00:00Z
topic: sdd
slug: fase-5-flujo-produccion
spec: ../specs/fase-5-flujo-produccion.md
---

# Plan — Fase 5A (migración 032)

> Spec: [fase-5-flujo-produccion](../specs/fase-5-flujo-produccion.md) (aprobada 2026-11-26). La parte 5B (crudo, volteado, tintorería; migración 033) tendrá su propio plan.

## Lo que hay hoy (leído del código y de la base real, 2026-11-26)
- Tejido: `cargar_lote_produccion` abre un turno con tejedor y máquinas (cada una con su SKU), descuenta el hilo de 15 docenas por máquina y deja las máquinas en `ocupada`; `cerrar_turno_produccion` registra las docenas en `reportes_produccion` y las libera. Los operarios se toman del Calendario de Turnos (regla provisional de la Fase 2).
- Planchado: cronograma semanal por persona y día (`cronograma_planchado`, criterio talla/público/media); `registrar_produccion_planchado` descuenta de `stock_listo_planchar`. Lo planchado no se guarda en ningún stock.
- Preparado: muestra `stock_listo_planchar` (el stock de planchado, no el suyo) y crea sacos en `paquetes` sin descontar nada.
- Base real: 5 turnos (0 abiertos), 5 reportes de tejido, 0 de planchado, 6 paquetes, 53 tejedoras, 220 productos.

## Diseño

### 1. Producto fijo por máquina (tejido 24/6)
- Tabla `productos_maquina`: máquina, producto, desde, hasta (vacío = vigente), quién lo asignó. Un solo producto vigente por máquina (índice único parcial). Así queda el historial de cambios.
- Función `asignar_producto_maquina(máquina, producto)`: cierra el vigente y abre el nuevo, atómico. Solo tejedoras.
- Pantalla Tejido: cada máquina con su producto vigente; botón "Cambiar producto" para los roles que decida el dueño (pregunta P1).

### 2. Registro de producción por turno
- Función `registrar_produccion_tejido(fecha, turno día/noche, encargado, [{máquina, docenas, operario}])`:
  - Usa un turno por fecha y horario (`turnos_produccion` con marca `registro_24_6`, único por fecha y horario) con su encargado.
  - Inserta en `reportes_produccion` una fila por máquina con el producto vigente y el **operario** (columna nueva `operario_id`). Una máquina no se registra dos veces en el mismo turno (índice único).
  - Descuenta el hilo por las docenas reales: docenas × peso por docena del producto (decisión C3-A), con su movimiento de materia prima. Si no alcanza el hilo, rechaza todo.
  - Rechaza máquinas sin producto vigente, en falla (`malograda`) o en `mantenimiento`, y docenas negativas.
  - No cambia el estado de las máquinas (ya no se "ocupan" por turno).
- Pantalla Tejido: formulario del turno (fecha, día/noche, encargado) con una fila por máquina (producto vigente, docenas, operario). Se quitan "Carga de lote" y "Copiar asignación del día anterior" (ya no hacen falta). Las funciones viejas quedan en la base sin uso (borrarlas sería un DROP; no hace falta).
- Reportes (Fase 2): la columna Operarios usa el operario de cada fila; los turnos viejos siguen con la regla anterior.
- Historia clínica (Fase 4): sin cambios, ya lee `reportes_produccion`.

### 3. Preparado con la lógica de planchado
- Tabla `stock_listo_preparar` (por producto). `registrar_produccion_planchado` pasa a sumar lo planchado (sin defectuosas) a este stock (CREATE OR REPLACE, misma firma).
- Función `registrar_produccion_preparado([{preparador, producto, docenas preparadas, defectuosas}], ubicación)`: descuenta de `stock_listo_preparar`, guarda `reportes_preparado` y crea el saco en `paquetes` (`pendiente_almacenar`), todo atómico. El saco sigue llevando su QR e impresión.
- Pantalla Preparado: igual que Planchado (cronograma semanal, planilla diaria por persona con sus SKU asignados), sin las tarjetas de resumen. Muestra su propio stock, no el de planchado.
- Reportes: Preparado lee `reportes_preparado` (y los paquetes viejos siguen visibles).

### 4. Varios SKU por persona y día
- Planchado y Preparado: al asignar, se pueden elegir varios SKU a la vez (una fila del cronograma por SKU). La planilla diaria muestra todos los SKU de la persona ese día.

### 5. Stock de fuera (planchado y preparado en 5A)
- Tabla `ingresos_stock_fuera`: etapa, producto, docenas, origen (texto obligatorio, por ejemplo "producción antes del sistema" o el proveedor), quién y cuándo.
- Función `ingresar_stock_fuera(etapa, producto, docenas, origen)`: suma al stock de esa etapa. En 5A: `planchado` (por planchar) y `preparado` (por preparar). Remallado, volteado y tintorería llegan con 5B.
- Botón "Ingresar stock de fuera" en Planchado y Preparado; los ingresos se listan aparte.

## Permisos y base
- Migración 032 con BEGIN/COMMIT, RLS y política `durey_usuarios_con_sesion` en las tablas nuevas, permisos exactos (lectura para `authenticated`; escritura solo por las funciones), nada para `anon`, `search_path` fijo. Test SQL y `revertir_032.sql` probados en local.
- Mock (`mockDb.ts`, `mockRpc*.ts`) con las funciones nuevas, igual que en SQL.

## Pruebas
- SQL: asignar y cambiar producto; registrar turno (operario, hilo por docenas reales, rechazo de doble registro, máquina malograda o sin producto, hilo insuficiente); planchado suma a por preparar; preparado descuenta y crea el saco; stock de fuera.
- `npm test`: test E2E 01 (registro de producción) reescrito al modelo nuevo; reglas en `lib/domain`.
- Playwright: cambiar el producto de una máquina, registrar un turno con operario, planchar, preparar un saco, ingresar stock de fuera.

## Tareas
| # | Tarea | Nivel | Comprobación |
|---|---|---|---|
| T1 | Migración 032 + test SQL + reversión | 2 | `probar_migraciones.sh` PASA 032 y su reversión |
| T2 | Dominio y mock (producto vigente, registro de turno, preparado, stock de fuera) | 1 | `npm test` |
| T3 | Pantalla Tejido nueva | 1 | Playwright tejido |
| T4 | Planchado: varios SKU y stock de fuera | 1 | Playwright planchado |
| T5 | Preparado con la lógica de planchado | 2 | Playwright preparado |
| T6 | Reportes con el operario por máquina | 1 | `npm test` reportes |
| T7 | Panel de revisión, PR, fusión, 032 en la base real y verificación | 2 | permisos exactos y advisors |

## Preguntas del plan
- **P1.** ¿Quién puede cambiar el producto de una máquina? Recomendado: administrador y supervisor.
- **P2.** ¿Se puede corregir un turno ya registrado (por ejemplo, docenas mal escritas)? Recomendado: sí, el mismo día, por administrador o supervisor; la corrección ajusta el hilo.

## Decisiones del plan (dueño, 2026-11-26)
- P1-A: cambian el producto de una máquina el administrador y el supervisor.
- P2-A: un turno se corrige el mismo día, por administrador o supervisor; el hilo se ajusta por la diferencia.

## Evidencia (2026-11-26)
| # | Estado | Prueba observada |
|---|---|---|
| T1 | hecha (458e515) | `probar_migraciones.sh`: PASA 032 y "PASA reversión 032" |
| T2 | hecha (6c074db) | `tests/e2e/19-tejido-24-6-preparado.test.ts` 15/15 |
| T3 | hecha (0872974) | Playwright "Tejido 24/6: … asignar producto y registrar el turno con operario; corregir" |
| T4 | hecha (363c74e) | Playwright "Planchado: stock de fuera…" y "asignar dos SKU de una vez" |
| T5 | hecha (363c74e) | Playwright "Planchado → por preparar → Preparado crea el saco y descuenta" |
| T6 | hecha (0872974) | `tests/e2e/16` operario por máquina (17/17) |
| T7 | en curso | panel de 3 revisores; luego PR, fusión, 032 en la base real |

Batería en la rama: `npm test` 257/257 · Playwright 50/50 · build y `tsc` en verde · ESLint sin errores nuevos.
Se quitó "Copiar asignación del día anterior" (con producto fijo ya no hace falta) y su prueba de navegador; su función de dominio y su test unitario quedan.
