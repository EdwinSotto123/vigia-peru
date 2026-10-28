"""
Organización 2.0 (fase 1 del plan del 2026-10-27): genera backend/api/src/data/estado.json desde el libro del grafo del
Estado (dataset/CLAUDE-GENERADO/vigia_mapa_estado_peruano.xlsx, corte 2026-10-23). Lo usa la API para el organigrama de
cada entidad (backend/api/src/lib/organigrama.ts):

  - plantillas: la estructura mínima que fija la ley para cada tipo de entidad (ESTRUCTURA_TIPO_POR_LEY): órganos, cargos
    y relaciones (quién designa, quién supervisa, quién es titular o AGA), con su base legal;
  - rof: los órganos de las entidades cuyo ROF o designaciones se leyeron (ORGANOS_OFICINAS_AREAS), con su padre y la
    norma publicada en El Peruano;
  - fuentes: el catálogo de fuentes del grafo (FUENTES_CATALOGO, FTE-xxx → título, institución y dirección), para que
    cada arista del grafo lleve su enlace;
  - adscritos: los organismos públicos adscritos a cada ministerio (ADSCRIPCION_ORGANISMOS), para el gobierno entero.

Es un snapshot: se vuelve a correr cuando cambia el libro. Sin red ni base.

    python backend/scripts/generar_estado_json.py
"""

from __future__ import annotations

import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
LIBRO = ROOT / "dataset" / "CLAUDE-GENERADO" / "vigia_mapa_estado_peruano.xlsx"
SALIDA = ROOT / "backend" / "api" / "src" / "data" / "estado.json"


def hoja(wb, nombre: str) -> list[dict]:
    filas = list(wb[nombre].iter_rows(values_only=True))
    cab = [str(c) for c in filas[0]]
    return [dict(zip(cab, f)) for f in filas[1:] if any(v is not None for v in f)]


def txt(v) -> str | None:
    if v is None:
        return None
    s = " ".join(str(v).split())
    return s or None


def main() -> None:
    wb = openpyxl.load_workbook(LIBRO, read_only=True)

    fuentes = {
        f["source_id"]: {"titulo": txt(f["titulo"]), "institucion": txt(f["institucion_responsable"]), "url": txt(f["url"])}
        for f in hoja(wb, "FUENTES_CATALOGO") if f.get("source_id")
    }

    plantillas: dict[str, dict] = {}
    for f in hoja(wb, "ESTRUCTURA_TIPO_POR_LEY"):
        pid = f["plantilla_id"]
        p = plantillas.setdefault(pid, {"nombre": txt(f["plantilla"]), "aplica": txt(f["aplica_a"]), "organos": [], "cargos": [], "relaciones": []})
        clase = txt(f["elemento"]) or ""
        base = {"base": txt(f["base_legal"]), "fuente": txt(f["fuente"]), "estado": txt(f["estado"])}
        if clase == "Órgano":
            dep = txt(f["depende_de"])
            p["organos"].append({"id": f["elemento_id"], "nombre": txt(f["nombre"]), "depende": None if dep == "(raíz)" else dep,
                                 "funciones": txt(f["funciones_competencias"]), **base})
        elif clase == "Cargo":
            p["cargos"].append({"id": f["elemento_id"], "nombre": txt(f["nombre"]), "organo": txt(f["depende_de"]),
                                "designa": txt(f["quien_designa"]), "funciones": txt(f["funciones_competencias"]), **base})
        elif clase.startswith("Relación"):
            tipo = clase[clase.find("(") + 1:clase.find(")")]
            de, _, a = (f["elemento_id"] or "").partition(" → ")
            p["relaciones"].append({"tipo": tipo, "de": de.strip(), "a": a.strip(), "texto": txt(f["nombre"]), "estado": txt(f["estado"])})

    rof: dict[str, dict] = {}
    for f in hoja(wb, "ORGANOS_OFICINAS_AREAS"):
        e = rof.setdefault(f["entity_id"], {"entidad": txt(f["entidad"]), "organos": []})
        e["organos"].append({
            "id": f["org_id"], "nombre": txt(f["nombre"]), "tipo": txt(f["tipo"]), "padre": txt(f["padre_id"]),
            "nivel": int(f["nivel_organizativo"]) if f["nivel_organizativo"] not in (None, "") else None,
            "funciones": txt(f["funciones_resumen"]), "norma": txt(f["norma_documento"]), "fuente": txt(f["fuente"]), "url": txt(f["url"]),
        })

    # Los organismos adscritos a cada ministerio (DS 097-2021-PCM, calificación de la LOPE).
    adscritos = [
        {"entidad": f["entity_id"], "organismo": txt(f["organismo"]), "sigla": txt(f["sigla"]), "ministerio": f["ministerio_id"],
         "calificacion": txt(f["calificacion_lope"]), "fuente": txt(f["fuente"]), "url": txt(f["url_fuente"])}
        for f in hoja(wb, "ADSCRIPCION_ORGANISMOS") if f.get("entity_id") and f.get("ministerio_id")
    ]

    salida = {"corte": "2026-10-23", "fuentes": fuentes, "plantillas": plantillas, "rof": rof, "adscritos": adscritos}
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{SALIDA.relative_to(ROOT)}: {len(fuentes)} fuentes, {len(plantillas)} plantillas, "
          f"{sum(len(e['organos']) for e in rof.values())} órganos de {len(rof)} entidades, {len(adscritos)} organismos adscritos")


if __name__ == "__main__":
    main()
