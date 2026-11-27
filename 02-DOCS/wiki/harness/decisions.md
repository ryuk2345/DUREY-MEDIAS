# Harness decisions

- Accepted plan `9f8df631f4ade1ab8b8eeac5d4df3b92072817fb42c8cb2e469773cd1df35621`.
- Project kind: software.
- SDD: selected.
- 2026-11-25: Constitución v1.0.0 ratificada por el dueño (`02-DOCS/wiki/sdd/constitution.md`). Opciones de autoría: A quitar `Co-Authored-By` (por defecto del harness) / B mantenerlo; elegida B, para dejar registro de lo hecho con IA.
- 2026-11-25: Rutas sensibles (login/permisos, caja/cobros/pagos) siempre nivel 2. Opciones: excepción en `.gitignore` para `.rsc/sello-config.json` / `.rsc-risk.json` versionado. Elegido `.rsc-risk.json`: es la política compartida que `rsc risk` lee desde `main`, y `.rsc/` es estado local de cada máquina.
- 2026-11-25: Fase 3 (repuestos): gasto al comprar (opción A) en lugar de al usar. Opciones: A al comprar / B al usar. Elegida A por el dueño: «cuando lo uso no descontará porque ya lo compré».
- 2026-11-26: Migración 030 para dejar exactos los permisos de las tablas de la 029. Causa: permisos por defecto de Supabase para `authenticated`. Desde entonces cada migración revoca todo y da permisos uno a uno, y la verificación en la base real incluye MAINTAIN.
- 2026-11-26: Fase 4: mantenimiento preventivo cada N días por máquina, la máquina pasa a «mantenimiento», historia por día y semana con PDF y Excel. Opciones de frecuencia: A cada N días / B por horas de uso / C calendario fijo; elegida A por el dueño.
- 2026-11-26: Fase 5 por partes: 5A (tejido 24/6, Preparado, stock de fuera; migración 032) y 5B (crudo, volteado, tintorería, roles; migración 033). Desde la 033 las funciones de producción exigen el módulo del rol (`exigir_modulo` y tabla `modulos_por_rol`, igual a `MODULOS_POR_ROL`; cambiar uno exige migración).
- 2026-11-27: Fase 6A: un SKU por saco (decisión del dueño «solo un sku») para que despacho y stock cuadren; almacén elige sacos completos (C1-A). Opciones de reparto: A almacén elige / B el sistema elige los más antiguos; elegida A.
- 2026-11-27: Fase 6B: búsqueda RUC/DNI con Decolecta desde el servidor; el token solo en `DECOLECTA_TOKEN`. Opciones: A construir ya con «no configurada» / B esperar el token; elegida A. Sin tope de consultas (1-A).
- 2026-11-27: Ventas: stock para vender = sacos menos lo vendido sin despachar (opción A) frente a solo lo físico (B); elegida A para no vender dos veces lo mismo. Sin crudos (2-A). Migración 035 con cerrojo en `registrar_venta`.
- 2026-11-27: Un cambio de nivel 2 hecho por FTD necesita igualmente una spec aprobada para subir (control de subida de rsc). Se escribe con las decisiones del dueño ya tomadas.
