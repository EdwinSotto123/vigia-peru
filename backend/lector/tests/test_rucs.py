"""Los RUC que lee un modelo (lector/rucs.py): dígito verificador y corrección contra los conocidos del proceso.

  python -m pytest backend/lector/tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import rucs  # noqa: E402


def test_digito_verificador():
    assert rucs.ruc_valido("20609809958")          # ENERSAFE, el del reporte del SEACE
    assert not rucs.ruc_valido("20608909958")      # el que leyó el modelo en 1224107 (dos cifras cambiadas de lugar)
    assert rucs.ruc_valido("20501887286") and not rucs.ruc_valido("20501867286")
    assert not rucs.ruc_valido("2050188728") and not rucs.ruc_valido("PE-RUC-x") and not rucs.ruc_valido(None)


def test_corrige_con_el_unico_conocido_cercano():
    salida = {"postores": [{"nombre": "ENERSAFE S.A.C.", "ruc": "20608909958"},
                           {"nombre": "AREM PERU S.A.C.", "ruc": "20532371342"}],
              "ganador": {"ruc": "20532371342"}}
    salida, corregidos, anulados = rucs.corregir(salida, {"20609809958", "20532371342"})
    assert (corregidos, anulados) == (1, 0)
    assert salida["postores"][0]["ruc"] == "20609809958"
    assert salida["postores"][1]["ruc"] == "20532371342"            # los válidos no se tocan
    assert salida["_rucs_corregidos"] == [{"leido": "20608909958", "ruc": "20609809958"}]


def test_sin_conocido_cercano_queda_en_null():
    salida = {"contratista": {"ruc": "20608909958", "nombre": "X"}, "entidad_ruc": "20131257750"}
    salida, corregidos, anulados = rucs.corregir(salida, {"20100070970"})
    assert (corregidos, anulados) == (0, 1)
    assert salida["contratista"]["ruc"] is None
    assert salida["_rucs_invalidos"] == ["20608909958"]
    assert salida["entidad_ruc"] == "20131257750"                   # válido, aunque no sea del proceso


def test_nombre_distinto_no_se_corrige():
    # El único conocido cercano es OTRA empresa (caso real de la muestra: una persona natural «corregida» a CADDIN S.A.C.).
    salida = {"postores": [{"nombre": "INTERNATIONAL LOGISTIC GROUP PERU S.A.C.", "ruc": "20608909958"}]}
    salida, corregidos, anulados = rucs.corregir(salida, {"20609809958": "CORPORACION ETZA S.A.C."})
    assert (corregidos, anulados) == (0, 1) and salida["postores"][0]["ruc"] is None
    # El nombre también mal leído, pero parecido: sí.
    salida = {"postores": [{"nombre": "PROMAINSGSA S.A.C.", "ruc": "20608909958"}]}
    assert rucs.corregir(salida, {"20609809958": "PROMAINGSA S.A.C."})[1] == 1
    assert rucs.parecido("MADERERA F.M. S.R.L.", "MADERERA FM SRL") and not rucs.parecido("ROYRICH", "CADDIN")


def test_dos_conocidos_cercanos_no_se_adivina():
    # Los dos son válidos y están a dos cifras de lo leído: no hay uno solo, no se corrige.
    leido, a, b = "20608909958", "20609809958", "20608909908"
    assert rucs.ruc_valido(a) and rucs.ruc_valido(b) and rucs.cerca(leido, a) and rucs.cerca(leido, b)
    salida, corregidos, anulados = rucs.corregir({"ruc": leido}, {a, b})
    assert (corregidos, anulados) == (0, 1) and salida["ruc"] is None
