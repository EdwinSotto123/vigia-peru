"""Carga el grafo de la estructura del Estado (dataset/CLAUDE-GENERADO) a grafo_nodos / grafo_aristas.
Uso: python cargar_grafo.py dev|prod   (requiere la migración 126 aplicada antes).

El orden de columnas de los CSV coincide con el de las tablas, así que se copian directo con FORMAT csv
(HEADER true salta la cabecera y su BOM; NULL '' deja en NULL las celdas vacías). Idempotente: TRUNCATE + COPY.
"""
import sys
sys.path.insert(0, r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\infrastructure\aws")
from tunel_rds import conexion

BASE = r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\dataset\CLAUDE-GENERADO"
entorno = sys.argv[1]

with conexion(entorno) as c:
    cur = c.cursor()
    cur.execute("TRUNCATE grafo_nodos, grafo_aristas")
    with open(f"{BASE}\\nodos.csv", encoding="utf-8") as fh:
        cur.copy_expert("COPY grafo_nodos FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')", fh)
    cur.execute("SELECT count(*) FROM grafo_nodos")
    print("grafo_nodos:", cur.fetchone()[0])
    with open(f"{BASE}\\aristas.csv", encoding="utf-8") as fh:
        cur.copy_expert("COPY grafo_aristas FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')", fh)
    cur.execute("SELECT count(*) FROM grafo_aristas")
    print("grafo_aristas:", cur.fetchone()[0])
    cur.execute("SELECT count(*) FROM grafo_entidad")
    print("entidades empatadas (grafo_entidad):", cur.fetchone()[0])
    c.commit()
print("OK")
