# Harness decisions

- Accepted plan `9f8df631f4ade1ab8b8eeac5d4df3b92072817fb42c8cb2e469773cd1df35621`.
- Project kind: software.
- SDD: selected.
- 2026-11-25: Constitución v1.0.0 ratificada por el dueño (`02-DOCS/wiki/sdd/constitution.md`). Opciones de autoría: A quitar `Co-Authored-By` (por defecto del harness) / B mantenerlo; elegida B, para dejar registro de lo hecho con IA.
- 2026-11-25: Rutas sensibles (login/permisos, caja/cobros/pagos) siempre nivel 2. Opciones: excepción en `.gitignore` para `.rsc/sello-config.json` / `.rsc-risk.json` versionado. Elegido `.rsc-risk.json`: es la política compartida que `rsc risk` lee desde `main`, y `.rsc/` es estado local de cada máquina.
