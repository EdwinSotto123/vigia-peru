"""
map_dataset.py
==============

Construye un contexto global de todo el dataset descargado del portal de Datos
Abiertos del OECE/SEACE (https://bi.seace.gob.pe/.../datosabiertos.html).

Salidas:
  - catalog.json     -> Catálogo legible por una máquina (para alimentar a un agente).
  - catalog_summary.txt -> Resumen plano para inspección humana rápida.

Para cada archivo (xlsx o csv) registra:
  - ruta relativa, tamaño, número aproximado de filas
  - columnas con dtype inferido
  - 3 filas de muestra
  - nota del dataset (notas.txt / nota.txt asociado)
  - sheet del Diccionario.xlsx que documenta sus campos (cuando aplica)

Para el Diccionario.xlsx registra, por cada hoja:
  - nombre del dataset descrito
  - lista de variables con descripción / tipo / tamaño / recurso relacionado

Ejecutar:
    python map_dataset.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path
from typing import Any

import pandas as pd
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
DATASET_DIR = ROOT / "dataset"
DICT_FILE = DATASET_DIR / "Diccionario.xlsx"

OUT_JSON = ROOT / "catalog.json"
OUT_TXT = ROOT / "catalog_summary.txt"

# ---------------------------------------------------------------------------
# Mapeo manual: archivo de datos  ->  hoja del Diccionario que lo documenta
# ---------------------------------------------------------------------------
# Las claves son substrings del nombre del archivo (mayúsculas).
FILE_TO_DICT_SHEET: dict[str, str] = {
    "CONOSCE_PAC": "PAC Diccionario",
    "CONOSCE_CONVOCATORIAS": "Convocatoria Diccionario",
    "CONOSCE_MIEMBROCOMITE": "MiembrosComite Diccionario",
    "CONOSCE_NULOS": "Nulos Diccionario",
    "CONOSCE_DESIERTOS": "Desiertos Diccionario",
    "CONOSCE_ADJUDICACIONES_CD": "ContratacionDirecta Diccionario",
    "CONOSCE_ADJUDICACIONES": "Adjudicación Diccionario",
    "CONOSCE_POSTOR": "ListadoOfertantes Diccionario",
    "CONOSCE_CONSORCIO": "Consorcio Diccionario",
    "CONOSCE_PROVEEDORES": "Consorcio Diccionario",  # documentación compartida
    "CONOSCE_CONTRATOS": "Contratos Diccionario",
    "CONOSCE_ARBITRAJE": "Arbitraje Diccionario",
    "CONOSCE_ORDENESCOMPRA": "Ordenes y Servicios Diccionario",
    "CONOSCE_SICANVIGENTE": "Profesionales y SICAN Diccionar",
    "CONOSCE_PRONUNCIAMIENTOS": "Pronunciamientos Diccionario",
    "CONOSCE_INTERPRETACIONNORMATIVA": "OpinionesNormativas Diccionario",
    "PENALIDADES": "Penalidades Diccionario",
    "SANCIONADOS": "Inhabilitacion Diccionario",
    "INHABILITACIONES_JUDICIALES": "MandatoJudicial Diccionario",
    "ENTIDADES_CONTRATANTES": "Entidades Diccionario",
    # conformacion_juridica.csv no tiene hoja específica en el diccionario;
    # su contenido se describe en el README del RNP (campos: RUC, tipo, etc.)
    "CONFORMACION_JURIDICA": None,
}


def find_dict_sheet(filename: str) -> str | None:
    name = filename.upper()
    for key, sheet in FILE_TO_DICT_SHEET.items():
        if key in name:
            return sheet
    return None


# ---------------------------------------------------------------------------
# Casos especiales de lectura
# ---------------------------------------------------------------------------

# Archivos cuyo header NO está en la primera fila.
# Las claves son substrings del nombre (mayúsculas) -> índice de fila de cabecera (0-based).
HEADER_OFFSETS: dict[str, int] = {
    "CONOSCE_INTERPRETACIONNORMATIVA": 1,
}


def _clean_col(name: object) -> str:
    """Normaliza el nombre de columna. Hoy es no-op: la consola Windows muestra
    Ñ/í/Ó como `�` por cp1252, pero los datos en disco están bien (UTF-8)."""
    return str(name).strip()


def _header_offset_for(filename: str) -> int:
    name = filename.upper()
    for key, offset in HEADER_OFFSETS.items():
        if key in name:
            return offset
    return 0


# ---------------------------------------------------------------------------
# Lectura del Diccionario.xlsx
# ---------------------------------------------------------------------------

def parse_dictionary(path: Path) -> dict[str, dict[str, Any]]:
    """Devuelve {hoja: {dataset_name, variables: [{nombre, descripcion, tipo, tamanio, recurso_rel, info_adicional}]}}."""
    xl = pd.ExcelFile(path)
    result: dict[str, dict[str, Any]] = {}

    for sheet in xl.sheet_names:
        raw = pd.read_excel(xl, sheet_name=sheet, header=None, dtype=str)
        raw = raw.fillna("")

        # Buscar la fila de cabecera (contiene la palabra "Variable" en col 0)
        header_idx = None
        dataset_name = ""
        for i, row in raw.iterrows():
            cell0 = str(row.iloc[0]).strip().lower()
            cell1 = str(row.iloc[1]).strip()
            if "nombre del dataset" in cell0 and cell1:
                dataset_name = cell1
            if cell0 == "variable":
                header_idx = i
                break

        variables: list[dict[str, str]] = []
        if header_idx is not None:
            body = raw.iloc[header_idx + 1 :].reset_index(drop=True)
            for _, row in body.iterrows():
                nombre = str(row.iloc[0]).strip()
                if not nombre:
                    continue
                variables.append(
                    {
                        "nombre": nombre,
                        "descripcion": str(row.iloc[1]).strip() if len(row) > 1 else "",
                        "tipo": str(row.iloc[2]).strip() if len(row) > 2 else "",
                        "tamanio": str(row.iloc[3]).strip() if len(row) > 3 else "",
                        "recurso_relacionado": str(row.iloc[4]).strip() if len(row) > 4 else "",
                        "info_adicional": str(row.iloc[5]).strip() if len(row) > 5 else "",
                    }
                )

        result[sheet] = {
            "dataset_name": dataset_name,
            "variables": variables,
        }
    return result


# ---------------------------------------------------------------------------
# Inspección de archivos de datos
# ---------------------------------------------------------------------------

def _excel_dims(path: Path) -> tuple[int, int]:
    """Devuelve (rows, cols) sin cargar todo en memoria."""
    wb = load_workbook(filename=path, read_only=True, data_only=True)
    ws = wb.active
    rows = ws.max_row or 0
    cols = ws.max_column or 0
    wb.close()
    return rows, cols


def inspect_excel(path: Path) -> dict[str, Any]:
    header_row = _header_offset_for(path.name)
    sample = pd.read_excel(path, header=header_row, nrows=3)
    sample.columns = [_clean_col(c) for c in sample.columns]
    rows, _ = _excel_dims(path)
    # max_row incluye la(s) cabecera(s) y filas vacías previas
    data_rows = max(0, rows - (header_row + 1))
    columns = [
        {"nombre": c, "dtype": str(sample[c].dtype)} for c in sample.columns
    ]
    return {
        "tipo_archivo": "xlsx",
        "header_row": header_row,
        "filas_aprox": data_rows,
        "columnas": columns,
        "muestra": sample.astype(str).to_dict(orient="records"),
    }


def _csv_count_rows(path: Path, delim: str) -> int:
    """Cuenta filas de datos respetando saltos de línea embebidos en celdas.
    Usa el parser CSV de pandas en chunks para no cargar todo en RAM."""
    n = 0
    for chunk in pd.read_csv(
        path,
        sep=delim,
        chunksize=200_000,
        dtype=str,
        encoding_errors="replace",
        on_bad_lines="skip",
    ):
        n += len(chunk)
    return n


def _csv_sniff_delimiter(path: Path) -> str:
    with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        head = f.read(4096)
    try:
        return csv.Sniffer().sniff(head, delimiters=",;|\t").delimiter
    except csv.Error:
        return ","


def inspect_csv(path: Path) -> dict[str, Any]:
    delim = _csv_sniff_delimiter(path)
    sample = pd.read_csv(path, nrows=3, sep=delim, encoding_errors="replace")
    sample.columns = [_clean_col(c) for c in sample.columns]
    n_rows = _csv_count_rows(path, delim)
    columns = [
        {"nombre": c, "dtype": str(sample[c].dtype)} for c in sample.columns
    ]
    return {
        "tipo_archivo": "csv",
        "delimitador": delim,
        "filas_aprox": n_rows,
        "columnas": columns,
        "muestra": sample.astype(str).to_dict(orient="records"),
    }


def inspect_data_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".xlsx":
        return inspect_excel(path)
    if suffix == ".csv":
        return inspect_csv(path)
    raise ValueError(f"Tipo de archivo no soportado: {path}")


def read_note(folder: Path) -> str:
    for name in ("notas.txt", "nota.txt"):
        p = folder / name
        if p.exists():
            try:
                return p.read_text(encoding="utf-8", errors="replace").strip()
            except Exception:
                return ""
    return ""


# ---------------------------------------------------------------------------
# Construcción del catálogo
# ---------------------------------------------------------------------------

def build_catalog() -> dict[str, Any]:
    dictionary = parse_dictionary(DICT_FILE)

    datasets: list[dict[str, Any]] = []

    # Recorre cada carpeta directa de DATASET_DIR (un dataset por carpeta)
    for folder in sorted(p for p in DATASET_DIR.iterdir() if p.is_dir()):
        nota = read_note(folder)
        # Subcarpetas de datos_complementarios son datasets independientes
        subfolders = [p for p in folder.iterdir() if p.is_dir()]
        if subfolders:
            for sf in sorted(subfolders):
                _add_folder_to_catalog(sf, datasets, parent=folder.name)
        else:
            _add_folder_to_catalog(folder, datasets, parent=None, nota_override=nota)

    return {
        "raiz": str(DATASET_DIR),
        "fuente": "Portal de Datos Abiertos OECE/SEACE (https://bi.seace.gob.pe/pentaho/api/repos/:public:portal:datosabiertos.html/)",
        "diccionario": dictionary,
        "datasets": datasets,
    }


def _add_folder_to_catalog(
    folder: Path,
    datasets: list[dict[str, Any]],
    parent: str | None,
    nota_override: str | None = None,
) -> None:
    nota = nota_override if nota_override is not None else read_note(folder)
    files_info: list[dict[str, Any]] = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in (".xlsx", ".csv"):
            continue
        print(f"[mapping] {p.relative_to(ROOT)}", file=sys.stderr)
        try:
            info = inspect_data_file(p)
        except Exception as e:
            info = {"error": f"{type(e).__name__}: {e}"}
        info["archivo"] = p.name
        info["ruta_relativa"] = str(p.relative_to(ROOT))
        info["tamanio_mb"] = round(p.stat().st_size / (1024 * 1024), 2)
        info["hoja_diccionario"] = find_dict_sheet(p.name)
        files_info.append(info)

    if not files_info:
        return

    datasets.append(
        {
            "carpeta": folder.name,
            "carpeta_padre": parent,
            "ruta_relativa": str(folder.relative_to(ROOT)),
            "nota": nota,
            "archivos": files_info,
        }
    )


def write_summary(catalog: dict[str, Any]) -> None:
    lines: list[str] = []
    lines.append("CATÁLOGO DEL DATASET SEACE / OECE")
    lines.append("=" * 60)
    lines.append(f"Raíz: {catalog['raiz']}")
    lines.append("")
    lines.append("DICCIONARIO DE DATOS (Diccionario.xlsx)")
    lines.append("-" * 60)
    for sheet, info in catalog["diccionario"].items():
        lines.append(f"  * Hoja: {sheet}")
        if info["dataset_name"]:
            lines.append(f"      Dataset: {info['dataset_name']}")
        lines.append(f"      Variables ({len(info['variables'])}):")
        for v in info["variables"]:
            lines.append(f"        - {v['nombre']} ({v['tipo']}, {v['tamanio']}): {v['descripcion']}")
        lines.append("")

    lines.append("")
    lines.append("DATASETS DETECTADOS")
    lines.append("=" * 60)
    for ds in catalog["datasets"]:
        path = ds["ruta_relativa"]
        lines.append(f"\n[{ds['carpeta']}]  {path}")
        if ds["nota"]:
            lines.append(f"  Nota: {ds['nota']}")
        for f in ds["archivos"]:
            lines.append(
                f"  -> {f['archivo']}  "
                f"({f.get('tipo_archivo','?')}, ~{f.get('filas_aprox','?')} filas, "
                f"{f.get('tamanio_mb','?')} MB) "
                f"[diccionario: {f.get('hoja_diccionario')}]"
            )
            if "columnas" in f:
                cols = ", ".join(c["nombre"] for c in f["columnas"])
                lines.append(f"      columnas: {cols}")

    OUT_TXT.write_text("\n".join(lines), encoding="utf-8")


def export_opiniones_clean() -> Path | None:
    """Reexporta CONOSCE_INTERPRETACIONNORMATIVA con header correcto y columnas limpias."""
    src = (
        DATASET_DIR
        / "datos_complementarios"
        / "opiniones_normativas"
        / "CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx"
    )
    if not src.exists():
        return None
    df = pd.read_excel(src, header=1, dtype=str).fillna("")
    df.columns = [_clean_col(c) for c in df.columns]
    out = src.with_name("opiniones_normativas_clean.csv")
    df.to_csv(out, index=False, encoding="utf-8")
    print(f"[clean] {out.relative_to(ROOT)}  ({len(df)} filas)", file=sys.stderr)
    return out


def main() -> None:
    print("Construyendo catálogo...", file=sys.stderr)
    export_opiniones_clean()
    catalog = build_catalog()
    OUT_JSON.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_summary(catalog)
    print(f"OK -> {OUT_JSON}", file=sys.stderr)
    print(f"OK -> {OUT_TXT}", file=sys.stderr)


if __name__ == "__main__":
    main()
