"""Instrucciones de prompt para los workers de precio (búsqueda real y estimación IA) —
separadas de goods_retail.py solo para mantenerlo bajo 800 líneas."""

_MARKET_WORKER_INSTRUCCIONES = """
Busca en marketplaces y tiendas del Perú (y solo si no hay oferta peruana, en catálogos
internacionales) el precio de venta de cada ítem, usando marca/modelo/especificaciones
LITERALES del requerimiento. Prioriza productos que cumplan las características exigidas;
si el producto hallado difiere (otra medida, otro modelo), dilo en el comentario.

FORMATO DE RESPUESTA (obligatorio): prosa en líneas independientes, UNA oración por precio,
sin tablas, sin JSON, sin viñetas, sin negritas:
Ítem <numero>: el producto "<título del producto tal como aparece en la página>" se ofrece a S/ <precio> por <unidad> en <nombre de la tienda>.

Reglas:
· Solo precios que viste en los resultados de búsqueda; nada de memoria ni estimaciones.
· Hasta 8 líneas por ítem. Si encontraste menos de 3, reporta las que haya (no completes).
· Precio unitario en soles. Si la página muestra dólares, escribe "USD <precio>" en vez de "S/".
· En "por <unidad>" escribe la PRESENTACIÓN real del precio, con contenido o medida: "por kg",
  "por bolsa de 5 kg", "por saco de 50 kg", "por galón", "por bidón de 20 l", "por m2",
  "por rollo de 4 m x 100 m", "por pieza de 3 m", "por unidad". Si el título no trae el contenido
  neto o las dimensiones (largo, espesor), agrégalos al título tal como los muestra la página.
· Usa el `numero` del ítem tal cual (incluye sub-ítems como 2.1).
· Si no encontraste precios para un ítem escribe exactamente: Ítem <numero>: sin precios observados.
· Cierra cada ítem con una línea: Comentario ítem <numero>: <1-2 oraciones factuales sobre la
  comparabilidad de lo hallado con el requerimiento (medida, modelo, presentación, mayorista/retail)>.
· No escribas URLs: las fuentes se toman de los resultados de búsqueda automáticamente.
"""

_ESTIMACION_INSTRUCCIONES = """
NO tienes búsqueda web en esta tarea: usa tu conocimiento GENERAL y PREVIO de precios de
mercado en Perú para dar una ESTIMACIÓN aproximada de cada ítem — no una cifra verificada.

FORMATO DE RESPUESTA (obligatorio): prosa en líneas independientes, sin tablas, sin JSON:
Ítem <numero>: ESTIMADO S/ <precio unitario> por <unidad/presentación> · confianza <alta|media|baja> · <por qué, 1 frase>

Reglas:
· Es una ESTIMACIÓN desde tu conocimiento previo, NO una búsqueda en vivo: sé honesto en la
  confianza (usa "baja" si el precio depende mucho de marca/modelo/región que no conoces con certeza).
· Si el ítem es demasiado específico/técnico para estimar con algún fundamento, escribe
  exactamente: Ítem <numero>: sin estimación confiable.
· Nunca inventes una tienda, URL o cifra "de una fuente": esto no es una búsqueda, es tu estimación.
· Precio unitario en soles. Si prefieres razonar en dólares, escribe "USD <precio>" en vez de "S/".
· Usa el `numero` del ítem tal cual (incluye sub-ítems como 2.1).
"""
