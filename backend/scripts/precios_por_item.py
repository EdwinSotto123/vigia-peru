#!/usr/bin/env python3
"""Precio de referencia por ítem con un agente que itera sobre la herramienta `consultar_precios_referencia`
(vigia-precios): por cada ítem prueba términos, descarta lo que no es el bien y elige los precios equivalentes en la
unidad del ítem. El promedio, la mediana y el valor de mercado (cantidad × precio) se calculan en código.

    python backend/scripts/precios_por_item.py items.json --salida precios.json [--valor-referencial 220635.6]
        [--adjudicado 134178] [--periodos 2] [--contexto "Centro juvenil, Huancayo"]

items.json: [{"numero": "1.01", "descripcion": "LIMÓN CATEGORÍA I", "unidad": "Kilogramo", "cantidad": 1440}, …]
Entorno: el del motor por SDK (MOTOR_SDK_MODULO, MOTOR_SDK_MODELO y el endpoint del modelo) y PRECIOS_URL/PRECIOS_TOKEN.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import statistics
import sys
import types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "agent"))

INSTRUCCION = """Eres un analista de precios de compras públicas del Perú. Para CADA ítem de la lista:
1. Llama `consultar_precios_referencia` con un término corto (p. ej. "limon x kg", "papaya", "choclo x und").
2. Quédate SOLO con productos que son el mismo bien, fresco y a granel o por pieza: descarta jugos, pulpas, conservas,
   snacks, bandejas preparadas, productos de limpieza o de otro rubro. La variedad importa cuando el ítem la pide
   (mandarina satsuma, palta fuerte, naranja valencia); si no hay esa variedad, usa la más cercana y dilo.
3. Si no sale nada útil, reintenta con otro término (máx. 3 intentos por ítem).
4. Lleva cada precio a la UNIDAD DEL ÍTEM: si el producto es "por peso" (`por_peso: true`) su precio ya es por kilo; si
   el ítem es por unidad (choclo) usa productos por unidad. No inventes conversiones: si no puedes, no lo incluyas.
Devuelve todos los ítems, aunque alguno quede sin precios (con `precios: []` y el motivo)."""

ESQUEMA = {
    "type": "object", "required": ["items"],
    "properties": {"items": {"type": "array", "items": {
        "type": "object", "required": ["numero", "precios"],
        "properties": {
            "numero": {"type": "string"},
            "precios": {"type": "array", "items": {
                "type": "object", "required": ["precio", "tienda", "producto", "url"],
                "properties": {"precio": {"type": "number"}, "tienda": {"type": "string"},
                               "producto": {"type": "string"}, "url": {"type": "string"}}}},
            "terminos_usados": {"type": "array", "items": {"type": "string"}},
            "comentario": {"type": "string"}}}}},
}


async def correr(items: list[dict], contexto: str) -> tuple[dict, dict]:
    from google.adk.tools import FunctionTool
    from motores import motor_sdk
    from tools.market.precio_tool import consultar_precios_referencia
    agente = types.SimpleNamespace(
        name="analista_precios", instruction=INSTRUCCION + (f"\n\nContexto de la compra: {contexto}" if contexto else ""),
        tools=[FunctionTool(consultar_precios_referencia)], output_key="precios_items", esquema_salida=ESQUEMA)
    lista = [{"numero": it["numero"], "descripcion": it["descripcion"], "unidad": it["unidad"]} for it in items]
    evs, texto, delta, metr = await motor_sdk.run_agent_delta(
        agente, "Ítems a preciar:\n" + json.dumps(lista, ensure_ascii=False), {}, None, "u", "precios_items")
    salida = delta.get("precios_items")
    if isinstance(salida, str):
        salida = json.loads(salida)
    return salida or {"items": []}, {"metricas": metr, "llamadas": [e for e in evs if e.get("kind") == "tool_call"]}


def resumir(items: list[dict], salida: dict, periodos: float) -> dict:
    por_num = {str(r.get("numero")): r for r in salida.get("items") or []}
    filas, total = [], 0.0
    for it in items:
        r = por_num.get(str(it["numero"]), {})
        ps = [float(p["precio"]) for p in r.get("precios") or [] if isinstance(p.get("precio"), (int, float)) and p["precio"] > 0]
        prom = round(statistics.mean(ps), 2) if ps else None
        med = round(statistics.median(ps), 2) if ps else None
        valor = round(prom * it["cantidad"] * periodos, 2) if prom else None
        total += valor or 0
        filas.append({**it, "n_precios": len(ps), "promedio": prom, "mediana": med,
                      "min": min(ps) if ps else None, "max": max(ps) if ps else None, "valor_mercado": valor,
                      "precios": r.get("precios") or [], "comentario": r.get("comentario")})
    return {"items": filas, "valor_mercado_total": round(total, 2),
            "items_con_precio": sum(1 for f in filas if f["promedio"]), "items_total": len(filas)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("items", type=pathlib.Path)
    ap.add_argument("--salida", type=pathlib.Path)
    ap.add_argument("--contexto", default="")
    ap.add_argument("--periodos", type=float, default=1.0, help="multiplica la cantidad (p. ej. 2 si es anual y el contrato es de 24 meses)")
    ap.add_argument("--valor-referencial", type=float)
    ap.add_argument("--adjudicado", type=float)
    a = ap.parse_args()
    os.environ.setdefault("MOTOR_SDK_MAX_TURNOS", "80")
    items = json.loads(a.items.read_text(encoding="utf-8"))
    salida, traza = asyncio.run(correr(items, a.contexto))
    res = resumir(items, salida, a.periodos)
    res["metricas"] = traza["metricas"]
    res["consultas"] = [c.get("args") for c in traza["llamadas"]]
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{'ítem':6} {'descripción':38} {'n':>2} {'promedio':>9} {'mediana':>8} {'valor mercado':>14}")
    for f in res["items"]:
        print(f"{f['numero']:6} {f['descripcion'][:38]:38} {f['n_precios']:>2} {str(f['promedio'] or '—'):>9} "
              f"{str(f['mediana'] or '—'):>8} {('S/ {:,.2f}'.format(f['valor_mercado']) if f['valor_mercado'] else '—'):>14}")
    print(f"\nValor de mercado (ítems con precio: {res['items_con_precio']}/{res['items_total']}): S/ {res['valor_mercado_total']:,.2f}")
    for nombre, v in (("valor referencial", a.valor_referencial), ("adjudicado", a.adjudicado)):
        if v:
            print(f"{nombre}: S/ {v:,.2f} → {(v / res['valor_mercado_total'] - 1) * 100:+.1f} % frente al mercado"
                  if res["valor_mercado_total"] else f"{nombre}: S/ {v:,.2f}")
    print(f"consultas a la herramienta: {len(res['consultas'])} · tokens {res['metricas'].get('prompt')}/{res['metricas'].get('output')} · US$ {res['metricas'].get('cost')}")
    if a.salida:
        a.salida.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
