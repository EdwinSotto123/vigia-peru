#!/bin/bash
# Actualización de la Contraloría, de punta a punta, desde una PC en el Perú (sus servidores sólo responden a IPs
# peruanas). Una vez al mes, después del día 10 (cuando el Worker ya cargó los informes nuevos), o cuando haga falta:
#
#   bash backend/scripts/actualizar_contraloria.sh            # producción
#   bash backend/scripts/actualizar_contraloria.sh dev
#
# Pasos (todos se pueden repetir: cada uno sólo hace lo que falta):
#   1. informes con responsabilidad presunta y sus funcionarios comprendidos (migraciones 90 y 302), y las señales de
#      personas que salen de ellos (308);
#   2. las Fichas Resumen de los informes que aún no se bajaron (1 pedido por segundo; migración 304);
#   3. su lectura: el formulario (determinista) y, con GLM 5.3 flash, el tema, el perjuicio y las referencias de cada
#      observación, con tope de gasto acumulado (CONTRALORIA_TOPE_USD, 40 por defecto);
#   4. el índice del buscador (trozos y vectores bge-m3; migración 305).
#
# Los PDF y las bitácoras quedan en dataset/ (git lo ignora; las fichas nombran a personas con su DNI: nunca al repo).
# Otra carpeta: CONTRALORIA_DATOS=/ruta. Requiere la CLI de AWS con el perfil del operador, session-manager-plugin,
# psycopg2 y PyMuPDF.
set -u
ENTORNO="${1:-prod}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
DATOS="${CONTRALORIA_DATOS:-$RAIZ/dataset}"
export MSYS_NO_PATHCONV=1 PYTHONUTF8=1 AWS_PROFILE="${AWS_PROFILE:-founder.edwin}"
cd "$RAIZ" || exit 1
mkdir -p "$DATOS/contraloria_fichas"
FICHAS="python -P -X utf8 backend/scripts/cargar_contraloria_fichas.py"

paso() { echo; echo "== $1 ($(date +%H:%M))"; }

paso "1. Informes y funcionarios comprendidos"
python -X utf8 backend/scripts/cargar_contraloria_informes.py --entorno "$ENTORNO" --personas || { echo "falló la carga de informes: no sigo"; exit 1; }

paso "2. Fichas Resumen que faltan"
$FICHAS lista --entorno "$ENTORNO" --salida "$DATOS/contraloria_fichas_lista.json" || exit 1
$FICHAS bajar --lista "$DATOS/contraloria_fichas_lista.json" --carpeta "$DATOS/contraloria_fichas" || { echo "la descarga se detuvo (¿bloqueo o sin red?): se retoma al volver a correr"; }

paso "3. Lectura del formulario y de las observaciones"
$FICHAS cargar --entorno "$ENTORNO" --carpeta "$DATOS/contraloria_fichas" || exit 1
$FICHAS leer --entorno "$ENTORNO" --tope-usd "${CONTRALORIA_TOPE_USD:-40}" --hilos 2 --bitacora "$DATOS/contraloria_fichas_lectura.jsonl" || echo "la lectura con IA no terminó: se retoma al volver a correr"

paso "4. Índice del buscador"
$FICHAS indexar --entorno "$ENTORNO" --hilos 2 || exit 1

paso "Estado"
$FICHAS estado --entorno "$ENTORNO"
