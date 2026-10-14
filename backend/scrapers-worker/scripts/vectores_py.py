"""Vectores de paridad: la implementación de Python (backend/core/clasificacion.py,
backend/scrapers/oece_ocds, backend/scrapers/_core/ubigeo.py y los parsers de las fuentes) aplicada a
entradas SINTÉTICAS (sin datos personales) → test/vectores_py.json. test/*.test.ts exige que el port
en TypeScript dé exactamente lo mismo.

  python backend/scrapers-worker/scripts/vectores_py.py        (desde la raíz del repo o desde la carpeta)
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import random
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ))

from backend.core.clasificacion import clasificar  # noqa: E402
from backend.scrapers._core.ubigeo import ZonaIndex, norm, resolve_ubigeo  # noqa: E402
from backend.scrapers.oece_ocds.pipeline import normalize_release, short_ocid, slug_region  # noqa: E402

SALIDA = Path(__file__).resolve().parents[1] / "test" / "vectores_py.json"
rnd = random.Random(20261014)


def zonas() -> list[tuple[str, str, str, str | None]]:
    with open(RAIZ / "backend" / "db" / "seed" / "zonas.csv", encoding="utf-8") as f:
        return [(r["ubigeo"], r["nivel"], r["nombre"], r["padre_ubigeo"] or None) for r in csv.DictReader(f)]


Z = zonas()
IX = ZonaIndex.from_rows(Z)
DPTOS = [z for z in Z if z[1] == "departamento"]
PROVS = [z for z in Z if z[1] == "provincia"]
DISTS = [z for z in Z if z[1] == "distrito"]
POR_UBIGEO = {z[0]: z for z in Z}


def deformar(nombre: str) -> str:
    """Variantes que trae el OCDS: mayúsculas, sin tildes, guiones, espacios dobles, truncado."""
    s = nombre
    r = rnd.random()
    if r < 0.3:
        s = s.upper()
    elif r < 0.4:
        s = s.lower()
    if rnd.random() < 0.2:
        s = s.replace(" ", "-", 1)
    if rnd.random() < 0.15:
        s = "  " + s.replace(" ", "   ") + " "
    if rnd.random() < 0.15:
        s = s.translate(str.maketrans("ÁÉÍÓÚáéíóúÑñ", "AEIOUaeiouNn"))
    if rnd.random() < 0.1 and len(s) > 12:
        s = s[:19]
    if rnd.random() < 0.04:
        s = s + " X"
    return s


def direccion() -> dict:
    r = rnd.random()
    if r < 0.05:
        return {}
    d = rnd.choice(DISTS)
    p = POR_UBIGEO[d[3]]
    dp = POR_UBIGEO[p[3]]
    out = {"department": deformar(dp[2]), "region": deformar(p[2]), "locality": deformar(d[2])}
    if rnd.random() < 0.08:
        out["locality"] = None
    if rnd.random() < 0.05:
        out["region"] = ""
    if rnd.random() < 0.05:
        out["department"] = "LIMA METROPOLITANA"
    return out


def ruc(tipo: str = "20") -> str:
    return tipo + "".join(rnd.choice("0123456789") for _ in range(9))


def party_comprador() -> dict:
    roles = rnd.choice([["buyer"]] * 4 + [["procuringEntity"], ["buyer", "procuringEntity"], "buyer", None, ["payer"]])
    p: dict = {"name": rnd.choice(["MUNICIPALIDAD DISTRITAL DE PRUEBA", "GOBIERNO REGIONAL EJEMPLO", "Ministerio Ficticio"]), "roles": roles}
    r = rnd.random()
    if r < 0.5:
        p["identifier"] = {"scheme": "PE-RUC", "id": ruc()}
    elif r < 0.7:
        p["additionalIdentifiers"] = [{"scheme": "PE-RUC", "id": ruc()}]
    elif r < 0.8:
        p["identifier"] = {"scheme": "PE-RUC", "id": int(ruc())}
    elif r < 0.9:
        p["identifier"] = {"scheme": "PE-RUC", "id": ruc()[:10]}
    else:
        p["additionalIdentifiers"] = [{"scheme": "OTRO", "id": ruc()}, {"scheme": "PE-RUC", "id": None}]
    p["address"] = direccion()
    return p


def party_proveedor() -> dict:
    r = rnd.random()
    p: dict = {"name": "EMPRESA EJEMPLO S.A.C.", "roles": rnd.choice([["supplier"], ["tenderer"], ["supplier", "tenderer"]])}
    if r < 0.6:
        p["identifier"] = {"scheme": "PE-RUC", "id": "PE-RUC-" + ruc()}
    elif r < 0.8:
        p["additionalIdentifiers"] = [{"scheme": "PE-RUC", "id": ruc()}]
    return p


ESTADOS_ITEM = ["CONVOCADO", "CONSENTIDO", "ADJUDICADO", "CONTRATADO", "DESIERTO", "NULO", "CANCELADO", "APELADO",
                "SUSPENDIDO", "NO_SUSCRIPCION_CONTRATO_POR_DECISION_ENTIDAD", "NO_SUSCRIPCION_CONTRATO POR_DECISION_ENTIDAD",
                "contratado", " Desierto ", "", None]


def item() -> dict:
    it: dict = {"id": str(rnd.randint(1, 9)), "description": "ITEM"}
    if rnd.random() < 0.8:
        it["statusDetails"] = rnd.choice(ESTADOS_ITEM)
    if rnd.random() < 0.8:
        it["quantity"] = rnd.choice([0, 1, 5, 2.5, "2", "abc", None, -1, "1e3", " 3 ", "1_000", "nan", True])
    if rnd.random() < 0.8:
        it["unit"] = rnd.choice([{"name": "UNIDAD"}, {}, None, {"name": ""}])
    if rnd.random() < 0.7:
        it["classification"] = {"id": rnd.choice(["43211500", "72101500", "", None, 12, "7", "80111600", "9ABC", "0000"])}
    if rnd.random() < 0.3:
        it["additionalClassifications"] = [rnd.choice([{"id": "25101500"}, {"id": "81"}, None, {}])]
    return it


def documento() -> dict:
    d = {"documentType": rnd.choice(["biddingDocuments", "awardNotice", "contractSigned", "clarifications", "evaluationReports", None])}
    if rnd.random() < 0.8:
        d["url"] = "https://prod1.seace.gob.pe/archivo?fileCode=abc"
    return d


MODALIDADES = ["Licitación Pública", "Contratación Directa", "Convenio Marco", "Régimen Especial", "Contratación Internacional",
               "Concurso Público de Consultoría", "Adjudicación Simplificada", "Subasta Inversa Electrónica", None, "",
               "  Comparación de Precios  ", "CONVENIO ESPECIAL", "Procedimiento de Consultoría de Obra"]


def release() -> dict:
    rel: dict = {}
    r = rnd.random()
    rel["ocid"] = rnd.choice([f"ocds-dgv273-seacev3-{rnd.randint(1000000, 1300000)}"] * 5 + [
        f"ocds-dgv273-seacev3-2026-{rnd.randint(1000, 99999)}-{rnd.randint(1, 30)}",
        f"ocds-dgv273-seacev2-2012-{rnd.randint(1, 999)}-{rnd.randint(1, 9)}", "ocds-abc-999", "", None, 1234567,
    ]) if r < 0.97 else "ocds-dgv273-seacev3-1234567"
    rel["id"] = f"{rel['ocid']}-{rnd.randint(1, 10)}"
    rel["date"] = rnd.choice([f"2026-10-{rnd.randint(1, 13):02d}T{rnd.randint(0, 23):02d}:00:00Z", "", None])
    rel["tag"] = rnd.choice([[], ["planning"], ["tender"], ["planning", "tender"], ["award"], ["contract"], ["implementation"],
                             ["tender", "award", "contract"], "tender", None, ["compiled"]])
    parties = [party_comprador()]
    if rnd.random() < 0.4:
        parties.append(party_proveedor())
    if rnd.random() < 0.1:
        parties.append(party_comprador())
    rnd.shuffle(parties)
    if rnd.random() < 0.95:
        rel["parties"] = parties
    if rnd.random() < 0.8:
        rel["buyer"] = {"name": rnd.choice(["MUNICIPALIDAD PROVINCIAL EJEMPLO", "", None])}
    t: dict = {"id": rnd.choice([str(rnd.randint(100000, 999999)), "", None])}
    t["title"] = rnd.choice(["ADQUISICION DE BIENES", "Servicio de consultoría de obra para el puente", "", None, "Ejecución de obra"])
    t["description"] = rnd.choice(["Contratación de servicio de mantenimiento — tramo 2 🚧", "", None, "x" * 598 + "🚧🚧🚧", "Consultoría de Obra: supervisión"])
    t["mainProcurementCategory"] = rnd.choice(["goods", "services", "works", None, "GOODS", "otro", ""])
    t["procurementMethodDetails"] = rnd.choice(MODALIDADES)
    t["status"] = rnd.choice([None, None, None, "cancelled", "unsuccessful", "active", "Cancelled"])
    if rnd.random() < 0.85:
        t["items"] = [item() for _ in range(rnd.randint(0, 4))]
    if rnd.random() < 0.7:
        t["documents"] = [documento() for _ in range(rnd.randint(0, 3))]
    if rnd.random() < 0.7:
        t["tenderPeriod"] = rnd.choice([{"startDate": f"2026-10-{rnd.randint(1, 13):02d}T09:00:00-05:00"}, {}, {"startDate": ""}])
    if rnd.random() < 0.4:
        t["datePublished"] = f"2026-09-{rnd.randint(10, 30):02d}T10:00:00Z"
    if rnd.random() < 0.8:
        t["value"] = rnd.choice([{"amount": 1500.5}, {"amount_PEN": 0, "amount": 2000}, {"amount_PEN": 35000.75, "amount": 1},
                                 {"amount": 0}, {}, {"amount": 12345678901234}])
    rel["tender"] = t
    if rnd.random() < 0.35:
        rel["awards"] = rnd.choice([
            [], [{"status": None, "suppliers": [{"id": "PE-RUC-" + ruc()}]}], [{"status": "unsuccessful"}], [{"status": "cancelled"}],
            [{"suppliers": [{"id": "123"}]}, {"status": "active", "suppliers": [{"id": ruc("10")}]}],
            [{"status": "Unsuccessful", "documents": [documento()]}], [{"status": "active", "suppliers": [None, {"id": None}]}],
        ])
    if rnd.random() < 0.3:
        rel["contracts"] = rnd.choice([
            [], [{"status": "terminated"}], [{"implementation": {"transactions": [{"id": 1}]}}], [{"implementation": {}}],
            [{"status": "active", "documents": [documento()]}], [{"implementation": {"milestones": [1]}, "status": "Terminated"}], [None],
        ])
    if rnd.random() < 0.2:
        rel["planning"] = rnd.choice([{}, {"budget": {"amount": 1}}])
    return rel


def seguro(fn, *a, **kw):
    try:
        return {"ok": fn(*a, **kw)}
    except Exception as e:  # noqa: BLE001 — Python lanzó: el port no necesita imitarlo
        return {"error": type(e).__name__}


def a_json(v):
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    raise TypeError(type(v))


def vectores_ocds() -> list[dict]:
    out = []
    for _ in range(500):
        rel = release()
        nulo = rnd.random() < 0.05
        hint = ruc() if rnd.random() < 0.3 else None
        c = seguro(clasificar, rel, entidad_ruc_hint=hint, nulo=nulo)
        out.append({
            "release": rel, "nulo": nulo, "hint": hint,
            "clasificacion": {k: v for k, v in c.items()} if "error" in c else {"ok": c["ok"].as_dict()},
            "fila": seguro(normalize_release, rel, IX),
        })
    return out


def vectores_texto() -> dict:
    textos = ["SAN IGNACIO", "  san   juan de   lurigancho ", "O'HIGGINS", "LIMA-NORTE", "2DO DE MAYO", "ANCASH", "JUNIN",
              "HUANUCO", "ÁNCASH", "1ºDE MAYO", "ñuñoa", "MARISCAL RAMÓN CASTILLA", "", "CORONEL PORTILLO", "ANCASHINO JUNINENSE"]
    textos += [deformar(rnd.choice(Z)[2]) for _ in range(150)]
    ocids = ["ocds-dgv273-seacev3-1212353", "ocds-dgv273-seacev3-2026-10404-12", "ocds-dgv273-seacev2-2012-123-4",
             "ocds-dgv273-seacev1-x", "ocds-abc-def-99", "1212353", "", "ocds-dgv273-seacev3-"]
    return {
        "slug_region": [[t, slug_region(t)] for t in textos],
        "norm": [[t, norm(t)] for t in textos],
        "short_ocid": [[o, short_ocid(o)] for o in ocids],
    }


def vectores_ubigeo() -> list[list]:
    out = []
    for _ in range(800):
        dirn = direccion()
        trio = [dirn.get("department"), dirn.get("region"), dirn.get("locality")]
        out.append([trio, resolve_ubigeo(IX, *trio)])
    out.append([["Lima", "Lima", "San Juan de Lurigancho"], resolve_ubigeo(IX, "Lima", "Lima", "San Juan de Lurigancho")])
    out.append([["CAJAMARCA", "SANTA CRUZ", "SANTA CRUZ DE TOLED"], resolve_ubigeo(IX, "CAJAMARCA", "SANTA CRUZ", "SANTA CRUZ DE TOLED")])
    out.append([[None, None, None], resolve_ubigeo(IX, None, None, None)])
    return out


def vectores_csv() -> list[list]:
    """csv.reader (newline="") sobre textos con comillas, saltos dentro de comillas, \\r sueltos, líneas vacías."""
    import io

    textos = [
        'a;b;c\r\n1;2;3\r\n', 'a;b\n"x;y";z\n', 'a;b\r\n"multi\r\nlínea";2\r\n\r\n3;4', '"abc"def;g\n', 'a;"b""c";d\r',
        'solo\rdos\rlíneas', '"sin cerrar;x\n', ';;\n;\n', '', '\n\n', 'x;"";y\n', 'a;b\r\n;\r\n"";""\r\n', '"a\rb";c\r\n',
    ]
    alfabeto = ['a', 'b', ';', '"', '\n', '\r', '\r\n', ' ', 'ñ', 'x', '""']
    for _ in range(300):
        textos.append("".join(rnd.choice(alfabeto) for _ in range(rnd.randint(0, 40))))
    out = []
    for t in textos:
        try:
            out.append([t, list(csv.reader(io.StringIO(t, newline=""), delimiter=";"))])
        except csv.Error:
            out.append([t, None])
    return out


def vectores_sancionados() -> list[dict]:
    """normalize_csv sobre CSV sintéticos en cp1252 (con bytes que cp1252 no define)."""
    import base64
    import tempfile

    from backend.scrapers.pnda_sancionados.pipeline import normalize_csv

    cab = "INH;NRO;RAZON_SOCIAL;RUC;RESOLUCION;PERIODO_INH;DESDE;HASTA;INFRACCION;OTRA_INFRACCION"
    out = []
    for k in range(12):
        lineas = [cab if k != 3 else "﻿" + cab]
        for _ in range(rnd.randint(1, 25)):
            un_ruc = rnd.choice([ruc(), ruc("10"), "123", "", "20ABC123456", " 20123456789 ", "1234567890"])
            fila = [rnd.choice(["DEFINITIVO", "temporal", "Multa", " TEMPORAL ", "", "OTRO"]), str(rnd.randint(1, 999)),
                    rnd.choice(["CONSTRUCTORA ÁNDES S.A.C.", "Ñandú E.I.R.L.", '"COMILLAS ""DOBLES"" SAC"', "  espacios   raros  ", "EMPRESA; CON PUNTO Y COMA"]),
                    un_ruc, rnd.choice(["RES-123-2025", "", " 0045-2024-TCE-S1 "]), rnd.choice(["36 MESES", "", "  "]),
                    # (sin AAAAMMDD inválidos: Python lanza ValueError y corta toda la carga; el port deja la fecha en null)
                    rnd.choice(["20250115", "15/01/2025", "1/2/2025", "2025-01-15", "", "31/02/2025", "2025-13-01", "20240229"]),
                    rnd.choice(["20280115", "", "15/1/2028", "x"]), rnd.choice(["Art. 50.1 a)", "", "Infracción con tilde"]),
                    rnd.choice(["", "otra", "y otra más"])]
            if "PUNTO Y COMA" in fila[2]:
                fila[2] = f'"{fila[2]}"'
            lineas.append(";".join(fila))
        if k == 5:
            lineas.append("")
        texto = "\r\n".join(lineas) + rnd.choice(["\r\n", "", "\n"])
        datos = texto.encode("cp1252", errors="replace")
        if k % 4 == 0:
            datos += b"20\x81;1;BYTE\x8dRARO;20123456780;R;;;;;\r\n"
        with tempfile.NamedTemporaryFile("wb", suffix=".csv", delete=False) as f:
            f.write(datos)
            nombre = f.name
        try:
            filas = seguro(normalize_csv, Path(nombre))
        finally:
            Path(nombre).unlink()
        if "ok" in filas:
            filas = {"ok": json.loads(json.dumps(filas["ok"], default=a_json))}
        out.append({"csv_b64": base64.b64encode(datos).decode(), "filas": filas})
    return out


def vectores_visitas() -> dict:
    from backend.scrapers.pnda_visitas.pipeline import parse_xlsx
    sys.path.insert(0, str(RAIZ / "backend" / "scripts"))
    from load_visitas_entidades import parse_row

    filas = []
    valores = {
        0: ["31/03/2025", "1/3/2025", "2025-03-31", "", None, "31/02/2025", "03-31-2025", " 31/03/2025 "],
        # Todo inventado: el repo es público y estas filas quedan en test/vectores_py.json.
        2: ["ENTIDAD DE PRUEBA"] * 8 + ["", None, "  Municipalidad Distrital de Ñuñoa\xa0"],
        3: ["VISITANTE DE PRUEBA UNO"] * 8 + ["", None, "VISITANTE\xa0DOS", "Ñato Ávila Ejemplo"],
        4: ["DNI 00000001", "CE 00012345", "PASAPORTE X1", "Pasap. 99", "DNI   0000 0002", "SOLO", "", None, " DNI 1 "],
        5: ["Entidad privada - EMPRESA DE EJEMPLO S.A.C.", "Entidad pública - MINISTERIO - SEDE", "Entidad publica", "Persona natural - a titulo personal",
            "Otra cosa", "", None, "ENTIDAD PRIVADA - X"],
        6: ["FUNCIONARIO EJEMPLO UNO - Oficina Ejecutiva - Jefe", "NOMBRE - Gerente", "SOLO NOMBRE", "A - B - C - D", "Ñato Ávila - Área - ", "", None],
        7: ["19:30", "9:05", "24:00", "19:30:15", "", None, "7:5", "19.30"],
        8: ["20:05", "08:00", "", None, "23:59:59", "0:0"],
        9: ["Otros Motivos", "", None], 10: ["Sede central", "", None], 11: ["Obs.", "", None],
    }
    for _ in range(600):
        largo = rnd.choice([12, 12, 12, 10, 11, 13])
        fila = [rnd.choice(valores.get(i, ["x", "", None])) for i in range(largo)]
        r = seguro(parse_row, tuple(fila))
        filas.append([fila, {"ok": json.loads(json.dumps(r["ok"], default=a_json))} if "ok" in r else r])
    fx = RAIZ / "backend" / "scrapers" / "tests" / "fixtures" / "REPORTE DE REGISTRO DE VISITAS - FEBRERO - 2025.xlsx"
    rows, bad = parse_xlsx(fx)
    return {"filas": filas, "fixture": {"filas": json.loads(json.dumps(rows, default=a_json)), "descartadas": bad}}


def vectores_jne() -> dict:
    from backend.scrapers.jne_infogob.pipeline import _proceso_codigo, normalize_rows, parse_xls

    fx = RAIZ / "backend" / "scrapers" / "tests" / "fixtures" / "autoridades_vigentes_muestra.xls"
    filas = normalize_rows(parse_xls(fx, True), IX, "https://www.datosabiertos.gob.pe/dataset/x")
    procesos = []
    for texto in ["ELECCIONES REGIONALES Y MUNICIPALES 2022", "ELECCIONES GENERALES 2026", "Elecciones Municipales Complementarias 2025",
                  "SEGUNDA ELECCIÓN REGIONAL 2022", "", "REFERÉNDUM NACIONAL 2018", "ALGO SIN AÑO"]:
        for anio in [None, "", 2022.0, "2023", 2026]:
            procesos.append([texto, anio, seguro(_proceso_codigo, texto, anio)])
    return {"fixture": json.loads(json.dumps(filas, default=a_json)), "procesos": procesos}


def main() -> None:
    datos = {"generado": "scripts/vectores_py.py", "ocds": vectores_ocds(), "texto": vectores_texto(), "ubigeo": vectores_ubigeo(),
             "csv": vectores_csv(), "sancionados": vectores_sancionados(), "visitas": vectores_visitas(), "jne": vectores_jne(),
             "cp1252": bytes(range(256)).decode("cp1252", errors="replace")}
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, default=a_json), encoding="utf-8")
    errores = sum(1 for v in datos["ocds"] if "error" in v["fila"] or "error" in v["clasificacion"])
    print(f"✓ {SALIDA.relative_to(RAIZ)} · {len(datos['ocds'])} releases ({errores} donde Python lanzó) · "
          f"{len(datos['ubigeo'])} tríos · {SALIDA.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
