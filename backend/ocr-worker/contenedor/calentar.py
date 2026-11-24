"""En la construcción de la imagen: una conversión de prueba baja los modelos (layout, tablas, OCR) a la imagen, así el
contenedor arranca sin descargar nada."""
from io import BytesIO

from PIL import Image, ImageDraw

import app
from docling.datamodel.base_models import DocumentStream

img = Image.new("RGB", (900, 300), "white")
d = ImageDraw.Draw(img)
for i, fila in enumerate(["Item  Descripcion          Cantidad  Unidad", "01    FILTRO DE ACEITE     04        UNIDAD",
                          "02    ACEITE SAE 15W40     18        BALDES"]):
    d.text((20, 30 + 40 * i), fila, fill="black")
b = BytesIO()
img.save(b, "PNG")
r = app.convertidor().convert(DocumentStream(name="prueba.png", stream=BytesIO(b.getvalue())))
print("modelos listos:", len(r.document.export_to_markdown()), "caracteres")
