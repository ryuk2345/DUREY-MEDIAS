---
type: spec
title: Spec — Fase 7, sugerencias al escribir, editar productos sin tocar el SKU, gastos por pagos reales y escrituras de dinero por funciones
description: Búsquedas con sugerencias en todas las pantallas; edición del catálogo sin cambiar el SKU (la base lo exige); Egresos y Balance cuentan las compras a plazos cuando se pagan; caja diaria, clientes y egresos se escriben solo por funciones con módulo; una sola lista de permisos por rol.
tags: [sdd, spec, fase-7]
timestamp: 2026-11-27T22:00:00Z
topic: sdd
slug: fase-7-transversal
branch: fase-7/transversal
status: approved
---

# Spec — Fase 7, transversal

> Slug: `fase-7-transversal` · Status: approved · Created: 2026-11-27
> Inherits: [constitución v1.0.0](../constitution.md) y AGENTS.md. Plan: [plan-fases](../../plan-fases.md).

## Problem & why
- Las búsquedas filtran una lista, pero no sugieren mientras se escribe; en algunas pantallas hay que recorrer la lista entera.
- Al editar un producto del catálogo se puede cambiar (y hasta regenerar) su SKU, que está impreso en los sacos y en las ventas.
- Egresos y Balance cuentan cada compra recibida por su costo total el día que se recibe, aunque se pague en cuotas; los ingresos sí se cuentan por cobro real. El balance no compara lo mismo.
- `cajas_diarias`, `clientes`, `egresos_adicionales` y `catalogo_medias` aún se escriben directo con sesión: cualquier rol puede cambiar dinero o el catálogo sin pasar por una regla.
- La lista de rutas por rol está repetida en `proxy.ts` y en `MODULOS_POR_ROL`.

## Cost of not building it
Un SKU cambiado deja sacos y ventas apuntando a un código que ya no existe en el catálogo; el balance muestra gastos que todavía no se pagaron; un usuario de producción podría cambiar la caja.

## The cheapest alternative
Solo ocultar botones en pantalla. No basta: la base seguiría aceptando la escritura por otra vía (misma lección que la 033 y la 034).

## Goals
- Sugerencias al escribir en todas las búsquedas de productos, clientes y máquinas (decisión 1-A).
- Editar nombre, color, talla y precios de un producto sin cambiar su SKU (decisión 2-A).
- Egresos y Balance por pagos reales.
- Dinero y catálogo solo por funciones con módulo.
- Una sola lista de permisos.

## Non-goals / out of scope
- Envío de correos (aplazado por el dueño, 2026-11-27; falta dominio propio).
- Borrado final de datos (solo con confirmación escrita).

## Users & context
Todos los roles en sus búsquedas; los roles con el módulo catálogo (hoy administrador, supervisor, diseñador y vendedora) en el catálogo; vendedoras y administrador en caja y egresos; el dueño en Balance.

## What the user can do
- Escribir en cualquier buscador de productos, clientes o máquinas y elegir de una lista corta de sugerencias.
- Editar un producto del catálogo; el SKU se ve pero no se cambia.
- Ver en Egresos y Balance lo realmente pagado en cada periodo.

## What result they get
- Productos con SKU fijo desde que se crean.
- Un balance que compara cobros reales con pagos reales.
- Caja, clientes, egresos y catálogo que solo cambian por sus funciones, con el rol correcto.

## What it must respect
- Constitución v1.0.0: migración nueva con el checklist de AGENTS.md; RLS y política de sesión; permisos exactos; nada para `anon`; funciones con `search_path` fijo y `exigir_modulo`; test SQL y reversión en local.
- `MODULOS_POR_ROL` sigue siendo la única fuente; la tabla `modulos_por_rol` igual a ella.
- Lo ya registrado no se borra ni se cambia.

## How it proves it
- Test SQL y reversión de la migración 036.
- `npm test`: reglas de sugerencias, gastos por pagos reales y permisos por rol; mock igual al SQL.
- Playwright: sugerencias en una búsqueda de cada tipo, editar un producto sin poder tocar el SKU, Balance con una compra a plazos.

## Behaviour
- Edge cases: búsqueda con tildes o mayúsculas; producto sin cambios; intento de cambiar el SKU por otra vía → rechazado; compra a plazos con cuotas pagadas y pendientes; compra devuelta en control de calidad.
- Error paths: mensajes de la base en pantalla, sin datos a medias.

## Acceptance criteria
- Given el buscador de productos de Ventas, When se escribe «tob niñ», Then aparecen como sugerencias los productos que coinciden, sin importar tildes.
- Given un producto con SKU `SKU-A`, When se edita su color, Then el SKU sigue siendo `SKU-A`; When se intenta cambiar el SKU por la API, Then la base lo rechaza.
- Given una compra a plazos de 300 en 3 cuotas con una pagada, When se mira Balance, Then cuenta 100 de materia prima, no 300.
- Given un usuario sin el módulo ventas (la caja diaria vive en Ventas), When intenta cambiar la caja diaria, Then la base lo rechaza.
- Given `MODULOS_POR_ROL`, When se cambia un rol, Then las rutas permitidas cambian sin tocar `proxy.ts`.

## Points to clarify
- **decidido (dueño, 2026-11-27)** — 1-A: sugerencias en todas las búsquedas de productos, clientes y máquinas.
- **decidido (dueño, 2026-11-27)** — 2-A: se edita todo menos el SKU.
- **decidido (dueño, 2026-11-27)** — El correo queda para después.
- **decidido (dueño, 2026-11-27)** — P1-A: una compra al contado cuenta el día de la compra si se recibió; las devueltas no cuentan; las cuotas cuentan cuando se pagan.
- **decidido (dueño, 2026-11-27)** — P2-A: el código interno queda fijo igual que el SKU.
- **decidido (dueño, 2026-11-27)** — P3-A: egresos adicionales solo por funciones con el módulo egresos.
- **supuesto** — La lista de sugerencias muestra hasta 8 coincidencias.
- **supuesto (al construir)** — P3-A alcanza también a `compras_materia_prima`, `cuotas_compras` y `pagos_proveedores`: son dinero, el cálculo de gastos lee de ellas, ninguna pantalla las escribe directo y ya tienen sus funciones (024 y 027).

## Construction
Migración 036 (SKU y código fijos, funciones de catálogo, caja, clientes y egresos con módulo; permisos), dominio y mock, pantallas, `proxy.ts` desde `MODULOS_POR_ROL`.

## Approval
Aprobada por el dueño el 2026-11-27 («1-a,2-a,3-a» a las preguntas abiertas).
