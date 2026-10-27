#!/usr/bin/env python3
"""Carga las obras públicas de INFOBRAS (Contraloría) y las inversiones de Invierte.pe (MEF): migración 160.

  · INFOBRAS: el XLSX «DataSet-Obras-Publicas DD-MM-YYYY» de https://infobras.contraloria.gob.pe/InfobrasWeb/DataSets
    (~57 MB, 97 columnas, ~191 mil obras, cadenas en línea: se lee con zipfile + iterparse, sin openpyxl). La Contraloría
    no responde fuera del Perú: este script corre desde una PC en Lima.
  · Invierte.pe: DETALLE_INVERSIONES.csv (activas) y CIERRE_INVERSIONES.csv (cerradas) de
    https://fs.datosabiertos.mef.gob.pe/datastorefiles/. También responden desde la nube, pero van aquí para que las dos
    fuentes se carguen juntas y el cruce obra ↔ inversión ↔ contrato salga de la misma foto (y porque los lectores de
    CSV/XLSX del Worker de scrapers los están cambiando otras fuentes). NUNCA DIRECTORIO_INVIERTE.csv (correos y teléfonos
    de funcionarios) ni PROCESO_SELECCION.csv (es el avance por componente, no procesos de selección).

Qué no se guarda (privacidad): de INFOBRAS, los nombres del residente y del supervisor de obra («Nombres Apellidos»), las
fechas de labores del residente, los comentarios, la dirección y el documento de aprobación; de Invierte.pe, los
responsables (RESPONSABLE_UEI) y la descripción de la alternativa. Ningún DNI.

Qué hace:
  1. Baja cada archivo a su propia carpeta nueva bajo dataset/ (infobras_AAAAMMDD/, invierte_AAAAMMDD/), o usa los que se
     le pasen. Los archivos bajados son datos no confiables: este script se corre con `python -I`.
  2. Lee y normaliza (los montos de INFOBRAS vienen como «1205287 56» = 1205287.56, o «S/4 195 186 00»; las fechas
     dd/mm/aaaa), sin tener el archivo entero en memoria.
  3. En una transacción por fuente: COPY a una tabla temporal y upsert por la llave (Código INFOBRAS, CUI) que sólo
     reescribe las filas que cambiaron (`huella`); las que ya no vienen en un archivo completo quedan `retirada`.
     Idempotente: corrido dos veces con los mismos archivos, la segunda no cambia nada.
  4. La primera vez, el CUI de todos los procesos (refrescar_proceso_cui por año); después, refrescar_obras(): entidad,
     ubigeo, datos imposibles, banderas, obra ↔ contrato y los cruces del contrato. Registra la carga en datasets_cargas.
  5. Con --propagar, además rehace casos_cruce, su vista de totales y el resumen de empresas (lo que el pipeline de cruces
     hace cada mañana), para ver las banderas el mismo día. No correrlo entre las 06:00 y las 07:30 de Lima (corre el
     pipeline de oece_ocds).

Uso (desde la raíz del repo; en Git Bash, con MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PATH="/c/Users/usuario/bin:$PATH"):
  python -I -X utf8 backend/scripts/cargar_obras.py --seco                         # baja, lee y cuenta; no escribe
  python -I -X utf8 backend/scripts/cargar_obras.py --entorno dev
  python -I -X utf8 backend/scripts/cargar_obras.py --entorno prod --propagar
  ... --xlsx dataset/infobras_20261026/obras.xlsx     un XLSX ya bajado
  ... --mef-dir dataset/invierte_20261027             los CSV del MEF ya bajados
  ... --sin-infobras | --sin-mef                      una sola fuente
  ... --sin-cruces                                    todo menos las banderas de los contratos en cruces_proveedor
  ... --encender-cruces                               enciende esas banderas (interruptor en obra_refresco, clave
                                                      'cruces') y las escribe. Mientras está apagado, refrescar_cruce_obras()
                                                      (y el pipeline de cruces) no las escribe: así se carga prod antes de
                                                      desplegar la API y la web que conocen los tipos (la ficha de hoy
                                                      mostraría el nombre interno de un tipo que no conoce). Una vez:
  MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PATH="/c/Users/usuario/bin:$PATH" python -I -X utf8 backend/scripts/cargar_obras.py --entorno prod --sin-infobras --sin-mef --encender-cruces --propagar

Para refrescar (cada semana, a mano: no hay tarea programada en la PC), el comando exacto:
  MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PATH="/c/Users/usuario/bin:$PATH" python -I -X utf8 backend/scripts/cargar_obras.py --entorno prod --propagar
Tarda ~25 min en prod (medido el 2026-10-27: leer el XLSX ~2 min, los CSV ~2 min, subir ~11 min con todas las filas
nuevas, refrescar_obras() ~6.5 min, propagar ~5.5 min); pasa de 10 min, así que desde Claude se lanza desacoplado
(Start-Process, como dice dataset/declaracion_jurada/procesos.json). El paso del pipeline (refrescar_cruce_obras()) tarda
~2 a 4 min en prod, casi todo en leer los ganadores de los procesos de obras y consultoría.
Cada corrida deja lo bajado en dataset/infobras_AAAAMMDD/ y dataset/invierte_AAAAMMDD/ (~430 MB): las carpetas viejas
se pueden borrar. Sólo la base: `--sin-infobras --sin-mef` corre refrescar_obras() sin volver a cargar.

Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import site
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

# Con `python -I` no entra el site-packages del usuario (ahí está psycopg2) ni la carpeta del script.
if sys.flags.isolated:
    sys.path.append(site.getusersitepackages())

RAIZ = Path(__file__).resolve().parents[2]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
INFOBRAS = "https://infobras.contraloria.gob.pe"
INFOBRAS_DATASETS = f"{INFOBRAS}/InfobrasWeb/DataSets"
MEF = "https://fs.datosabiertos.mef.gob.pe/datastorefiles"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
csv.field_size_limit(1 << 30)

# ─── Columnas ─────────────────────────────────────────────────────────────────

# INFOBRAS: posición → (cabecera tal como viene, columna de obra_infobras, tipo). `None`: no se guarda.
COLUMNAS_INFOBRAS: list[tuple[str, str | None, str]] = [
    ("codigo Entidad", "entidad_codigo", "texto"),
    ("Entidad Pública", "entidad_nombre", "texto"),
    ("Código INFOBRAS", "codigo", "entero"),
    ("Nombre de obra", "nombre", "texto"),
    ("Modalidad de ejecución de la obra", "modalidad", "texto"),
    ("¿Corresponde a un saldo de Obra?", "es_saldo", "si"),
    ("Código INFOBRAS de obra inicial", "obra_inicial", "entero"),
    ("Naturaleza de la obra", "naturaleza", "texto"),
    ("Tipo de obra - Clasificador Nivel 1", "tipo1", "texto"),
    ("Tipo de obra - Clasificador Nivel 2", "tipo2", "texto"),
    ("Tipo de obra - Clasificador Nivel 3", "tipo3", "texto"),
    ("Estado de ejecución", "estado", "texto"),
    ("Marca Reconstrucción con Cambios (Si/No)", None, ""),
    ("Marca Reactivación Economicas (Si/No)", None, ""),
    ("Otra Marca", None, ""),
    ("N° de Veedurías Ciudadanas", "veedurias", "entero0"),
    ("N° Informes de control", "informes_control", "entero0"),
    ("N° Comentarios ciudadanos", "comentarios_ciudadanos", "entero0"),
    ("¿Es una obra de carácter reservado?", None, ""),
    ("Nivel de gobierno", "nivel_gobierno", "texto"),
    ("Sector de la Entidad", "sector", "texto"),
    ("Codigo unico de inversión", "cui", "cui"),
    ("Código SNIP", "snip", "snip"),
    ("Nombre de la inversión", "inversion_nombre", "texto"),
    ("Estado del proyecto", None, ""),
    ("Tipo Formato", None, ""),
    ("Monto Viable/Aprobado", "monto_viable", "monto"),
    ("Costo Actualizado de la inversión", None, ""),          # siempre 0 en el archivo: el de Invierte.pe sí sirve
    ("N° obras pertenecientes a la inversión", "obras_en_inversion", "entero"),
    ("Departamento", "departamento", "texto"),
    ("Provincia", "provincia", "texto"),
    ("Distrito", "distrito", "texto"),
    ("Dirección o información de referencia", None, ""),    # texto libre
    ("Tipo de ubicación (exacta/referencial)", None, ""),
    ("Fecha de aprobación del expediente ", "fecha_aprob_et", "fecha"),
    ("Costo de obra según Expediente técnico", None, ""),   # en su moneda; va el de soles
    ("Moneda", "moneda_et", "texto"),
    ("Tasa de cambio", None, ""),
    ("Costo de obra en soles según ET en soles", "costo_et", "monto"),
    ("Documento de aprobación de expediente", None, ""),    # texto libre
    ("RUC (Ejecución)", "ejecutor_ruc", "ruc"),
    ("Nombre o razón social de la empresa o consorcio", "ejecutor_nombre", "texto"),
    ("Monto del contrato  en soles", "contrato_monto", "monto"),
    ("RUC (Supervisión)", "supervisor_ruc", "ruc"),
    ("Nombre o razón social de la empresa o consorcio:", "supervisor_nombre", "texto"),
    ("Monto del contrato  en soles", "supervision_monto", "monto"),
    ("Nombres Apellidos (Supervisión)", None, ""),          # PERSONA: nunca se guarda
    ("Fecha inicio supervision", "supervision_inicio", "fecha"),
    ("Fecha fin supervision", "supervision_fin", "fecha"),
    ("Nombres Apellidos (Residente)", None, ""),            # PERSONA: nunca se guarda
    ("Fecha inicio de labores", None, ""),                  # las del residente
    ("Fecha fin  de labores", None, ""),
    ("Fecha de inicio de obra", "fecha_inicio", "fecha"),
    ("Fecha finalización programada de obra", "fecha_fin_prog", "fecha"),
    ("Plazo de ejecución (en dias)", "plazo_dias", "entero"),
    ("Tipo de entrega", "entrega_terreno", "texto"),
    ("Porcentaje de terreno entregado", "terreno_pct", "monto"),
    ("Fecha de entrega del terreno", "fecha_terreno", "fecha"),
    ("Año de avance", "avance_anio", "entero"),
    ("Mes de avance", "avance_mes", "entero"),
    ("Fecha de registro de avance", "avance_fecha", "fecha"),
    ("Avance Físico Programado Acumulado (%)", "fisico_prog", "monto"),
    ("Avance Físico Real Acumulado (%)", "fisico_real", "monto"),
    ("Monto de valorización Programado Acumulado", "valorizado_prog", "monto"),
    ("Monto de valorización Ejecutado Acumulado", "valorizado_real", "monto"),
    ("Porcentaje de ejecución financiera", "financiero_pct", "monto"),
    ("Monto de ejecución financiera de la obra", "financiero_monto", "monto"),
    ("Existe Paralización", "paralizada", "si"),
    ("Causal de paralización", "causal_paralizacion", "texto"),
    ("Fecha de paralización", "fecha_paralizacion", "fecha"),
    ("Número de dias paralizado", "dias_paralizada", "entero"),
    ("Comentarios", None, ""),                              # texto libre
    ("N° de modificaciones", "modificaciones", "entero0"),
    ("N° días de modificaciones de plazo", "dias_ampliacion", "entero0"),
    ("Nuevo Plazo de ejecución (en dias)", "nuevo_plazo", "entero"),
    ("Fecha finalización reprogramada de obra", "fecha_fin_reprog", "fecha"),
    ("N° de controversias", "controversias", "entero0"),
    ("N° de adicionales de obra", "adicionales_n", "entero0"),
    ("Monto de adicionales de obra en soles", "adicionales_monto", "monto0"),
    ("N° de adicionales de supervisión", "adic_sup_n", "entero0"),
    ("Monto de adicionales de supervisión en soles", "adic_sup_monto", "monto0"),
    ("N° de deductivos de obra", "deductivos_n", "entero0"),
    ("Monto de deductivos de obra en soles", "deductivos_monto", "monto0"),
    ("N° de deductivos de supervisión ", "deduc_sup_n", "entero0"),
    ("Monto de deductivos de supervisión en soles", "deduc_sup_monto", "monto0"),
    ("Fecha de finalización real", "fecha_fin_real", "fecha"),
    ("Motivo en caso no se llegue al 100%", "motivo_no_100", "texto"),
    ("¿Tiene recepción total?", "recepcion", "si_nulo"),
    ("Fecha de recepción", "fecha_recepcion", "fecha"),
    ("¿Tiene liquidación de obra?", "liquidacion", "si_nulo"),
    ("Fecha de aprobación de liquidación de obra", "fecha_liquidacion", "fecha"),
    ("Costo de la obra en soles", "costo_liquidacion", "monto"),
    ("¿Corresponde la transferencia  a otra entidad?", "transferida", "si_nulo"),
    ("Fecha de transferencia", "fecha_transferencia", "fecha"),
    ("Tipo de entidad que recepciona la obra", "receptora", "texto"),
    ("Año de primer devengado", "devengado_desde", "entero"),
    ("Monto Total devengado del proyecto", "devengado_total", "monto"),
]
CAMPOS_OBRA = [c for _, c, _ in COLUMNAS_INFOBRAS if c] + ["huella", "dataset_fecha"]

# Invierte.pe: columna de inversion_mef → (columna en DETALLE_INVERSIONES, en CIERRE_INVERSIONES, tipo).
COLUMNAS_MEF: list[tuple[str, str | None, str | None, str]] = [
    ("cui", "CODIGO_UNICO", "CODIGO_UNICO", "cui"),
    ("snip", "CODIGO_SNIP", "CODIGO_SNIP", "snip"),
    ("nombre", "NOMBRE_INVERSION", "NOMBRE_INVERSION", "texto"),
    ("nivel", "NIVEL", "NIVEL", "texto"),
    ("sector", "SECTOR", "SECTOR", "texto"),
    ("entidad_nombre", "ENTIDAD", "ENTIDAD", "texto"),
    ("sec_ejec", "SEC_EJEC", "SEC_EJEC", "entero"),
    ("uei", "NOMBRE_UEI", "NOM_UEI", "texto"),
    ("uep", "NOMBRE_UEP", "NOM_UEP", "texto"),
    ("estado", "ESTADO", "ESTADO", "texto"),
    ("situacion", "SITUACION", "SITUACION", "texto"),
    ("monto_viable", "MONTO_VIABLE", "MONTO_VIABLE", "numero"),
    ("costo_actualizado", "COSTO_ACTUALIZADO", "COSTO_ACTUALIZADO", "numero"),
    ("control_concurrente", "CTRL_CONCURR", "CONTROL_CONCURR", "numero"),
    ("monto_laudo", "MONTO_LAUDO", "MONTO_LAUDO", "numero"),
    ("monto_fianza", "MONTO_FIANZA", "MONTO_FIANZA", "numero"),
    ("fecha_registro", "FECHA_REGISTRO", "FECHA_REGISTRO", "fecha_iso"),
    ("fecha_viabilidad", "FECHA_VIABILIDAD", "FECHA_VIABILIDAD", "fecha_iso"),
    ("funcion", "FUNCION", "FUNCION", "texto"),
    ("programa", "PROGRAMA", "PROGRAMA", "texto"),
    ("subprograma", "SUBPROGRAMA", "SUBPROGRAMA", "texto"),
    ("marco", "MARCO", "MARCO", "texto"),
    ("tipo_inversion", "TIPO_INVERSION", "TIPO_INVERSION", "texto"),
    ("modalidad", "DES_MODALIDAD", "DES_MODALIDAD", "texto"),
    ("tipologia", "DES_TIPOLOGIA", "DES_TIPOLOGIA", "texto"),
    ("expediente_tecnico", "EXPEDIENTE_TECNICO", "EXPEDIENTE_TECNICO", "si"),
    ("informe_cierre", "INFORME_CIERRE", "INFORME_CIERRE", "si"),
    ("primer_devengado", "PRIMER_DEVENGADO", "PRIMER_DEVENGADO", "entero"),
    ("ultimo_devengado", "ULTIMO_DEVENGADO", "ULTIMO_DEVENGADO", "entero"),
    ("devengado_acumulado", None, "DEVEN_ACUMULADO", "numero"),     # activas: años anteriores + el del año (abajo)
    ("devengado_anio", "DEV_ANIO_ACTUAL", None, "numero"),
    ("pim_anio", "PIM_ANIO_ACTUAL", None, "numero"),
    ("saldo_ejecutar", "SALDO_EJECUTAR", None, "numero"),
    ("avance_fisico", "AVANCE_FISICO", None, "numero"),
    ("avance_ejecucion", "AVANCE_EJECUCION", None, "numero"),
    ("monto_et", "MONTO_ET_F8", None, "numero"),
    ("departamento", "DEPARTAMENTO", "DEPARTAMENTO", "texto"),
    ("provincia", "PROVINCIA", "PROVINCIA", "texto"),
    ("distrito", "DISTRITO", "DISTRITO", "texto"),
    ("ubigeo", "UBIGEO", "UBIGEO", "ubigeo"),
    ("lat", "LATITUD", "LATITUD", "coordenada"),
    ("lon", "LONGITUD", "LONGITUD", "coordenada"),
    ("inicio_ejecucion", "FEC_INI_EJECUCION", None, "fecha_iso"),
    ("fin_ejecucion", "FEC_FIN_EJECUCION", None, "fecha_iso"),
    ("inicio_fisica", "FEC_INI_EJEC_FISICA", "INICIO_EJEC_FISICA", "fecha_iso"),
    ("fin_fisica", "FEC_FIN_EJEC_FISICA", "CULMINA_EJEC_FISICA", "fecha_iso"),
    ("beneficiarios", "NUM_HABITANTES_BENEF", "BENEFICIARIO", "entero"),
    ("fecha_cierre", None, "FEC_CIERRE", "fecha_iso"),
    ("liquidacion", None, "TOTAL_LIQUIDACION", "numero"),
    ("fecha_liquidacion", None, "FEC_LIQUIDACION", "fecha_iso"),
    ("anio_proceso", "ANIO_PROCESO", "ANIO_PROCESO", "entero"),
]
CAMPOS_INVERSION = [c for c, _, _, _ in COLUMNAS_MEF] + ["origen", "huella", "dataset_fecha"]

# ─── Lectura de valores ───────────────────────────────────────────────────────

VACIOS = {"", "none", "null", "nan", "-", "--"}


def texto(v: str | None) -> str | None:
    t = " ".join((v or "").split())
    return None if t.lower() in VACIOS else t


def monto(v: str | None) -> float | None:
    """«1205287 56» → 1205287.56; «S/4 195 186 00» → 4195186.00; «99 9» → 99.9; «100» → 100; «12,5» → 12.5."""
    t = (v or "").strip()
    if t.lower() in VACIOS:
        return None
    t = re.sub(r"^(S/\.?|US\$|\$)\s*", "", t, flags=re.I).strip()
    if re.fullmatch(r"-?\d+,\d{1,2}", t):
        t = t.replace(",", ".")
    t = t.replace(",", "")
    partes = t.split()
    if partes and all(re.fullmatch(r"-?\d+", p) for p in partes):
        if len(partes) >= 2 and len(partes[-1]) <= 2:
            return float("".join(partes[:-1]) + "." + partes[-1])
        return float("".join(partes))
    try:
        return float(t)
    except ValueError:
        return None


def entero(v: str | None) -> int | None:
    m = monto(v)
    return None if m is None or abs(m) > 2_000_000_000 else int(round(m))


def fecha(v: str | None) -> str | None:
    """dd/mm/aaaa (INFOBRAS) → aaaa-mm-dd; fuera de 1980–2100, nada."""
    t = (v or "").strip()
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s.*)?", t)
    if not m:
        return None
    d, mes, a = (int(x) for x in m.groups())
    try:
        return date(a, mes, d).isoformat() if 1980 <= a <= 2100 else None
    except ValueError:
        return None


def fecha_iso(v: str | None) -> str | None:
    """«2022-07-04 00:00:00» o «2001-06-12» (MEF) → aaaa-mm-dd."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", (v or "").strip())
    if not m:
        return None
    try:
        d = date(*(int(x) for x in m.groups()))
    except ValueError:
        return None
    return d.isoformat() if 1980 <= d.year <= 2100 else None


def cui(v: str | None) -> str | None:
    t = re.sub(r"\D", "", (v or "").strip())
    return t if re.fullmatch(r"[1-9]\d{6}", t) else None


def snip(v: str | None) -> str | None:
    t = (v or "").strip().lstrip("0")
    return t if re.fullmatch(r"\d{3,7}", t) else None


def ruc(v: str | None) -> str | None:
    """Tal como lo publica INFOBRAS (un RUC, «C0002088241» de un consorcio, a veces dos pegados): sin espacios de más."""
    t = " ".join((v or "").split()).upper()
    return None if t.lower() in VACIOS or t in ("NO APLICA", "NO CORRESPONDE", "N/A") else t[:40]


def si(v: str | None) -> bool:
    return (v or "").strip().upper() in ("SI", "SÍ", "S")


def si_nulo(v: str | None) -> bool | None:
    t = (v or "").strip().upper()
    return True if t in ("SI", "SÍ", "S") else False if t in ("NO", "N") else None


def ubigeo(v: str | None) -> str | None:
    t = (v or "").strip()
    return t.zfill(6) if re.fullmatch(r"\d{5,6}", t) else None


def coordenada(v: str | None) -> float | None:
    try:
        x = float((v or "").strip())
    except ValueError:
        return None
    return round(x, 6) if x and -180 <= x <= 180 else None


LECTORES = {
    "texto": texto, "entero": entero, "entero0": lambda v: entero(v) or 0, "monto": monto, "monto0": lambda v: monto(v) or 0.0,
    "fecha": fecha, "fecha_iso": fecha_iso, "cui": cui, "snip": snip, "ruc": ruc, "si": si, "si_nulo": si_nulo,
    "numero": monto, "ubigeo": ubigeo, "coordenada": coordenada,
}


def huella(valores: list) -> str:
    return hashlib.md5("\x1f".join("" if v is None else str(v) for v in valores).encode("utf-8")).hexdigest()


def csv_valor(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "t" if v else "f"
    if isinstance(v, float):
        return repr(round(v, 4))
    return str(v)

# ─── Descargas ────────────────────────────────────────────────────────────────


def bajar(url: str, destino: Path, minimo: int) -> tuple[Path, datetime | None]:
    """Baja `url` a `destino` (si no está ya, entero). Devuelve la ruta y el Last-Modified del servidor."""
    if destino.exists() and destino.stat().st_size >= minimo:
        return destino, datetime.fromtimestamp(destino.stat().st_mtime, timezone.utc)
    destino.parent.mkdir(parents=True, exist_ok=True)
    error = None
    for intento in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=300) as r, open(destino.with_suffix(".parcial"), "wb") as f:
                modificado = r.headers.get("Last-Modified")
                while True:
                    bloque = r.read(1 << 20)
                    if not bloque:
                        break
                    f.write(bloque)
            tmp = destino.with_suffix(".parcial")
            if tmp.stat().st_size < minimo:
                raise RuntimeError(f"{url}: sólo {tmp.stat().st_size} bytes")
            tmp.replace(destino)
            return destino, parsedate_to_datetime(modificado) if modificado else None
        except Exception as e:  # noqa: BLE001 — red, 4xx/5xx o un archivo cortado: reintentar
            error = e
            time.sleep(5 * (intento + 1))
    raise SystemExit(f"no se pudo bajar {url}: {error}")


def link_infobras() -> str:
    """El enlace del dataset de obras de la página de DataSets (el nombre lleva la fecha del día de publicación)."""
    req = urllib.request.Request(INFOBRAS_DATASETS, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'(/InfobrasWeb/Archivo/DownloadFile\?filename=DataSet-Obras-Publicas[^"\']+)', html)
    if not m:
        raise SystemExit("la página de DataSets de INFOBRAS no trae el enlace de obras (¿se está corriendo fuera del Perú?)")
    return INFOBRAS + m.group(1).replace("&amp;", "&")

# ─── INFOBRAS ─────────────────────────────────────────────────────────────────


def filas_xlsx(ruta: Path):
    """Las filas de la primera hoja como listas de texto (celdas en línea o valores), en orden y sin cargar el archivo."""
    with zipfile.ZipFile(ruta) as z:
        hoja = next((n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet1\.xml", n)), None)
        if not hoja:
            raise SystemExit(f"{ruta}: no tiene xl/worksheets/sheet1.xml")
        with z.open(hoja) as f:
            for _, el in ET.iterparse(f):
                if el.tag != NS + "row":
                    continue
                fila = []
                for cel in el.iter(NS + "c"):
                    if cel.get("t") == "inlineStr":
                        fila.append("".join(x.text or "" for x in cel.iter(NS + "t")))
                    else:
                        v = cel.find(NS + "v")
                        fila.append((v.text or "") if v is not None else "")
                el.clear()
                yield fila


def leer_infobras(ruta: Path, salida, cuenta: Counter) -> tuple[set[int], str | None]:
    """Escribe en `salida` (CSV) una fila por obra con CAMPOS_OBRA. Devuelve los códigos y la fecha de consulta."""
    escritor = csv.writer(salida)
    codigos: set[int] = set()
    cabecera = None
    consulta = None
    columnas = COLUMNAS_INFOBRAS
    for fila in filas_xlsx(ruta):
        if cabecera is None:
            unido = " ".join(fila)
            m = re.search(r"Fecha de consulta:\s*(\d{1,2}/\d{1,2}/\d{4})", unido)
            if m:
                consulta = fecha(m.group(1))
            if len([x for x in fila if x]) >= 5:
                cabecera = fila
                esperada = [c for c, _, _ in columnas]
                if cabecera[: len(esperada)] != esperada:
                    distintas = [(i, a, b) for i, (a, b) in enumerate(zip(esperada, cabecera)) if a != b]
                    raise SystemExit(f"INFOBRAS cambió sus columnas: {distintas[:5]} (de {len(cabecera)})")
            continue
        cuenta["filas"] += 1
        valores = []
        for i, (_, campo, tipo) in enumerate(columnas):
            if not campo:
                continue
            crudo = fila[i] if i < len(fila) else ""
            v = LECTORES[tipo](crudo)
            if tipo in ("monto", "fecha", "entero") and v is None and (crudo or "").strip().lower() not in VACIOS:
                cuenta[f"ilegible: {campo}"] += 1
            valores.append(v)
        registro = dict(zip([c for _, c, _ in columnas if c], valores))
        if registro["codigo"] is None or not registro["nombre"]:
            cuenta["descartadas: sin código o nombre"] += 1
            continue
        if registro["codigo"] in codigos:
            cuenta["descartadas: código repetido"] += 1
            continue
        codigos.add(registro["codigo"])
        cuenta["con CUI"] += registro["cui"] is not None
        cuenta["paralizadas"] += bool(registro["paralizada"])
        cuenta["ejecutor RUC 20"] += bool(re.fullmatch(r"20\d{9}", registro["ejecutor_ruc"] or ""))
        cuenta["ejecutor RUC 10"] += bool(re.fullmatch(r"10\d{9}", registro["ejecutor_ruc"] or ""))
        cuenta["supervisor RUC 10"] += bool(re.fullmatch(r"10\d{9}", registro["supervisor_ruc"] or ""))
        escritor.writerow([csv_valor(v) for v in valores + [huella(valores), consulta]])
    if cabecera is None:
        raise SystemExit(f"{ruta}: no se encontró la cabecera")
    return codigos, consulta

# ─── Invierte.pe ──────────────────────────────────────────────────────────────


def leer_mef(ruta: Path, origen: str, salida, cuenta: Counter, vistos: set[str], fecha_archivo: str | None) -> None:
    escritor = csv.writer(salida)
    activa = origen == "activa"
    with open(ruta, encoding="utf-8-sig", errors="replace", newline="") as f:
        lector = csv.DictReader(f)
        faltan = [c for _, a, b, _ in COLUMNAS_MEF for c in [a if activa else b] if c and c not in (lector.fieldnames or [])]
        if faltan:
            raise SystemExit(f"{ruta.name}: faltan columnas {faltan}")
        for r in lector:
            cuenta[f"{origen}: filas"] += 1
            valores = []
            for campo, col_det, col_cie, tipo in COLUMNAS_MEF:
                col = col_det if activa else col_cie
                valores.append(LECTORES[tipo](r.get(col)) if col else None)
            registro = dict(zip([c for c, _, _, _ in COLUMNAS_MEF], valores))
            if activa:
                ant, anio = monto(r.get("DEVEN_ACUMUL_ANIO_ANT")), monto(r.get("DEV_ANIO_ACTUAL"))
                registro["devengado_acumulado"] = None if ant is None and anio is None else (ant or 0) + (anio or 0)
                valores = [registro[c] for c, _, _, _ in COLUMNAS_MEF]
            if not registro["cui"]:
                cuenta[f"{origen}: sin CUI"] += 1
                continue
            if registro["cui"] in vistos:
                cuenta[f"{origen}: CUI repetido (queda el primero)"] += 1
                continue
            vistos.add(registro["cui"])
            escritor.writerow([csv_valor(v) for v in valores + [origen, huella(valores + [origen]), fecha_archivo]])

# ─── Base ─────────────────────────────────────────────────────────────────────

# Sólo se reescribe la fila que cambió (otra huella) o que vuelve a venir después de retirada: `dataset_fecha` queda como la
# fecha del archivo que trajo esa versión. La fecha del último archivo va en obra_refresco (la usan las banderas).
SQL_UPSERT = """
  INSERT INTO {tabla} AS t ({campos}, retirada, cargado_at, cambiado_at)
  SELECT DISTINCT ON ({llave}) {campos}, false, now(), now() FROM {tmp} ORDER BY {llave}
  ON CONFLICT ({llave}) DO UPDATE SET {sets}, retirada = false, cambiado_at = now()
  WHERE t.huella IS DISTINCT FROM EXCLUDED.huella OR t.retirada
  RETURNING (xmax = 0) AS nueva"""


def cargar(con, tabla: str, llave: str, campos: list[str], csvs: list, completo: bool) -> dict:
    """COPY a una temporal y upsert por la llave; las filas que no vinieron quedan `retirada` (si el archivo es completo)."""
    tmp = f"_{tabla}"
    with con, con.cursor() as cur:
        cur.execute("SET LOCAL lock_timeout = '20s'")
        cur.execute("SET LOCAL statement_timeout = 0")
        cur.execute(f"CREATE TEMP TABLE {tmp} (LIKE {tabla} INCLUDING DEFAULTS) ON COMMIT DROP")
        for buf in csvs:
            buf.seek(0)
            cur.copy_expert(f"COPY {tmp} ({', '.join(campos)}) FROM STDIN WITH (FORMAT csv)", buf)
        cur.execute(f"SELECT count(*) FROM {tmp}")
        (copiadas,) = cur.fetchone()
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in campos if c != llave)
        cur.execute(SQL_UPSERT.format(tabla=tabla, campos=", ".join(campos), llave=llave, tmp=tmp, sets=sets))
        filas = cur.fetchall()
        nuevas = sum(1 for (n,) in filas if n)
        cambiadas = len(filas) - nuevas
        retiradas = 0
        if completo:
            cur.execute(f"SELECT count(*) FROM {tabla} WHERE NOT retirada")
            (vivas,) = cur.fetchone()
            if copiadas < 0.9 * vivas:
                print(f"! {tabla}: el archivo trae {copiadas} de {vivas}: no se marcan retiradas (¿archivo incompleto?)")
            else:
                cur.execute(f"UPDATE {tabla} t SET retirada = true, cambiado_at = now() WHERE NOT t.retirada "
                            f"AND NOT EXISTS (SELECT 1 FROM {tmp} x WHERE x.{llave} = t.{llave})")
                retiradas = cur.rowcount
    return {"copiadas": copiadas, "nuevas": nuevas, "cambiadas": cambiadas, "iguales": copiadas - nuevas - cambiadas,
            "retiradas": retiradas}


def registrar(con, fuente: str, clave: str, tabla: str, ruta: Path, url: str, filas: int, bajado: datetime | None) -> None:
    sha = hashlib.sha256()
    with open(ruta, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            sha.update(b)
    with con, con.cursor() as cur:
        cur.execute(
            """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at,
                                            cargado_at, estado)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), 'ok')
               ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256,
                 bytes = EXCLUDED.bytes, filas = EXCLUDED.filas, fuente_url = EXCLUDED.fuente_url,
                 descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
            (fuente, clave, tabla, ruta.name, sha.hexdigest(), ruta.stat().st_size, filas, url, bajado))


class Latido(threading.Thread):
    """Una segunda conexión que hace SELECT 1 cada minuto: el túnel de SSM se corta tras ~20 min sin tráfico."""

    def __init__(self, conectar):
        super().__init__(daemon=True)
        self.con = conectar()
        self.con.autocommit = True
        self.parar = threading.Event()

    def run(self):
        while not self.parar.wait(60):
            try:
                with self.con.cursor() as cur:
                    cur.execute("SELECT 1")
            except Exception:  # noqa: BLE001 — si el latido cae, la conexión principal dirá lo suyo
                return


def paso(con, nombre: str, sql: str):
    t0 = time.time()
    with con, con.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = 0")
        cur.execute(sql)
        filas = cur.fetchall() if cur.description else []
        for n in con.notices[-20:]:
            if "does not exist, skipping" not in n:   # los DROP TABLE IF EXISTS de las tablas temporales
                print("   ", n.strip())
        del con.notices[:]
    print(f"  {nombre}: {time.time() - t0:.0f} s")
    return filas


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga las obras de INFOBRAS y las inversiones de Invierte.pe (migración 160).")
    ap.add_argument("--entorno", choices=["dev", "prod"])
    ap.add_argument("--seco", action="store_true", help="baja, lee y cuenta; no escribe")
    ap.add_argument("--xlsx", help="un XLSX de INFOBRAS ya bajado")
    ap.add_argument("--mef-dir", help="una carpeta con DETALLE_INVERSIONES.csv y CIERRE_INVERSIONES.csv ya bajados")
    ap.add_argument("--sin-infobras", action="store_true")
    ap.add_argument("--sin-mef", action="store_true")
    ap.add_argument("--propagar", action="store_true", help="después, casos_cruce, su vista de totales y empresas")
    ap.add_argument("--sin-cruces", action="store_true",
                    help="todo menos las banderas en cruces_proveedor (antes de desplegar la API y la web que conocen sus tipos)")
    ap.add_argument("--encender-cruces", action="store_true",
                    help="enciende las banderas de los contratos (después de desplegar la API y la web nuevas) y las escribe")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    if a.sin_cruces and (a.propagar or a.encender_cruces):
        ap.error("--propagar y --encender-cruces no van con --sin-cruces")
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    hoy = date.today().strftime("%Y%m%d")
    cuenta: Counter = Counter()

    # 1. INFOBRAS
    # Las filas ya normalizadas van a archivos temporales (fuera del repo), no a memoria: la PC tiene poca RAM.
    temporal = lambda: tempfile.TemporaryFile("w+", encoding="utf-8", newline="")  # noqa: E731
    obras_csv: list = []
    codigos: set[int] = set()
    infobras = None
    if not a.sin_infobras:
        if a.xlsx:
            ruta_x, url_x = Path(a.xlsx), "archivo local"
            bajado_x = datetime.fromtimestamp(ruta_x.stat().st_mtime, timezone.utc)
        else:
            url_x = link_infobras()
            nombre = urllib.parse.unquote(re.search(r"filename=([^&]+)", url_x).group(1))
            ruta_x, bajado_x = bajar(url_x, RAIZ / "dataset" / f"infobras_{hoy}" / "obras.xlsx", 10_000_000)
            print(f"INFOBRAS: {nombre} → {ruta_x.relative_to(RAIZ)}")
        t0 = time.time()
        buf = temporal()
        codigos, consulta = leer_infobras(ruta_x, buf, cuenta)
        obras_csv = [buf]
        infobras = (ruta_x, url_x, bajado_x, consulta)
        print(f"  {len(codigos):,} obras (consulta del {consulta}), {time.time() - t0:.0f} s; "
              + ", ".join(f"{k} {v:,}" for k, v in sorted(cuenta.items()) if not k.startswith(("activa", "cerrada"))))

    # 2. Invierte.pe
    inv_csv: list = []
    cuis: set[str] = set()
    mef = []
    if not a.sin_mef:
        carpeta = Path(a.mef_dir) if a.mef_dir else RAIZ / "dataset" / f"invierte_{hoy}"
        vistos: set[str] = set()
        for nombre, origen in (("DETALLE_INVERSIONES", "activa"), ("CIERRE_INVERSIONES", "cerrada")):
            url_m = f"{MEF}/{nombre}.csv"
            ruta_m, bajado_m = (carpeta / f"{nombre}.csv", None) if a.mef_dir else bajar(url_m, carpeta / f"{nombre}.csv", 50_000_000)
            if bajado_m is None:
                bajado_m = datetime.fromtimestamp(ruta_m.stat().st_mtime, timezone.utc)
            t0 = time.time()
            buf = temporal()
            leer_mef(ruta_m, origen, buf, cuenta, vistos, bajado_m.date().isoformat())
            inv_csv.append(buf)
            mef.append((nombre, ruta_m, url_m, bajado_m, origen))
            print(f"Invierte.pe: {ruta_m.relative_to(RAIZ) if ruta_m.is_relative_to(RAIZ) else ruta_m} ({time.time() - t0:.0f} s)")
        cuis = vistos
        print("  " + ", ".join(f"{k} {v:,}" for k, v in sorted(cuenta.items()) if k.startswith(("activa", "cerrada"))))

    if a.seco:
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    import psycopg2
    from tunel_rds import BASES, CLAVES, _aws, tunel

    base = BASES[a.entorno]
    clave = _aws("ssm", "get-parameter", "--name", CLAVES[base], "--with-decryption", "--query", "Parameter.Value")
    with tunel(base) as (host, puerto):
        conectar = lambda: psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave,  # noqa: E731
                                            sslmode="require", connect_timeout=15, keepalives=1, keepalives_idle=30)
        latido = Latido(conectar)
        latido.start()
        con = conectar()
        try:
            if infobras:
                t0 = time.time()
                r = cargar(con, "obra_infobras", "codigo", CAMPOS_OBRA, obras_csv, completo=True)
                print(f"✓ {base}: obra_infobras {r} ({time.time() - t0:.0f} s)")
                registrar(con, "infobras", "obras", "obra_infobras", infobras[0], infobras[1] if infobras[1] != "archivo local" else INFOBRAS_DATASETS,
                          len(codigos), infobras[2])
                # El día del archivo: las banderas cuentan los días de paralización hasta ahí (refrescar_obras()).
                with con, con.cursor() as cur:
                    cur.execute("""INSERT INTO obra_refresco (clave, valor, nota)
                                   VALUES ('infobras_fecha', (%s::date)::timestamp AT TIME ZONE 'America/Lima',
                                           'fecha de consulta del último archivo de INFOBRAS')
                                   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor""", (infobras[3] or date.today().isoformat(),))
            if mef:
                t0 = time.time()
                r = cargar(con, "inversion_mef", "cui", CAMPOS_INVERSION, inv_csv, completo=len(mef) == 2)
                print(f"✓ {base}: inversion_mef {r} ({time.time() - t0:.0f} s)")
                for nombre, ruta_m, url_m, bajado_m, origen in mef:
                    registrar(con, "invierte_pe", nombre.lower(), "inversion_mef", ruta_m, url_m,
                              cuenta[f"{origen}: filas"], bajado_m)
            del obras_csv, inv_csv

            # 3. El CUI de los procesos: la primera vez, todos (año por año: en DEV, una sola sentencia pasaba el corte del
            #    túnel); después, refrescar_cruce_obras() lee sólo lo que cambió.
            with con, con.cursor() as cur:
                cur.execute("SELECT valor FROM obra_refresco WHERE clave = 'proceso_cui'")
                marca = cur.fetchone()
                cur.execute("SELECT now()")
                (inicio,) = cur.fetchone()
            if not marca or marca[0] is None:
                print("CUI de los procesos (primera vez, año por año):")
                total = 0
                for anio in [0, *range(2015, date.today().year + 1)]:
                    (n,), = paso(con, f"refrescar_proceso_cui({anio})", f"SELECT refrescar_proceso_cui({anio})")
                    total += n
                with con, con.cursor() as cur:
                    cur.execute("""INSERT INTO obra_refresco (clave, valor, nota) VALUES ('proceso_cui', %s, 'updated_at de convocatorias ya leído')
                                   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor""", (inicio,))
                print(f"  proceso_cui: {total:,} filas")

            # El interruptor de las banderas de los contratos (refrescar_cruce_obras(): apagado, no las escribe).
            if a.encender_cruces:
                with con, con.cursor() as cur:
                    cur.execute("""INSERT INTO obra_refresco (clave, valor, nota)
                                   VALUES ('cruces', now(), 'banderas de las obras en los contratos (cruces_proveedor): encendidas')
                                   ON CONFLICT (clave) DO UPDATE SET valor = now()""")
                print("banderas de los contratos: encendidas")
            # 4. Entidad, ubigeo, banderas, obra ↔ contrato y los cruces del contrato.
            print("refrescar_obras():")
            (resumen,), = paso(con, "refrescar_obras", f"SELECT refrescar_obras({'false' if a.sin_cruces else 'true'})")
            print("  " + json.dumps(resumen, ensure_ascii=False))

            # 5. Para verlo hoy: lo que el pipeline de cruces hace cada mañana después de los cruces.
            if a.propagar:
                print("propagar:")
                paso(con, "refrescar_casos_cruce_base", "SELECT refrescar_casos_cruce_base()")
                paso(con, "casos_cruce_totales", "REFRESH MATERIALIZED VIEW CONCURRENTLY casos_cruce_totales")
                paso(con, "refrescar_empresas", "SELECT refrescar_empresas()")
        finally:
            latido.parar.set()
            con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
