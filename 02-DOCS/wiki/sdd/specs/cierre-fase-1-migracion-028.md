---
type: spec
title: Spec — Migración 028, search_path fijo y vista de stock con permisos de quien consulta
description: WHAT y WHY de la 028 — resolver los avisos de seguridad antiguos de Supabase (vista SECURITY DEFINER y funciones sin search_path) sin cambiar lo que ve la web.
tags: [sdd, spec, seguridad, migracion]
timestamp: 2026-11-25T22:10:00Z
topic: sdd
slug: cierre-fase-1-migracion-028
branch: chore/cierre-fase-1-migracion-028
status: approved
---

# Spec — Migración 028, search_path fijo y vista con permisos de quien consulta

> Slug: `cierre-fase-1-migracion-028` · Status: approved · Created: 2026-11-25
> Inherits: [constitution](../constitution.md) y AGENTS.md
> Promovida desde el documento FTD [cierre-fase-1-migracion-028](../../ftd/cierre-fase-1-migracion-028.md) porque `rsc risk` la clasificó como nivel 2 (migración).

## Problem & why
Tras aplicar la 026 y la 027 en la base real, los advisors de seguridad de Supabase siguen marcando dos avisos antiguos:
- `vista_stock_medias` es SECURITY DEFINER (nivel ERROR): consulta con los permisos de su dueño y se salta el RLS de `paquetes`. Si mañana `paquetes` tiene una política más estricta, la vista la ignoraría.
- 5 funciones sin `search_path` fijo (`_siguiente_codigo`, `finalizar_lote_remallado`, `asignar_diseno_a_maquinas`, `actualizar_estado_muestra_diseno`, `registrar_diseno_con_asignaciones`). Cuatro son SECURITY DEFINER: con un search_path variable, una tabla o función con el mismo nombre en otro esquema podría suplantar a la real.

## Cost of not building it
Hoy el riesgo es bajo (solo usuarios con sesión llegan a la vista y a las funciones), pero el aviso ERROR queda permanentemente en el panel y tapa avisos nuevos; y el día que se restrinja `paquetes` por rol, la vista filtraría datos.

## The cheapest alternative
Ignorar los avisos. No basta: el dueño pidió resolverlos, y la corrección es pequeña y reversible.

## Goals
- El advisor deja de marcar la vista y las 5 funciones.
- La web ve exactamente el mismo stock y las funciones hacen lo mismo.

## Non-goals / out of scope
- El aviso "authenticated puede ejecutar funciones SECURITY DEFINER": es lo previsto (la web llama a esas funciones por RPC).
- La protección de contraseñas filtradas de Supabase Auth (DUREY usa su propio login).
- Cambiar permisos o datos.

## Users & context
Nadie nota el cambio: es de seguridad interna. Lo ve el dueño en el panel de advisors.

## What the user can do
Lo mismo que antes: ver el stock (StockNotification, Despacho, Ventas), registrar diseños y asignarlos, aprobar muestras, finalizar lotes de remallado, registrar ventas y guías (usan `_siguiente_codigo`).
Quién: usuarios con sesión. Nadie sin sesión (la 026 sigue igual).

## What result they get
- Mismo stock en la vista con sesión que el que calcula su dueño.
- Las funciones devuelven y escriben lo mismo que antes.

## What it must respect
- AGENTS.md: migración nueva numerada dentro de BEGIN/COMMIT; no modifica migraciones anteriores; no da nada a anon.
- No cambia tipos TS, mock ni datos.
- Reversión disponible: `supabase/scripts/revertir_028.sql`.
- Reglas del dueño para la base real: aplicar solo tras PR con pruebas en verde y fusionado; el archivo tal cual; verificar con SQL y advisors; pruebas solo en local.

## How it proves it
- `supabase/tests/028_search_path_y_vista_invoker.test.sql` en Postgres local (`supabase/tests/local/probar_migraciones.sh`): falla sin la 028 y pasa con ella; los tests SQL 021–027 siguen pasando.
- `npm test`, `npm run build`, `npm run test:browser` en verde.
- Tras aplicar en la base real: consultas SQL y advisors sin esos dos avisos.

## Behaviour
- Main path: la vista consulta como quien pregunta; las funciones usan `search_path = public, pg_temp`.
- Edge cases: funciones SECURITY DEFINER que lean la vista siguen leyendo como dueño; funciones con search_path ya fijado no se tocan.
- Error paths: si algo deja de funcionar, se ejecuta la reversión.

## Acceptance criteria
- Given la 028 aplicada, Then `vista_stock_medias` tiene `security_invoker=true` y ninguna función propia de public queda sin search_path.
- Given paquetes almacenados y pendientes de un producto, When un usuario con sesión consulta la vista, Then obtiene el mismo stock que el dueño (sin contar los entregados).
- Given un usuario sin sesión, When consulta la vista, Then recibe "permission denied".
- Given la 028 aplicada, When un usuario con sesión registra un diseño, lo reasigna, aprueba la muestra y finaliza un lote de remallado, Then cada paso funciona como antes.
- Given la reversión ejecutada, Then la vista y las funciones quedan como antes y la 028 se puede volver a aplicar.

## Points to clarify
- **suposición tomada** — `search_path = public, pg_temp` (y no vacío). *Base:* las funciones usan nombres sin esquema; vacío obligaría a reescribirlas. pg_temp al final evita que una tabla temporal suplante a una real. *Riesgo:* bajo; ninguna usa el esquema `extensions` (comprobado en la base real).

## Approval
Aprobada por el dueño del proyecto el 2026-11-25: «Haz los dos pendientes en una sola rama nueva y fusiónala tú (documento de la Fase 1 y la migración 028 de search_path y la vista, con sus pruebas y verificación en la base real después de fusionar).»
