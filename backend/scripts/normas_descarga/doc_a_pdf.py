"""Pasa a PDF las opiniones publicadas en Word (.doc, .docx) para leerlas igual que las demás.

    python -X utf8 backend/scripts/normas_descarga/doc_a_pdf.py [carpeta]

Usa Microsoft Word por automatización, con las macros DESACTIVADAS, sólo lectura y sin avisos. Lo ya convertido no se
repite. Los archivos vienen de cdn.www.gob.pe; aun así se abren sin ejecutar nada.
"""
import os
import sys
from pathlib import Path

import win32com.client  # pywin32

# La carpeta de descargas (fuera del repositorio): NORMAS_DESCARGAS=C:/ruta/rag-legal-pe
if not os.environ.get("NORMAS_DESCARGAS"):
    raise SystemExit("Falta NORMAS_DESCARGAS: la carpeta donde se guardan las normas descargadas.")
RAIZ = Path(os.environ["NORMAS_DESCARGAS"])
carpeta = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "15_opiniones_sitemap"
pendientes = [f for f in sorted(carpeta.iterdir()) if f.suffix.lower() in (".doc", ".docx") and not f.with_suffix(".pdf").exists()]
print(len(pendientes), "por convertir", flush=True)
if pendientes:
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    word.AutomationSecurity = 3          # msoAutomationSecurityForceDisable: ninguna macro corre
    hechos = fallos = 0
    try:
        for f in pendientes:
            try:
                doc = word.Documents.Open(str(f), ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, Visible=False)
                doc.SaveAs2(str(f.with_suffix(".pdf")), FileFormat=17)      # wdFormatPDF
                doc.Close(False)
                hechos += 1
            except Exception as e:  # noqa: BLE001
                fallos += 1
                print("   no se pudo:", f.name, str(e)[:100], flush=True)
            if (hechos + fallos) % 50 == 0:
                print("  ", hechos + fallos, "de", len(pendientes), flush=True)
    finally:
        word.Quit()
    print("convertidos:", hechos, "| fallos:", fallos)
