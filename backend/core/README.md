# core

Código compartido en Python. Hoy es un solo módulo: `clasificacion.py`.

## clasificacion.py

Clasifica un proceso del SEACE por tipo y etapa a partir de su release OCDS, y dice qué agentes le aplican.

- **Entrada:** un release OCDS, recortado como el `convocatorias.ocds_payload` de la base o el `compiledRelease`
  completo del OECE.
- **Salida:** `Clasificacion`: tipo (bienes, servicios, consultoría, obras, convenio, directa, otro), etapa, modalidad,
  si es procesable, los agentes que corren, las validaciones pendientes y el RUC del proveedor.
- La matriz completa está en `docs/design/MATRIZ_TIPO_ETAPA.md`.

Quién la usa:

- `vigia-scrapers` clasifica con un port a TypeScript (`backend/scrapers-worker/src/clasificacion.ts`) que da la misma
  salida; sus pruebas usan vectores generados con este módulo (`backend/scrapers-worker/scripts/vectores_py.py`). Lo
  que queda en la base es lo que el dispatcher le pasa a los agentes.
- Scripts de mantenimiento, como `backend/scripts/reclasificar_desfasadas.py`.
- La imagen de los agentes no lo incluye: sólo lleva `backend/agent`.

Para reclasificar las convocatorias de la base (columnas de la migración 13), con las variables `PG*` de la base:

```bash
python -m backend.core.clasificacion --reclasificar --dry-run      # muestra la distribución, no escribe
python -m backend.core.clasificacion --reclasificar [--lote 1000] [--solo-sin-clasificar]
```

## Probar

```bash
python -m pytest backend/core/tests -q      # contra releases reales guardados en tests/fixtures, sin red
```
