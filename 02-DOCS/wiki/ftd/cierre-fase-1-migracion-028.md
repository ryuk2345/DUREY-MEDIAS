---
author: ryuk2345
branch: chore/cierre-fase-1-migracion-028
status: in-progress
spec: ../sdd/specs/cierre-fase-1-migracion-028.md
---
# Cierre de Fase 1 y migración 028 (avisos de seguridad)

## Intent
Cerrar la documentación de la Fase 1 con lo aplicado en la base real (026 y 027), y resolver los avisos antiguos de los advisors de Supabase: la vista `vista_stock_medias` SECURITY DEFINER y 5 funciones sin `search_path` fijo.

## Scope
Dentro:
- `02-DOCS/wiki/ftd/fase-1-correcciones-botones.md`: estado final y evidencia de la aplicación en la base real.
- Migración `028_search_path_y_vista_invoker.sql`: vista con `security_invoker`; `search_path = public, pg_temp` en las funciones propias que no lo tienen.
- Test SQL `supabase/tests/028_*.test.sql` y reversión `supabase/scripts/revertir_028.sql`.
- Base local de prueba versionada: `supabase/tests/local/` (simulación de Supabase + script que aplica 002..último y corre los tests SQL).

Fuera: el aviso "authenticated puede ejecutar funciones SECURITY DEFINER" (es lo previsto: la web las llama por RPC) y la protección de contraseñas filtradas de Supabase Auth (DUREY usa su propio login).

## Checklist
- [x] T1 Documento de Fase 1 actualizado — prueba: diff del documento.
- [x] T2 Test SQL de la 028 escrito antes de la migración — prueba: falla sin la 028 ("vista_stock_medias con security_invoker").
- [x] T3 Migración 028 — prueba: test 028 pasa en Postgres local; ejecuta las 4 funciones afectadas como `authenticated` y compara el stock de la vista con el del dueño.
- [x] T4 Reversión — prueba: `probar_migraciones.sh` ejecuta `revertir_028.sql`, comprueba que el test de la 028 falla, reaplica la 028 y el test vuelve a pasar.
- [x] T5 Controles: npm test, Playwright, build, `rsc risk` (nivel 2: spec + panel de 3 revisores).
- [ ] T6 Tras fusionar: aplicar la 028 en la base real, verificar con SQL y advisors.

## Evidence
- Base real (lectura, 2026-11-25): las 5 funciones sin search_path no usan nada del esquema `extensions`; la vista solo lee `paquetes`.
- Postgres 16 local: migraciones 002–028 aplicadas; tests SQL 021, 022, 023, 024, 026, 027 y 028 pasan (`supabase/tests/local/probar_migraciones.sh`).
- En local la 028 fija el search_path en 5 funciones: las mismas 5 que señala el advisor en la base real.
- `npm test` 184/184; `npm run build` compila; `npm run test:browser` 38/38 (sobre 7d08b4f).
- `rsc risk`: nivel 2 (migración) -> spec [cierre-fase-1-migracion-028](../sdd/specs/cierre-fase-1-migracion-028.md), `rsc spec gate` 3/3.
- Panel de 3 revisores sobre 7d08b4f (correctitud, seguridad, tests): 0 bloqueos. Corregido: el test exige `public, pg_temp` exacto en las 5 funciones (mataba un mutante `pg_temp, public` que sobrevivía); la reversión ahora se prueba en el script local; el script solo apunta a 127.0.0.1 y distingue salida 2 (no montó la base) de 1 (tests). Descartado con evidencia: en la base real `authenticated` no puede crear objetos en `public` (`has_schema_privilege` = false), así que `public, pg_temp` basta. Registrado en el ledger.
- Tras correcciones: `probar_migraciones.sh` 7 tests SQL en verde + "PASA reversión 028".
- Regla 2 de AGENTS.md: no cambian tipos TS, mock ni datos (la vista devuelve lo mismo).

## Next
PR, fusión y aplicación en la base real (T6).
