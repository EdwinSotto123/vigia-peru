"""Leer con un modelo de Workers AI (GLM 5.3 flash por defecto) en vez de Claude: por vigia-llm /v1/chat/completions, con
`x-vigia-respaldo: nunca` (si Workers AI falla vuelve el error; no cae en el respaldo, que cobra aparte).

Workers AI no recibe PDF: de cada página va su texto (PyMuPDF) y, si es un escaneo (casi sin letras), su imagen JPEG,
hasta MAX_IMAGENES por pedido (con 12 o más Workers AI falla). La salida llega por una herramienta forzada cuyo esquema
es el del lector (lector.ESQUEMA), igual que la lectura de las bases CAS en la API (lib/basesPlaza.ts).
"""
from __future__ import annotations

import base64
import json
import random
import re
import time
import urllib.error
import urllib.request

from lector.base import CLIENTE, ssm

URL = "https://vigia-llm.vigiaperu.workers.dev/v1/chat/completions"
MODELO_DEFECTO = "@cf/zai-org/glm-5.3-flash"
# USD por millón de tokens, precios de lista de Workers AI (2026-11).
PRECIOS = {
    "@cf/zai-org/glm-5.3-flash": (0.15, 0.50),
    "@cf/deepseek-ai/deepseek-v4.1-flash-1017": (0.30, 1.20),
    "@cf/google/gemma-4-26b-a4b-it": (0.10, 0.30),
    "@cf/moonshotai/kimi-k2.6": (0.95, 4.00),
    "@cf/zai-org/glm-5.3": (1.40, 4.40),
    "@cf/openai/gpt-oss-120b": (0.35, 0.75),
}
MAX_IMAGENES = 8
MIN_LETRAS_PAGINA = 120          # una página con menos letras es un escaneo: va como imagen
TOKENS_POR_IMAGEN = 1_600         # estimado, para el tope de tokens del pedido
DPI = 110


def letras(t: str) -> int:
    return len(re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]", t or ""))


def contenido(pdfs: list[tuple[str, bytes]], pedido: str) -> tuple[list[dict], int, int]:
    """El mensaje del usuario (texto e imágenes, en el orden de las páginas), las imágenes y los caracteres de texto."""
    import fitz  # PyMuPDF

    bloques: list[dict] = []
    texto: list[str] = []
    imagenes = caracteres = 0

    def soltar():
        nonlocal texto
        if texto:
            bloques.append({"type": "text", "text": "\n".join(texto)})
            texto = []

    for nombre, b in pdfs:
        texto.append(f"=== Documento: {nombre} ===")
        with fitz.open(stream=b, filetype="pdf") as doc:
            for i, pagina in enumerate(doc):
                t = pagina.get_text("text").strip()
                if letras(t) >= MIN_LETRAS_PAGINA:
                    texto.append(f"[página {i + 1}]\n{t}")
                    caracteres += len(t)
                elif imagenes < MAX_IMAGENES:
                    texto.append(f"[página {i + 1}: escaneada, va como imagen]")
                    soltar()
                    jpg = pagina.get_pixmap(dpi=DPI).tobytes(output="jpeg", jpg_quality=70)
                    bloques.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}})
                    imagenes += 1
                else:
                    texto.append(f"[página {i + 1}: escaneada, no se envía]")
    texto.append(pedido)
    soltar()
    return bloques, imagenes, caracteres


class MotorWorkers:
    """La misma interfaz que usa leer.py con Claude: tokens(lector, pdfs) y llamar(lector, pdfs)."""

    # Tokens de entrada estimados por pedido: más, y el PDF se lee en tramos (los lectores con `juntar`) o recortado.
    tope_tokens = 90_000

    def __init__(self, modelo: str = MODELO_DEFECTO):
        self.modelo = modelo
        self.nombre = modelo
        self.token = ssm("/vigia/llm/token")

    def tokens(self, lector, pdfs) -> int:
        """Estimado (Workers AI no cuenta tokens antes): ~3,2 caracteres por token y un fijo por imagen."""
        _, imagenes, caracteres = contenido(pdfs, lector.PEDIDO)
        return int((caracteres + len(lector.SISTEMA)) / 3.2) + imagenes * TOKENS_POR_IMAGEN

    def costo(self, tin: int, tout: int) -> float:
        p_in, p_out = PRECIOS.get(self.modelo, (float("nan"), float("nan")))
        return round(tin * p_in / 1e6 + tout * p_out / 1e6, 6)

    def llamar(self, lector, pdfs) -> dict:
        bloques, imagenes, _ = contenido(pdfs, lector.PEDIDO)
        return self.pedir(lector, bloques, imagenes)

    def llamar_texto(self, lector, texto: str) -> dict:
        """La misma lectura cuando ya se tiene el texto de la pieza (documentos_texto, con sus marcas de página): no hace
        falta bajar el PDF. Sirve para los documentos con texto; un escaneo necesita `llamar`, que manda la imagen."""
        return self.pedir(lector, [{"type": "text", "text": texto + "\n\n" + lector.PEDIDO}], 0)

    def pedir(self, lector, bloques: list[dict], imagenes: int = 0) -> dict:
        cuerpo = {
            "model": self.modelo,
            "messages": [{"role": "system", "content": lector.SISTEMA}, {"role": "user", "content": bloques}],
            "tools": [{"type": "function", "function": {"name": "salida", "description": "Lo extraído de los documentos, con este esquema.",
                                                        "parameters": lector.ESQUEMA}}],
            "tool_choice": {"type": "function", "function": {"name": "salida"}},
            "reasoning_effort": "low",
            "max_tokens": 12000,
            "temperature": 0,
        }
        datos = json.dumps(cuerpo).encode()
        res = {"modelo": self.modelo, "tokens_in": 0, "tokens_out": 0, "costo_usd": 0.0, "salida": None, "detalle": None}
        ultimo = ""
        for intento in range(7):
            req = urllib.request.Request(URL, data=datos, method="POST", headers={
                "authorization": f"Bearer {self.token}", "content-type": "application/json", "user-agent": CLIENTE,
                "x-vigia-respaldo": "nunca"})
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    quien = r.headers.get("x-vigia-modelo", "")
                    j = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                ultimo = f"HTTP {e.code}: {e.read(300).decode('utf-8', 'replace')}"
                if e.code < 500 and e.code != 429:
                    return {**res, "estado": "error", "detalle": ultimo}
            except Exception as e:  # noqa: BLE001 — la red: se reintenta
                ultimo = f"{type(e).__name__}: {str(e)[:200]}"
            # El tope de pedidos por minuto del modelo (Workers AI, error 3021): esperar a que pase el minuto, con azar
            # para que los hilos no vuelvan todos juntos.
            if "3021" in ultimo or "rate limit" in ultimo.lower() or "HTTP 429" in ultimo:
                time.sleep(45 + random.random() * 45)
            else:
                time.sleep(10 * (intento + 1))
        else:
            return {**res, "estado": "error", "detalle": ultimo[:300]}
        if quien and not quien.startswith("workers-ai:"):
            return {**res, "estado": "error", "detalle": f"contestó {quien}, no Workers AI"}
        u = j.get("usage") or {}
        tin, tout = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
        res.update(tokens_in=tin, tokens_out=tout, costo_usd=self.costo(tin, tout))
        if imagenes:
            res["detalle"] = f"{imagenes} páginas escaneadas como imagen"
        msj = ((j.get("choices") or [{}])[0] or {}).get("message") or {}
        fin = ((j.get("choices") or [{}])[0] or {}).get("finish_reason")
        llamadas = msj.get("tool_calls") or []
        args = next((c.get("function", {}).get("arguments") for c in llamadas if c.get("function", {}).get("name") == "salida"), None)
        if args is None and llamadas:
            args = llamadas[0].get("function", {}).get("arguments")
        if args is None:
            crudo = msj.get("content") or ""
            i = crudo.find("{")
            args = crudo[i:] if i >= 0 else None
        if args is None:
            return {**res, "estado": "truncada" if fin == "length" else "json_invalido", "detalle": str(msj)[:300]}
        try:
            salida = args if isinstance(args, dict) else json.loads(args)
        except json.JSONDecodeError:
            return {**res, "estado": "truncada" if fin == "length" else "json_invalido", "detalle": str(args)[:300]}
        if not isinstance(salida, dict):
            return {**res, "estado": "json_invalido", "detalle": str(salida)[:300]}
        if hasattr(lector, "normalizar"):
            salida = lector.normalizar(salida)
        return {**res, "estado": "ok", "salida": salida}
