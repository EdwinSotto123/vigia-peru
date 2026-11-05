#!/bin/bash
# Lectura con IA (Haiku 5.5 por vigia-llm) de los contratos menores que faltan: el requerimiento, su segunda lectura (sólo
# los que tienen banderas), la mirada a las marcas (menor_marcas.py), el contrato u orden y su segunda lectura; al final,
# las señales. Cada paso retoma lo que no está leído. Corre en GitLab CI (job tarea:lector-menores) o en la PC.
#   bash backend/lector/cadena_menores.sh prod [tope_usd_tdr] [tope_usd_contrato]
set -u
ENT=${1:-prod}
TOPE_TDR=${2:-15}
TOPE_CONTRATO=${3:-8}
cd "$(dirname "$0")/../.."
L=backend/lector/menores.py
python -X utf8 $L "$ENT" --clase menor_tdr --tope-usd "$TOPE_TDR" --hilos 4 --sin-refrescar
python -X utf8 $L "$ENT" --clase menor_tdr --segunda --solo-con-banderas --tope-usd 3 --hilos 4 --sin-refrescar
python -X utf8 backend/lector/menor_marcas.py "$ENT" --tope-usd 1 --hilos 4 --sin-refrescar
python -X utf8 $L "$ENT" --clase menor_contrato --tope-usd "$TOPE_CONTRATO" --hilos 4 --sin-refrescar
python -X utf8 $L "$ENT" --clase menor_contrato --segunda --solo-con-banderas --tope-usd 2 --hilos 4 --sin-refrescar
python -X utf8 backend/scripts/tareas_ci.py "$ENT" refrescar-menores
