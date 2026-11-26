---
type: constitution
title: DUREY-MEDIAS — Constitución
description: Las reglas fijas que toda fase (FTD o ASDD) debe cumplir. Ratifica AGENTS.md y las reglas del dueño para la base real.
tags: [sdd, constitution]
timestamp: 2026-11-25T23:30:00Z
topic: sdd
version: v1.0.0
---

# DUREY-MEDIAS — Constitución

> Versión: v1.0.0 · Ratificada: 2026-11-25 · Última enmienda: 2026-11-25
> Las reglas que, si se rompen, hacen que el trabajo esté mal aunque funcione.
> El detalle práctico vive en `AGENTS.md`; aquí se ratifica cada regla y se dice cómo se comprueba.

## 1. Stack (lo fijo)

1. La app es Next.js (App Router) + React + TypeScript sobre Supabase (Postgres). Cambiar de framework o de base es un cambio MAYOR de esta constitución. Antes de usar una API de Next.js se lee su guía en `node_modules/next/dist/docs/` (esta versión difiere de lo conocido).
2. Gestor de paquetes: npm, con `package-lock.json` versionado.

## 2. Calidad

3. Busca antes de crear: antes de una función, hook o componente nuevo se busca uno equivalente (AGENTS.md, Regla 1). Si algo se repite en 3 o más sitios, se extrae a `lib/domain/` o `lib/utils/`.
4. Una sola fuente de verdad: la lógica de negocio vive en un solo lugar (`lib/domain/*`, `lib/utils/index.ts`, funciones RPC atómicas o vistas SQL como `vista_stock_medias`) y no se reimplementa en pantallas (AGENTS.md, Regla 3).
5. Los datos del negocio se guardan solo en la base. Nunca en `localStorage` (salvo el modo mock local). Se comprueba en revisión (`REVIEW.md`).
6. Toda operación que toca varias tablas a la vez (stock, caja, cuotas, estados) es una función RPC atómica en la base, no varias llamadas desde la pantalla. Se comprueba en revisión y con el test SQL de la función.
7. Pruebas antes o junto al código (TDD): la regla nueva tiene un test que falla sin ella. Lógica de dominio → test en `tests/e2e/`; pantalla → Playwright en `tests/browser/`; migración → test SQL en `supabase/tests/`.
8. TypeScript compila sin errores (`npx tsc --noEmit`) y ESLint no da errores nuevos en los archivos tocados.

## 3. Modelo de datos y base real

9. Todo cambio de modelo sigue el checklist de AGENTS.md, Regla 2: migración nueva numerada (nunca editar una anterior), dentro de `BEGIN; … COMMIT;`, datos migrados antes que las restricciones, tipos TS, `lib/domain`, mock y tests actualizados en el mismo PR.
10. Permisos: `GRANT` solo a `authenticated` y `service_role`, nunca a `anon`. Toda tabla nueva nace con RLS y la política `durey_usuarios_con_sesion`. Toda función nueva fija su `search_path`. Comprobado por el test SQL de la migración y por los advisors de seguridad.
11. Cada migración trae su test SQL y, si cambia permisos o estructura existente, su script de reversión en `supabase/scripts/revertir_NNN.sql`. Ambos pasan en la base local: `supabase/tests/local/probar_migraciones.sh <base_nueva>`.
12. La base real (producción) nunca se usa para pruebas. Una migración se aplica en ella solo después de que su PR esté fusionado con todo en verde, con el archivo exacto, y se verifica después con SQL y advisors. Cualquier SQL que borre o cambie datos existentes (DELETE, DROP, TRUNCATE, UPDATE masivo) necesita confirmación escrita del dueño.

## 4. Ramas y entrega

13. Todo cambio va en una rama y entra a `main` por PR. Nada se sube directo a `main`.
14. Cada fase es una rama y un PR. Antes de cada fase se muestra el plan y se espera el OK del dueño. Las reglas del negocio no claras se preguntan; no se inventan.
15. Autoría en git: los commits y PR van a nombre del dueño (el usuario de git configurado). Cuando un agente de IA participó, el commit y el PR llevan la línea `Co-Authored-By: Claude <noreply@anthropic.com>`, para que quede registro de qué se hizo con ayuda de IA. (Decisión del dueño 2026-11-25: se aparta de la regla por defecto del harness, que la quita.)
16. Los cambios en rutas sensibles (login, sesión y permisos; caja, cobros y pagos) siempre son nivel 2 en `rsc risk`: especificación aprobada y panel de 3 revisores. La lista vive en `.rsc-risk.json` (versionado en la raíz) y se repite en `REVIEW.md`.

## 5. Seguridad

17. Ningún secreto se versiona (claves de Supabase, SUNAT, correo): van en variables de entorno, nunca en el código.
18. Sin sesión no se ve ni se toca nada: la base está cerrada a `anon` (migración 026) y toda API de servidor exige sesión (`requerirSesion`). Excepciones a la vista: `app/api/auth/login` y `app/api/auth/logout` (no pueden pedir sesión) y `app/api/mock-db` (solo modo local; responde 404 si hay Supabase real). Toda excepción nueva se anota aquí. Los roles y módulos salen solo de `MODULOS_POR_ROL`.

## 6. Pantallas

19. Los textos al usuario van en español (se comprueba en revisión). Una pantalla nunca muestra datos inventados: si no hay datos, lo dice (test `tests/browser/todos-los-modulos.spec.ts`).
20. Las fechas se muestran con `formatearFecha` (día correcto en Lima) y los montos con `formatearMoneda`. Se comprueba en revisión; `formatearFecha` tiene su test en `tests/e2e/16-reportes-con-nombres.test.ts`.

## 7. Rendimiento

Sin presupuesto formal por ahora (planta pequeña). Se añadirá si aparece un problema medido.

## 8. Conocimiento y decisiones

21. Cada decisión importante del dueño se anota con fecha y motivo en `02-DOCS/wiki/plan-fases.md` (decisiones por fase) o en `02-DOCS/wiki/harness/decisions.md`. Esta constitución es la decisión de más alto nivel.
22. Cada fase tiene su documento (FTD en `02-DOCS/wiki/ftd/` o spec en `02-DOCS/wiki/sdd/specs/`) con la evidencia de cada tarea marcada.

## Definición de Hecho (lo que se comprueba antes de fusionar)

Un cambio se fusiona solo si se cumple todo:

- [ ] `npm test` en verde (principio 7).
- [ ] `npm run test:browser` (Playwright) en verde (principio 7).
- [ ] `npm run build` compila; `npx tsc --noEmit` sin errores; `npx eslint <archivos tocados>` sin errores nuevos frente a `main` (principio 8).
- [ ] Si hay migración: test SQL y reversión pasan en la base local (principio 11); checklist de la Regla 2 completo (principio 9).
- [ ] Revisión según `rsc risk`: nivel 1, un revisor; nivel 2, especificación aprobada y panel de 3 revisores. Hallazgos corregidos o anotados (`REVIEW.md`).
- [ ] En una rama, fusionado por PR (principio 13).
- [ ] Documento de la fase con la evidencia (principio 22).
- [ ] Después de fusionar, si hay migración: aplicada en la base real y verificada (principio 12).

## Registro de cambios (solo se añade)

| Fecha | Versión | Cambio | Por qué |
|------|---------|--------|---------|
| 2026-11-26 | borrador | Borrador generado por `rsc onboard`. | La cadena SDD necesita una constitución. |
| 2026-11-25 | borrador | Propuesta completa desde AGENTS.md y las reglas del dueño para la base real. | Ratificar antes de la Fase 3 (ASDD). |
| 2026-11-25 | v1.0.0 | Ratificada por el dueño: «Ratificada, 1B, 2 sí». Principio 15 = se mantiene `Co-Authored-By: Claude`; 16 = rutas sensibles siempre nivel 2 vía `.rsc-risk.json`. Panel de 3 revisores: ampliada la lista de rutas sensibles y precisadas las excepciones del principio 18. | Base de las fases 3 a 6 (ASDD). |
