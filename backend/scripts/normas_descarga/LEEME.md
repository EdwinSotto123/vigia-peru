# Descarga de normas para el RAG normativo

Lo que alimenta las tablas `norma` y `norma_fragmento` (ver `docs/design/RAG_NORMATIVO_V2.md`). Las descargas viven fuera del
repositorio, en la carpeta que indique `NORMAS_DESCARGAS`.

| Paso | Qué hace |
|---|---|
| 1 | `sitemap_oece.py` recorre el sitemap público de gob.pe y lista las publicaciones del OECE (`00_manifiesto/sitemap_oece.json`) |
| 2 | `bajar_opiniones_sitemap.py 2025,2026` baja cada opinión desde su página oficial (PDF o Word) y deja `lote6_resultado.json` |
| 3 | `doc_a_pdf.py` pasa a PDF las que están en Word (con Microsoft Word, macros desactivadas) |
| 4 | `../normas_fichas.py <descargas> <fichas>` las convierte en fichas por artículo, numeral o conclusión |
| 5 | `../cargar_normas.py prod carpeta <fichas>`, `podar <fichas>` y `vectores` |
| 6 | `python -m backend.rag.evaluar_normas --solo nuevo --subir prod` mide y deja la corrida en /admin/golden |

Reglas de conducta: un pedido cada 5 segundos, agente de usuario propio, nada de `?sheet=` (lo prohíbe `robots.txt`; por eso
se usa el sitemap y no los listados paginados) y, ante tres fallos seguidos, el script se detiene en vez de insistir.

Para traer sólo lo nuevo de cada mes: repetir los pasos 1 a 6; lo ya bajado no se vuelve a pedir.
