"""
Genera frontend/lib/tildes.ts: las tildes que pierden los textos del SEACE, el MEF y CONOSCE escritos en MAYÚSCULAS.

En los textos de CONOSCE que SÍ usan tildes se cuenta cómo se escribe cada palabra. Las del vocabulario que se muestra
(nombres del MEF, procesos recientes, entidades) que van con tilde al menos 6 de cada 10 veces (y 8 veces o más) entran
al diccionario, más una lista revisada a mano (MANUAL). Las que terminan en consonante + "ion" las cubre una regla en
el módulo y no van a la lista. Sólo lee la base:

    DSN=postgresql://usuario:clave@host/vigia python backend/scripts/generar_tildes.py
"""
import collections
import os
import re
import sys
import textwrap
import unicodedata

import psycopg2

sys.stdout.reconfigure(encoding="utf-8")

# Errores de tipeo y cortes que aparecen con tilde en los datos, y las que son ambiguas (futuro / subjuntivo).
FUERA = {"codi", "omicas", "hualcara", "cahuac", "participara", "atendera", "pizon", "tencion", "jecucion", "ejecucicon",
         "eduacion", "adqusicion", "aquisicion", "adquision", "adquisiscion", "intalacion", "apliacion", "tenico", "huampon"}
# Lugares, apellidos y palabras frecuentes que en los datos van con tilde menos de 6 de cada 10 veces.
MANUAL = """junín apurímac huánuco martín áncash marañón morropón celendín bolívar virú camaná belén rímac contumazá bongará purús
huamalíes iparía chepén mórrope túcume huasmín aguaytía sayán paiján oyotún tumbadén pacarán lunahuaná pucalá tumán cospán
porcón awajún huachón canaán jerusalén gabán asís josé maría sánchez andrés víctor román cáceres jesús cristóbal jerónimo ramón
sebastián ángeles rodríguez huamán mariátegui chávez raúl simón bermúdez gálvez guzmán hipólito fátima garcía bárbara frías elías
núñez barrón bartolomé valcárcel piérola leguía león butrón antón vásquez sáenz joaquín márquez gutiérrez soberón fernández
valentín inés néstor martínez gómez díaz jiménez álvarez domínguez pérez gonzález ramírez hernández
máquinas vías caserío caseríos diagnóstico prácticas técnicas perimétrico consultorías ítem ítems múltiples recién petróleo
módulo términos líquido maíz pedagógica hidráulica lácteos héroes corazón ferretería médica biomédicos depósito crónicas
artesanía categoría cívica buzón cómputo márgenes jardín auditorías secretaría ácido doméstica pórtico vacío terapéuticas
obstétrica apícola apícolas ecológicos túnel hormigón sódico olímpica oncológicos alcaldía dúctil atún poliéster láser ciclovía
cítricos multipropósito tomógrafo césped amazonía adoquín estomatológica oxígeno sífilis veintiséis próstata ecógrafo
graderías mamógrafo laparoscópica flúor catiónica eslabón gavión trébol criminalística hemoglobinómetro orquídeas cóndor
pontón américas jirón común específico ajonjolí""".split()

TOK = re.compile(r"[^\W\d_]+", re.U)
TIL = re.compile(r"[ÁÉÍÓÚáéíóú]")
REGLA = re.compile(r"[^aeiou]ion$")


def sin_tilde(w: str) -> str:
    """Sin tildes ni diéresis; la ñ se conserva."""
    d = unicodedata.normalize("NFD", w)
    return unicodedata.normalize("NFC", "".join(ch for ch in d if unicodedata.category(ch) != "Mn" or ch == "̃"))


def main() -> None:
    c = psycopg2.connect(os.environ["DSN"], options="-c statement_timeout=600000")
    c.set_session(readonly=True)
    cur = c.cursor()
    cuenta: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for col in ("descripcion_proceso", "descripcion_item"):
        cur.execute(f"SELECT DISTINCT {col} FROM conosce_adjudicaciones WHERE {col} ~ '[ÁÉÍÓÚáéíóú]'")
        for (t,) in cur:
            for w in TOK.findall((t or "").lower()):
                if len(w) >= 3:
                    cuenta[sin_tilde(w)][w] += 1
    vocab: collections.Counter = collections.Counter()
    for sql in ("SELECT nombre FROM mef_ejecutora_gasto WHERE anio = (SELECT max(anio) FROM mef_ejecutora_gasto)",
                "SELECT DISTINCT descripcion_proceso FROM conosce_adjudicaciones WHERE anio >= 2024",
                "SELECT DISTINCT entidad FROM conosce_adjudicaciones"):
        cur.execute(sql)
        for (t,) in cur:
            for w in TOK.findall((t or "").lower()):
                if len(w) >= 3 and not TIL.search(w):
                    vocab[w] += 1
    palabras = set(MANUAL)
    for w in vocab:
        cs = cuenta.get(w)
        if not cs or w in FUERA or REGLA.search(w):
            continue
        con = [(s, k) for s, k in cs.items() if TIL.search(s)]
        if not con:
            continue
        s, k = max(con, key=lambda x: x[1])
        if k >= 8 and k / sum(cs.values()) >= 0.6:
            palabras.add(s)
    por_clave = {sin_tilde(p): unicodedata.normalize("NFC", p) for p in sorted(palabras)}
    lista = "\n".join(textwrap.wrap(" ".join(sorted(por_clave.values())), 116))
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "frontend", "lib", "tildes.ts")
    actual = open(destino, encoding="utf-8").read()
    ini = actual.index("const PALABRAS = `\n") + len("const PALABRAS = `\n")
    fin = actual.index("\n`;", ini)
    nuevo = actual[:ini] + lista + actual[fin:]
    nuevo = re.sub(r"en los [\d,.]+ casos de abajo", f"en los {len(por_clave):,} casos de abajo", nuevo)
    open(destino, "w", encoding="utf-8", newline="\n").write(nuevo)
    print(f"{len(por_clave)} palabras → {destino}")


if __name__ == "__main__":
    main()
