"""Segunda mirada a las marcas de un requerimiento de contrato menor: ¿la marca es la que se EXIGE para lo que se compra,
o es la del equipo que la entidad ya tiene?

Las dos lecturas del requerimiento (menor_tdr v1 y v1-2) coinciden en que el documento nombra una marca sin «o
equivalente», pero eso solo no es una señal: un tóner para la impresora Kyocera de la oficina, el mantenimiento de un
camión FAW o el soporte de un servidor Unity 300 tienen que nombrar la marca del equipo. En una muestra de PROD
(2026-11-05) más de la mitad de las 897 banderas eran así. Este lector mira SÓLO el texto ya extraído (el objeto, los
ítems y la cita de cada marca, sin bajar el PDF), clasifica cada marca y guarda el resultado como menor_tdr «v1-m» en
menor_lectura; refrescar_menor_senales() (migración 252) publica tdr_marca_sin_equivalente sólo si aquí queda al menos
una marca exigida para lo que se compra, y cita sólo esas.

Va después de la segunda lectura del requerimiento (leer_menores.sh). Cuesta ~USD 0,0003 por contrato.

  python -X utf8 backend/lector/menor_marcas.py prod [--tope-usd 2] [--hilos 4] [--limite N] [--todos]
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lector.base import cliente_claude, costo_usd, norma  # noqa: E402
from lector.leer import MODELO, Base  # noqa: E402

CLASE, VERSION = "menor_tdr", "v1-m"
BANDERA = "tdr_marca_sin_equivalente"
ROLES = ["exigida", "equipo_existente", "referencia", "no_es_marca"]

SISTEMA = """Eres un analista de contrataciones públicas del Perú. Recibes lo que una entidad pidió en una contratación
menor (hasta 8 UIT): el objeto, los ítems y cada marca, fabricante o modelo que nombra su requerimiento, con la frase
copiada del documento. Para cada marca decide su papel:

- exigida: lo que se compra (el bien, o lo que el servicio entrega) tiene que ser de esa marca o modelo, y otra marca
  quedaría fuera. Ej.: «Laptop marca HP», «refrigerante VISTONY», «tableta iPad Pro».
- equipo_existente: la marca es la de un equipo, vehículo, maquinaria, sistema o software que la entidad YA tiene, y lo
  que se compra es para él: consumible, repuesto, accesorio compatible, mantenimiento, reparación, soporte, operador,
  licencia, ampliación o un desarrollo que corre sobre esa plataforma. Ej.: «tóner para impresora Kyocera TK-1175»,
  «mantenimiento del camión grúa, marca FAW», «soporte del servidor Unity 300», «despliegue en Oracle WebLogic 12c»,
  «operador para tractor CAT D6T».
- referencia: no restringe: un ejemplo, un estándar o norma técnica, un número de parte de un componente genérico, o una
  frase que no exige una marca (p. ej. «deberá indicar la marca ofertada»).
- no_es_marca: no es una marca, un fabricante ni un modelo.

Si la frase dice que lo nombrado es lo que la entidad ya usa o tiene, es equipo_existente. Un consumible o repuesto con el
código de su equipo (tóner HP 58X CF258X, cartucho Epson T664, tambor Kyocera DK-1150, filtro de un motor) es
equipo_existente aunque el documento no lo diga: ese código sólo sirve en el equipo que la entidad ya tiene. Una red
social, plataforma o servicio público donde se publica o se accede (Facebook, YouTube, el sistema de una entidad del
Estado) es referencia, no una marca exigida. Ante la duda entre exigida y
equipo_existente, elige equipo_existente sólo si el objeto o los ítems muestran que se compra algo PARA ese equipo.
por_que: una frase corta, en español, sin nombres de personas."""

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["marcas"],
    "properties": {
        "marcas": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["n", "rol", "por_que"],
                "properties": {"n": {"type": "integer"}, "rol": {"type": "string", "enum": ROLES},
                               "por_que": {"type": "string"}},
            },
        }
    },
}

# Los requerimientos cuyas dos lecturas coinciden en la bandera; sin --todos, sólo los que aún no tienen esta mirada.
PENDIENTES = """
SELECT a.id_contrato, m.descripcion, a.salida
  FROM menor_lectura a
  JOIN menor_lectura z ON z.id_contrato = a.id_contrato AND z.clase = a.clase AND z.version = 'v1-2' AND z.estado = 'ok'
  JOIN seace_menores m ON m.id_contrato = a.id_contrato
 WHERE a.clase = 'menor_tdr' AND a.version = 'v1' AND a.estado = 'ok'
   AND %(bandera)s = ANY (a.banderas) AND %(bandera)s = ANY (z.banderas)
   {extra}
 ORDER BY m.monto DESC
"""
SIN_MIRADA = """AND NOT EXISTS (SELECT 1 FROM menor_lectura x WHERE x.id_contrato = a.id_contrato AND x.clase = 'menor_tdr'
                                     AND x.version = 'v1-m' AND x.estado = 'ok')"""

GUARDAR = """
INSERT INTO menor_lectura (id_contrato, clase, version, modelo, paginas, estado, salida, banderas, tokens_in, tokens_out,
                           costo_usd, detalle, leido_at)
VALUES (%(id)s, %(clase)s, %(version)s, %(modelo)s, NULL, %(estado)s, %(salida)s, %(banderas)s, %(tokens_in)s,
        %(tokens_out)s, %(costo_usd)s, %(detalle)s, now())
ON CONFLICT (id_contrato, clase, version) DO UPDATE SET
  modelo = EXCLUDED.modelo, estado = EXCLUDED.estado, salida = EXCLUDED.salida, banderas = EXCLUDED.banderas,
  tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out, costo_usd = EXCLUDED.costo_usd,
  detalle = EXCLUDED.detalle, leido_at = now()
"""


def marcas_sin_equivalente(salida: dict) -> list[dict]:
    """Las marcas sin «o equivalente» de la lectura v1, una vez cada una (por su nombre normalizado)."""
    vistas, out = set(), []
    for k in salida.get("marcas") or []:
        marca, cita = (k.get("marca") or "").strip(), (k.get("cita") or "").strip()
        if k.get("con_equivalente") or not marca or not cita or norma(marca) in vistas:
            continue
        vistas.add(norma(marca))
        out.append({"marca": marca[:120], "cita": cita[:400]})
    return out[:12]


def pedido(objeto: str | None, salida: dict, marcas: list[dict]) -> str:
    items = [str(i.get("descripcion") or i.get("item") or "")[:160] for i in (salida.get("items") or [])
             if isinstance(i, dict)][:15]
    partes = [f"Objeto registrado: {(objeto or '').strip()[:300]}",
              f"Objeto según el requerimiento: {str(salida.get('objeto') or '')[:300]}",
              f"Para qué: {str(salida.get('finalidad') or '')[:300]}"]
    if items:
        partes.append("Ítems:\n" + "\n".join(f"- {t}" for t in items if t))
    partes.append("Marcas que nombra (n, marca, frase del documento):\n"
                  + "\n".join(f"{n}. {k['marca']}: «{k['cita']}»" for n, k in enumerate(marcas, 1)))
    return "\n\n".join(partes)


def clasificar(claude, idc: int, objeto: str | None, salida: dict) -> dict:
    marcas = marcas_sin_equivalente(salida)
    fila = {"id": idc, "clase": CLASE, "version": VERSION, "modelo": MODELO, "tokens_in": 0, "tokens_out": 0,
            "costo_usd": 0, "detalle": None, "banderas": []}
    if not marcas:
        return {**fila, "estado": "ok", "salida": json.dumps({"marcas": []})}
    r = claude.messages.create(model=MODELO, max_tokens=4000, system=SISTEMA,
                               messages=[{"role": "user", "content": pedido(objeto, salida, marcas)}],
                               output_config={"effort": "medium", "format": {"type": "json_schema", "schema": ESQUEMA}})
    u = r.usage
    fila.update(modelo=r.model, tokens_in=u.input_tokens, tokens_out=u.output_tokens,
                costo_usd=costo_usd(r.model, u.input_tokens, u.output_tokens))
    if r.stop_reason in ("refusal", "max_tokens"):
        return {**fila, "estado": "rechazo" if r.stop_reason == "refusal" else "truncada", "salida": None}
    texto = next((b.text for b in r.content if b.type == "text"), "")
    try:
        juicio = {int(j["n"]): j for j in json.loads(texto).get("marcas") or []}
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return {**fila, "estado": "json_invalido", "salida": None, "detalle": texto[:300]}
    # Una marca sin juicio no se publica: el silencio del modelo no es una señal.
    salida_m = [{**k, "rol": juicio.get(n, {}).get("rol", "sin_juicio"), "por_que": str(juicio.get(n, {}).get("por_que", ""))[:240]}
                for n, k in enumerate(marcas, 1)]
    return {**fila, "estado": "ok", "salida": json.dumps({"marcas": salida_m}, ensure_ascii=False),
            "banderas": [BANDERA] if any(k["rol"] == "exigida" for k in salida_m) else []}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--tope-usd", type=float, default=2.0)
    ap.add_argument("--hilos", type=int, default=4)
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--todos", action="store_true", help="volver a mirar también los que ya tienen v1-m")
    ap.add_argument("--sin-refrescar", action="store_true")
    a = ap.parse_args()
    base = Base(a.entorno)
    filas = base.hacer(lambda cur: (cur.execute(PENDIENTES.format(extra="" if a.todos else SIN_MIRADA), {"bandera": BANDERA}),
                                    cur.fetchall())[1])[: a.limite or None]
    print(f"{a.entorno}: {len(filas)} requerimientos con marca sin «o equivalente» por mirar", flush=True)
    claude, candado = cliente_claude(), threading.Lock()
    gastado, hechos, cuenta, t0 = 0.0, 0, {}, time.time()
    with ThreadPoolExecutor(max_workers=a.hilos) as pool:
        futuros = {}
        it = iter(filas)

        def mandar() -> bool:
            f = next(it, None)
            if f is None or gastado >= a.tope_usd:
                return False
            futuros[pool.submit(clasificar, claude, f[0], f[1], f[2] or {})] = f[0]
            return True

        for _ in range(a.hilos * 2):
            mandar()
        while futuros:
            fut = next(as_completed(futuros))
            idc = futuros.pop(fut)
            try:
                fila = fut.result()
            except Exception as e:  # noqa: BLE001 — uno que falla no para a los demás
                print(f"  {idc}: error {str(e)[:160]}", flush=True)
                cuenta["error"] = cuenta.get("error", 0) + 1
                mandar()
                continue
            base.hacer(lambda cur, f=fila: cur.execute(GUARDAR, f))
            with candado:
                gastado += float(fila["costo_usd"] or 0)
                hechos += 1
                cuenta[fila["estado"]] = cuenta.get(fila["estado"], 0) + 1
                cuenta["con_bandera"] = cuenta.get("con_bandera", 0) + bool(fila["banderas"])
            if hechos % 50 == 0 or hechos <= 3:
                print(f"  {hechos}/{len(filas)} USD {gastado:.3f} {round(time.time() - t0)} s {cuenta}", flush=True)
            mandar()
    print(f"FIN {CLASE} {VERSION}: {hechos} requerimientos, USD {gastado:.3f}, {cuenta}", flush=True)
    if not a.sin_refrescar and hechos:
        n = base.hacer(lambda cur: (cur.execute("SELECT refrescar_menor_senales()"), cur.fetchone()[0])[1])
        print(f"refrescar_menor_senales(): {n} señales", flush=True)


if __name__ == "__main__":
    main()
