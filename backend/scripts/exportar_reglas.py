"""
Exporta las reglas deterministas por perfil (backend/agent/agents/_shared/profiles.py) a un
JSON estático que la API sirve en `GET /financiamiento/procesamientos/reglas?perfil=` para que
/auditoria/[ocid] pueda listar "N reglas evaluadas · M señales" (las que corrieron y NO
dispararon incluidas). La API no importa Python: se regenera este archivo al cambiar perfiles.

    cd backend && python scripts/exportar_reglas.py            # escribe api/src/data/reglas.json
    cd backend && python scripts/exportar_reglas.py --check    # 0 si el JSON está al día, 1 si no

Las etiquetas en español viven acá (no en profiles.py) porque son texto de interfaz.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]           # backend/
sys.path.insert(0, str(RAIZ / "agent"))
from agents._shared.profiles import PROFILES, AGENTES_CANONICOS  # noqa: E402

DESTINO = RAIZ / "api" / "src" / "data" / "reglas.json"

# Etiqueta corta + qué comprueba, en lenguaje claro (nunca "corrupto": son señales de riesgo).
ETIQUETAS: dict[str, tuple[str, str]] = {
    "unico_postor_alto": ("Único postor con oferta alta", "Un solo postor y la oferta cerca del valor referencial (≥ 95 %)."),
    "proveedor_sancionado_osce": ("Proveedor con sanción OSCE/OECE", "El ganador o sus consorciados tienen sanción vigente en el registro de inhabilitados."),
    "procedimiento_no_competitivo": ("Procedimiento no competitivo", "Contratación directa o método sin competencia cuando el monto permitía convocar."),
    "plazo_convocatoria_minimo": ("Plazo de convocatoria muy corto", "Días entre la convocatoria y la presentación de ofertas por debajo del mínimo legal."),
    "tipo_proceso_vs_monto": ("Procedimiento vs. monto", "El tipo de procedimiento no corresponde al monto según los topes en UIT."),
    "cuantia_al_limite_del_tope": ("Cuantía al límite del tope", "El monto queda apenas por debajo del tope que obligaría a un procedimiento más exigente."),
    "directa_sin_fundamento": ("Contratación directa sin sustento", "La causal invocada no aparece fundamentada en el expediente."),
    "directa_emergencia_sin_acto_resolutivo": ("Directa por emergencia sin resolución", "Se invocó emergencia sin el acto resolutivo que la aprueba."),
    "directa_causal_imprecisa": ("Causal de directa imprecisa", "La causal citada no coincide con ninguna del reglamento."),
    "directa_recurrente": ("Contratación directa recurrente", "La entidad repite contrataciones directas con el mismo proveedor."),
    "ruc_ganador_muy_nuevo": ("RUC del ganador muy reciente", "La empresa ganadora se constituyó pocos meses antes de la convocatoria."),
    "ruc_ultra_nuevo": ("Postor con RUC ultra reciente", "Algún postor tiene RUC de menos de 90 días."),
    "ciiu_vs_objeto": ("Giro del proveedor vs. objeto", "La actividad económica declarada en SUNAT no guarda relación con lo contratado."),
    "concentracion_entidad": ("Concentración en la entidad", "El proveedor acumula una porción muy alta de las adjudicaciones de la entidad."),
    "firmante_vinculado_ganador": ("Firmante vinculado al ganador", "Quien firma por la entidad aparece vinculado a la empresa ganadora en otros procesos."),
    "firmante_con_empresa_rnp": ("Firmante con empresa en el RNP", "Un firmante del expediente figura como socio o representante de una proveedora del Estado."),
    "testaferro_multi_ruc": ("Misma persona en varios RUC", "Una persona figura como representante de varias empresas que compiten entre sí."),
    "postor_unico_mayoritario": ("Postor mayoritario en la entidad", "Un mismo postor gana la mayoría de los procesos de la entidad."),
    "postores_vinculados_rnp": ("Postores vinculados entre sí", "Socios o representantes compartidos entre postores rivales según el RNP."),
    "inconsistencia_doc_vs_ocds": ("Documento vs. registro OCDS", "Lo que dicen los documentos no coincide con el registro oficial (montos, fechas, ganador)."),
    "lobby_visits_pre_convocatoria": ("Visitas previas a la convocatoria", "Representantes del postor visitaron la entidad antes de la convocatoria (registro de visitas)."),
    "oferta_igual_valor_referencial": ("Oferta igual al valor referencial", "La oferta ganadora coincide exactamente con el valor referencial."),
    "ofertas_agrupadas": ("Ofertas agrupadas", "Las ofertas de los postores están sospechosamente cerca entre sí."),
    "unica_oferta_valida": ("Única oferta válida", "Varios postores, pero todos menos uno fueron descalificados."),
    "ganador_no_invitado": ("Ganador no invitado", "En comparación de precios, ganó un proveedor que no estaba entre los invitados."),
    "oferta_mas_barata_no_gana": ("La oferta más barata no ganó", "Se adjudicó a una oferta más cara sin justificación registrada."),
    "fecha_buena_pro_incoherente": ("Fechas de buena pro incoherentes", "La buena pro se otorgó antes del cierre de ofertas o con fechas contradictorias."),
    "ampliacion_denegada_penalidad": ("Ampliación denegada y penalidad", "Se denegó la ampliación de plazo y se aplicó penalidad en condiciones que ameritan revisión."),
    "fraccionamiento": ("Fraccionamiento", "Compras partidas en varios procesos pequeños que juntas superan el tope de un procedimiento mayor."),
    "personal_clave_vinculado": ("Personal clave vinculado", "El personal clave exigido coincide con personas ligadas al proveedor o la entidad."),
    "adicional_acumulado": ("Adicionales acumulados", "Los adicionales de obra acumulados superan el porcentaje que exige nueva aprobación."),
}

# Señales que emiten los agentes LLM (no son reglas deterministas del perfil, pero aparecen como banderas).
OTRAS_SENALES: dict[str, tuple[str, str]] = {
    "red_flag_documental": ("Requisito dirigido en las bases", "El análisis legal halló especificaciones o requisitos que convergen en un solo proveedor."),
    "objeto_no_corresponde_documento": ("Objeto vs. documentos", "El objeto convocado no corresponde a lo que describen los documentos del expediente."),
    "sobreprecio_elevado": ("Sobreprecio frente al mercado", "Los precios unitarios superan con holgura la mediana de mercado hallada."),
    "cobertura_prensa_adversa": ("Cobertura de prensa adversa", "Prensa verificable reporta problemas del proveedor o del proceso."),
    "antecedentes_proveedor": ("Antecedentes del proveedor", "Investigación web con hallazgos verificables sobre la empresa."),
    "funcionario_con_historial_politico": ("Funcionario con historial político", "Funcionario de la entidad con vínculo político registrado con el proveedor."),
    "red_personas_vinculada": ("Red de personas vinculada", "Personas del proveedor y de la entidad conectadas por empresas o cargos previos."),
}


def construir() -> dict:
    perfiles = {}
    for nombre, p in PROFILES.items():
        reglas = sorted(p.reglas_activas)
        perfiles[nombre] = {
            "agentes": list(p.agentes),
            "market_estrategia": p.market_estrategia,
            "parse_max_docs": p.parse_max_docs,
            "reglas": [
                {"id": r, "etiqueta": ETIQUETAS.get(r, (r.replace("_", " ").capitalize(), ""))[0],
                 "descripcion": ETIQUETAS.get(r, ("", ""))[1]}
                for r in reglas
            ],
        }
    version = _git_short() or date.today().isoformat()
    return {
        "version": version,
        "generado_at": date.today().isoformat(),
        "agentes_canonicos": list(AGENTES_CANONICOS),
        "perfiles": perfiles,
        "otras_senales": {k: {"etiqueta": v[0], "descripcion": v[1]} for k, v in OTRAS_SENALES.items()},
    }


def _git_short() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=RAIZ, timeout=5)
        return out.stdout.strip() or None
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    data = construir()
    texto = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        actual = DESTINO.read_text(encoding="utf-8") if DESTINO.exists() else ""
        # Se compara sin versión/fecha: solo el contenido de las reglas.
        strip = lambda t: "\n".join(l for l in t.splitlines() if '"version"' not in l and '"generado_at"' not in l)
        return 0 if strip(actual) == strip(texto) else 1
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(texto, encoding="utf-8")
    n = sum(len(p["reglas"]) for p in data["perfiles"].values())
    print(f"reglas.json escrito: {len(data['perfiles'])} perfiles · {n} reglas · version {data['version']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
