---
type: plan
title: Plan — Fase 5B, medias en crudo, Volteado, Tintorería y bloqueo por rol en la base
tags: [sdd, plan, fase-5]
timestamp: 2026-11-27T03:30:00Z
topic: sdd
slug: fase-5-flujo-produccion
spec: ../specs/fase-5-flujo-produccion.md
---

# Plan — Fase 5B (migración 033)

> Spec: [fase-5-flujo-produccion](../specs/fase-5-flujo-produccion.md) (aprobada 2026-11-26). Sigue a la 5A ([plan](fase-5-flujo-produccion.md), migración 032, PR #22).

## Decisiones del dueño (2026-11-26)
- La base bloquea los registros según el rol («sí, que lo bloquee»).
- Q1-A: la migración crea una media cruda por cada combinación de modelo, talla y público del catálogo; se pueden añadir más en Catálogo.
- Q2-A: rol nuevo "tintorero"; el módulo Tintorería lo ven también administrador, supervisor y operador.
- Q3-A: administrador y supervisor ven Volteado (respuesta «3-14-A», leída como 3-A y 4-A).
- Q4-A: el SKU de color se crea antes en Catálogo; Tintorería solo lo elige.
- Q5-A: el bloqueo por rol cubre ahora las funciones de producción; ventas, almacén y despacho en la Fase 6.

## Lo que hay hoy (base real, 2026-11-27)
- 220 productos en 37 combinaciones de modelo, talla y público; ninguno crudo; ninguno con hilo vinculado.
- Remallado termina en "por planchar" (migración 011). Volteado no recibe nada y escribe en sus tablas en pasos sueltos desde la pantalla. 0 lotes de volteado; 1 lote de remallado abierto.
- El rol "volteador" está en la app pero la base no lo permite desde la 029.
- `authenticated` puede escribir directo en las tablas de proceso (turnos, reportes, lotes, stocks): eso permitiría saltarse el bloqueo por rol.

## Diseño
1. **Roles y módulos en la base.** Tabla `modulos_por_rol (rol, modulo)` con lo mismo que `MODULOS_POR_ROL` (más volteado y tintorería); una prueba compara las dos. Función interna `exigir_modulo(modulo)`: sesión, usuario activo y su rol con ese módulo; si no, rechaza. Se permite el rol "volteador" y se añade "tintorero".
2. **Bloqueo en las funciones de producción.** Tejido (`registrar_produccion_tejido`: produccion), Remallado (iniciar, traspasar, finalizar: remallado), Volteado (nuevas: volteado), Tintorería (nuevas: tintoreria), Planchado (planchado), Preparado (preparado), Stock de fuera (el módulo de la etapa). Las funciones viejas de tejido (`cargar_lote_produccion`, `cerrar_turno_produccion`) dejan de poder llamarse con sesión (no se usan desde la 5A).
3. **Sin escritura directa** de `authenticated` en las tablas de proceso: turnos, máquinas del turno, reportes de tejido, remallado, volteado y planchado, lotes de remallado y volteado, stocks por voltear y por planchar. Solo lectura; se escriben por sus funciones.
4. **Crudo.** Columna `catalogo_medias.es_crudo`; la migración crea los 37 crudos (código `CRUDO-<modelo>-<público>-<talla>`, color "CRUDO"). Tejido y Remallado eligen productos crudos.
5. **Remallado → por voltear.** `finalizar_lote_remallado` deja lo remallado en `stock_listo_voltear` si el producto es crudo; un lote con color (de antes) sigue a "por planchar".
6. **Volteado atómico.** `iniciar_lote_volteado` (descuenta de por voltear) y `reportar_lote_volteado` (deja en "por teñir" si es crudo; si no, en por planchar).
7. **Tintorería.** Tabla `stock_listo_tenir` y `lotes_tintoreria` (crudo, SKU de color, material algodón/poliéster, docenas, remalladora, quién envió/recibió, recibidas, merma y motivo). `enviar_lote_tintoreria` (el SKU de color: mismo modelo, talla y público, no crudo) y `recibir_lote_tintoreria` (recibidas ≤ enviadas; merma > 0 exige motivo; lo recibido entra a por planchar con el SKU de color).
8. **Stock de fuera** también en Volteado (por voltear) y Tintorería (por teñir). En Remallado queda registrado como ingreso (Remallado se asigna a mano: decisión C2).
9. **Pantallas.** Volteado con las funciones nuevas; Tintorería nueva (enviar, en tintorería, recibir con merma); menú y `MODULOS_POR_ROL`; Catálogo marca crudo.

## Pruebas
- SQL: módulos por rol (permitido / rechazado / usuario de baja), escritura directa rechazada, crudos creados, remallado → por voltear, volteado, tintorería (SKU distinto de modelo rechazado, más de lo enviado, merma sin motivo), stock de fuera nuevo; las pruebas SQL anteriores con sesión de administrador.
- `npm test`: dominio de tintorería y crudo, mock, `modulos_por_rol` = `MODULOS_POR_ROL`.
- Playwright: remallar crudo → voltear → enviar a tintorería → recibir con merma → planchar.

## Tareas
| # | Tarea | Nivel | Comprobación |
|---|---|---|---|
| T1 | Migración 033 + test SQL + reversión | 2 | `probar_migraciones.sh` PASA 033 y su reversión |
| T2 | Dominio, roles y mock | 1 | `npm test` |
| T3 | Volteado y Remallado | 1 | Playwright |
| T4 | Tintorería | 2 | Playwright |
| T5 | Panel, PR, fusión, 033 en la base real | 2 | permisos y advisors |

## Evidencia (2026-11-27)
| # | Estado | Prueba observada |
|---|---|---|
| T1 | hecha (ab8e053) | `probar_migraciones.sh`: PASA 033 y "PASA reversión 033"; las pruebas 022, 028 y 032 corren con sesión |
| T2 | hecha (c782d68) | `tests/e2e/20-crudo-volteado-tintoreria.test.ts` (incluye `modulos_por_rol` = `MODULOS_POR_ROL`) |
| T3 | hecha | Playwright "Volteado: stock de fuera en crudo, voltear y queda por teñir"; Tejido 24/6 con media cruda |
| T4 | hecha | Playwright "Tintorería: enviar 8 en crudo, recibir 7 con merma y motivo" |
| T5 | en curso | panel de 3 revisores; luego PR, fusión, 033 en la base real |

Batería: `npm test` 267/267 · Playwright 54/54 · build y `tsc` en verde · ESLint sin errores nuevos (mockDb.ts baja de 118 a 113).

## Anotado
- `proxy.ts` tiene su propia lista de rutas por rol (duplica `MODULOS_POR_ROL`, y el supervisor tiene ahí Mantenimiento). Se añadieron solo las rutas nuevas; unificarlo queda para la Fase 7.
- `asignar_producto_maquina` no exige media cruda en la base (la pantalla solo ofrece crudas), para no romper lo ya asignado.
- Los cronogramas de Planchado y Preparado se siguen escribiendo directo (no mueven stock).
