"""Los RUC que lee un modelo: dígito verificador y corrección contra los que el registro ya conoce del proceso.

Medido el 2026-11-18 en PROD: no pasaban el dígito verificador el 6,7 % de los RUC del lector de actas de buena pro
(3 213 de 48 186), el 5,1 % del de garantías y el 2,3 % del de contratos; los agentes, que ya validan
(agent/tools/documentos/entidades.py), el 0,5 %. Un RUC mal leído duplicaba al postor en la ficha del contrato y enlazaba
a una empresa que no existe (1224107: 20608909958 por 20609809958, el del reporte del SEACE, CONOSCE y la SUNAT).

Regla: un RUC válido no se toca. Uno inválido se cambia por el ÚNICO RUC conocido del proceso (postores y adjudicados de
CONOSCE, reportes del SEACE, el proveedor del registro) que esté a una o dos cifras y, si la lectura trae el nombre al lado,
con un nombre parecido (el modelo a veces lee mal también el nombre: «PROMAINSGSA» por «PROMAINGSA»); si no, queda en null.
Sin la guarda del nombre, 371 de 409 correcciones de una muestra caían en la misma empresa y unas 10 en otra. Lo leído se guarda en `_rucs_corregidos` / `_rucs_invalidos` de la salida (las
claves con «_» no las lee nadie más y el oro de extracción las salta).
"""
from __future__ import annotations

from difflib import SequenceMatcher
import re
import unicodedata
from typing import Any, Iterable

PESOS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)

SQL_CONOCIDOS = r"""
SELECT o.ocid, x.r, max(x.nombre)
  FROM unnest(%(ocids)s::text[]) AS o(ocid)
  JOIN convocatorias c ON c.ocid = o.ocid
 CROSS JOIN LATERAL (
   SELECT p.ruc_postor AS r, p.postor AS nombre FROM conosce_postores p WHERE p.codigo_convocatoria = c.codigo
   UNION SELECT a.ruc_proveedor, a.proveedor FROM conosce_adjudicaciones a WHERE a.codigo_convocatoria = c.codigo
   UNION SELECT pp.codigo, pp.nombre FROM proceso_postor pp WHERE ocid_corto(pp.ocid) = ocid_corto(c.ocid)
   UNION SELECT c.proveedor_ruc::text, NULL) x
 WHERE x.r ~ '^\d{11}$'
 GROUP BY 1, 2
"""


def digitos(v: Any) -> str:
    return "".join(ch for ch in str(v) if ch.isdigit()) if isinstance(v, (str, int)) else ""


def ruc_valido(ruc: Any) -> bool:
    """RUC de 11 dígitos con su dígito verificador (módulo 11, pesos 5432765432)."""
    r = digitos(ruc)
    if len(r) != 11 or r[:2] not in ("10", "15", "16", "17", "20"):
        return False
    c = 11 - sum(int(d) * w for d, w in zip(r[:10], PESOS)) % 11
    return {10: 0, 11: 1}.get(c, c) == int(r[10])


def cerca(a: str, b: str) -> bool:
    """A una o dos cifras (dos vecinas cambiadas de lugar también son dos): lo que hace un modelo o un OCR. Entre los pocos
    RUC conocidos de un proceso, dos a esa distancia de lo leído casi no pasa, y entonces no se corrige."""
    return len(a) == len(b) and 1 <= sum(x != y for x, y in zip(a, b)) <= 2


def conocidos(cur, ocids: Iterable[str]) -> dict[str, dict[str, str | None]]:
    """{ocid: {RUC: nombre} que el registro conoce de ese proceso}, para muchos procesos en una consulta."""
    lista = sorted({o for o in ocids if o})
    out: dict[str, dict[str, str | None]] = {o: {} for o in lista}
    if lista:
        cur.execute(SQL_CONOCIDOS, {"ocids": lista})
        for ocid, r, nombre in cur.fetchall():
            out.setdefault(ocid, {})[r] = nombre
    return out


# La forma societaria y las palabras que comparten miles de empresas: «PORFISA CONTRATISTAS GENERALES» y «PRECYSSA
# CONTRATISTAS GENERALES» se parecían sólo por ellas.
_FORMAS = re.compile(r"\b(S ?A ?C|S ?R ?L|E ?I ?R ?L|S ?A ?A|S ?A|SOCIEDAD|ANONIMA|CERRADA|COMERCIAL|DE|RESPONSABILIDAD|LIMITADA|DEL|LA|EL|Y"
                     r"|GRUPO|CORPORACION|PERU|CONTRATISTAS|GENERALES|SERVICIOS|INVERSIONES|EMPRESA|CONSTRUCTORA|CONSULTORA"
                     r"|INGENIERIA|NEGOCIACIONES|MULTISERVICIOS|DISTRIBUIDORA|IMPORTACIONES|EXPORTACIONES|INDUSTRIAS|CONSORCIO)\b")


def _plano(t: Any) -> str:
    t = unicodedata.normalize("NFD", str(t or "").upper())
    t = "".join(c if c.isalnum() else " " for c in t if not unicodedata.combining(c))
    return " ".join(_FORMAS.sub(" ", t).split())


def parecido(a: Any, b: Any) -> bool:
    """Dos nombres de la misma empresa aunque uno esté mal leído: sin la forma societaria ni las palabras de todos, 75 % de
    los caracteres («ICAN PERUANA» / «IGAN PERUANA» sí; «ALIMENTARIA» / «ALIMENTARIAS ALCIDES», 0,71, no). En la duda el
    RUC queda en null, que no enlaza a otra empresa."""
    x, y = _plano(a), _plano(b)
    return bool(x and y) and (x == y or SequenceMatcher(None, x, y).ratio() >= 0.75)


def _es_clave_ruc(k: str) -> bool:
    return k == "ruc" or k.endswith("_ruc") or k.startswith("ruc_")


def corregir(salida: Any, conocidos_del_proceso: dict[str, str | None] | set[str]) -> tuple[Any, int, int]:
    """Cambia en su lugar los RUC inválidos de la salida de un lector. Devuelve (salida, corregidos, anulados)."""
    corregidos: list[dict] = []
    invalidos: list[str] = []
    nombres = conocidos_del_proceso if isinstance(conocidos_del_proceso, dict) else dict.fromkeys(conocidos_del_proceso)
    validos = {r: n for r, n in nombres.items() if ruc_valido(r)}

    def andar(o: Any) -> None:
        if isinstance(o, dict):
            for k in list(o):
                v = o[k]
                if isinstance(k, str) and _es_clave_ruc(k) and isinstance(v, (str, int)) and not isinstance(v, bool):
                    r = digitos(v)
                    if len(r) == 11 and not ruc_valido(r):
                        # El nombre que la lectura pone junto al RUC, si lo trae: el candidato tiene que parecérsele.
                        junto = next((o[x] for x in ("nombre", "razon_social", "postor", "proveedor", "contratista")
                                      if isinstance(o.get(x), str) and o.get(x).strip()), None)
                        candidatos = [c for c, n in validos.items() if cerca(r, c) and (junto is None or n is None or parecido(junto, n))]
                        if len(candidatos) == 1:
                            o[k] = candidatos[0]
                            corregidos.append({"leido": r, "ruc": candidatos[0]})
                        else:
                            o[k] = None
                            invalidos.append(r)
                elif not (isinstance(k, str) and k.startswith("_rucs_")):
                    andar(v)
        elif isinstance(o, list):
            for x in o:
                andar(x)

    andar(salida)
    if isinstance(salida, dict):
        if corregidos:
            salida["_rucs_corregidos"] = (salida.get("_rucs_corregidos") or []) + corregidos
        if invalidos:
            salida["_rucs_invalidos"] = (salida.get("_rucs_invalidos") or []) + invalidos
    return salida, len(corregidos), len(invalidos)
