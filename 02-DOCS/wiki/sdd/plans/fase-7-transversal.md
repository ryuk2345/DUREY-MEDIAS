---
type: plan
title: Plan — Fase 7, sugerencias, productos con SKU fijo, gastos por pagos reales y dinero por funciones
tags: [sdd, plan, fase-7]
timestamp: 2026-11-27T22:30:00Z
topic: sdd
slug: fase-7-transversal
spec: ../specs/fase-7-transversal.md
---

# Plan — Fase 7 (migración 036)

## Lo que hay hoy (base real, 2026-11-27)
- Catálogo: la pantalla escribe directo y al editar puede cambiar o regenerar SKU y código.
- Caja diaria: la pantalla abre y cierra con escritura directa; calcula la diferencia en el navegador y usa la fecha UTC.
- Clientes y egresos: escritura directa desde sus pantallas. `egresos_adicionales` no tiene `comprobante_url`, pero Egresos lo envía: registrar un gasto falla en la base real (encontrado al planear).
- Balance y Egresos suman `costo_total` de toda compra recibida; los pagos de cuotas están en `pagos_proveedores` (027).
- Las funciones que ya escriben esas tablas (`registrar_venta`, `_sumar_a_caja`, `registrar_compra_repuesto`, `registrar_pago_proveedor`, `crear_crudos_faltantes`) son SECURITY DEFINER: no las afecta quitar la escritura directa.

## Diseño
1. **SKU y código fijos.** Disparador en `catalogo_medias`: el código nunca cambia; el SKU solo puede ponerse si estaba vacío (crudos). Funciones `crear_producto`, `editar_producto`, `cambiar_estado_producto`, `eliminar_producto`, `crear_modelo_media` con el módulo catálogo.
2. **Caja.** `abrir_caja` y `cerrar_caja` (módulo ventas): fecha de Lima, una caja por vendedora y día, esperado y diferencia calculados en la base con la misma fórmula que `calcularEfectivoEsperadoCaja`.
3. **Clientes.** `guardar_cliente` y `eliminar_cliente` (módulo clientes); no se elimina un cliente con ventas.
4. **Egresos.** Columna `comprobante_url`; `registrar_egreso` (módulo egresos o materia prima) y `eliminar_egreso` (módulo egresos; no se elimina uno que viene de una compra de repuestos).
5. **Gastos por pagos reales.** Vista `vista_gastos_materia_prima`: compras al contado recibidas (por su fecha) más pagos a proveedores (por su fecha). Balance y Egresos la leen.
6. **Permisos.** Sin INSERT/UPDATE/DELETE con sesión en `cajas_diarias`, `clientes`, `egresos_adicionales`, `catalogo_medias`, `modelos_media`. Helper `exigir_algun_modulo` solo para funciones.
7. **Rutas.** `proxy.ts` toma las rutas de `MODULOS_POR_ROL`.
8. **Sugerencias.** Componente de búsqueda con sugerencias (hasta 8, sin tildes) en productos, clientes y máquinas.

## Tareas
| # | Tarea | Nivel | Comprobación |
|---|---|---|---|
| T1 | Migración 036 + test SQL + reversión | 2 | `probar_migraciones.sh` PASA 036 y su reversión |
| T2 | Dominio y mock (gastos, caja, catálogo, clientes, egresos) | 2 | `npm test` |
| T3 | Pantallas: Catálogo, Ventas (caja), Clientes, Egresos, Materia prima, Balance | 2 | Playwright |
| T4 | `proxy.ts` desde `MODULOS_POR_ROL` | 2 | `npm test` |
| T5 | Sugerencias al escribir | 1 | Playwright |
| T6 | Panel, PR, fusión, 036 en la base real | 2 | permisos y advisors |

## Evidencia (2026-11-27)
| # | Estado | Prueba observada |
|---|---|---|
| T1 | hecha (a58e4e1) | `probar_migraciones.sh`: PASA 036 y su reversión; 026 y 030 adaptadas |
| T2 | hecha (8780d75) | `tests/e2e/24-catalogo-caja-clientes-egresos.test.ts` (10) |
| T3 | hecha | Playwright `fase7-gestion.spec.ts`: catálogo con SKU y código fijos, egreso con comprobante, caja con vendedora y cierre con faltante |
| T4 | hecha | `tests/e2e/25-rutas-por-rol.test.ts`: rutas = módulos; el administrador ya abre Volteado y Tintorería |
| T5 | hecha | `tests/e2e/25` (sugerencias) y Playwright «Sugerencias al escribir» en Catálogo, Planchado, Clientes y Máquinas |
| T6 | en curso | panel ronda 1 (L120-L130): 7 corregidos (caja del día de Lima en las funciones de caja, caja por vendedora en pantalla, panel del administrador por pagos reales, comprobante solo http/https, pruebas que faltaban en SQL, mock y pantalla de Balance); 4 aparcados (L124 dueño de la caja, pregunta al dueño; L125 asimetría deliberada; L129 Ventas; L130 a investigar); ronda 2 (L131-L136): 5 corregidos (cobros con el día de Lima, caja que se mira aparte de la vendedora de la venta, prueba con dos cajas, prueba del día de Lima sin depender del reloj); L136 aparcado (comprobante de pagos a proveedores, fuera de esta fase) |

Batería: `npm test` 324/324 · Playwright 67/67 · build y `tsc` en verde · ESLint sin errores nuevos.

## Anotado
- Encontrado al planear: registrar un gasto en Egresos fallaba en la base real (faltaba `comprobante_url`). Lo arregla la 036.
- El bloqueo también alcanza `compras_materia_prima`, `cuotas_compras` y `pagos_proveedores` (supuesto en la spec).
- Decidido (dueño, 2026-11-28): 1-A, el supervisor tiene Mantenimiento (la 036 lo añade a `modulos_por_rol` y a `MODULOS_POR_ROL`); 2-B, cada vendedora solo su caja (abrir_caja y cerrar_caja lo exigen; la pantalla fija la caja de la vendedora).
- La caja ahora pide la vendedora al abrirla (cada caja es de una vendedora).
- Encontrado al corregir: Materia prima y Egresos proponían «hoy» en UTC; de noche la base (ahora en Lima) rechazaba el pago como futuro. Ahora usan el día de Lima. Otras pantallas (calendario, reportes, volteado, preparado, remallado, usuarios, planchado) aún usan UTC: revisar aparte.
