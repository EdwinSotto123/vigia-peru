"""Resumen de los datasets externos cargados (Frente D): filas, fechas y cruces con las reglas.

Imprime en Markdown lo que va en docs/design/DATASETS.md, siempre desde consultas reales
(nunca cifras a mano). Usa la misma conexión que los scrapers (PGHOST/PGPASSWORD o
.cloudsql-password en la raíz).

  cd backend/scrapers && PYTHONPATH=. python ../scripts/datasets_resumen.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scrapers"))
from _core.pipeline import pg_dsn  # noqa: E402

import psycopg2  # noqa: E402


def q(cur, sql: str, params=()):
    cur.execute(sql, params)
    return cur.fetchall()


def main() -> None:
    conn = psycopg2.connect(pg_dsn())
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '900s'")

    print("## Cargas registradas (`datasets_cobertura`)\n")
    print("| fuente | tabla | cargas | filas | última clave | última descarga | última carga |")
    print("|---|---|---|---|---|---|---|")
    for f, t, n, err, filas, clave, desc, carg, _ in q(cur, "SELECT * FROM datasets_cobertura ORDER BY fuente"):
        print(f"| {f} | {t} | {n} | {filas:,} | {clave} | {desc:%Y-%m-%d %H:%M} | {carg:%Y-%m-%d %H:%M} |")

    print("\n## visitas_entidades\n")
    for r in q(cur, "SELECT fuente, count(*), min(fecha_visita), max(fecha_visita), count(DISTINCT entidad_visitada_norm), count(DISTINCT numero_documento) FROM visitas_entidades GROUP BY 1 ORDER BY 1"):
        print(f"- {r[0]}: {r[1]:,} visitas · {r[2]} → {r[3]} · {r[4]} entidades visitadas · {r[5]:,} documentos distintos")
    (n_v, n_p, n_e), = q(cur, """
        WITH postor_rucs AS (SELECT DISTINCT empresa_ruc AS ruc FROM postores)
        SELECT count(*), count(DISTINCT v.numero_documento), count(DISTINCT r.ruc_empresa)
          FROM visitas_entidades v
          JOIN rnp_conformacion_juridica r ON r.numero_documento = v.numero_documento
          JOIN postor_rucs p ON p.ruc = r.ruc_empresa""")
    print(f"- Visitas de socios/representantes (RNP) de empresas postoras en contratos procesados: **{n_v:,} visitas · {n_p} personas · {n_e} empresas**")
    (n_regla, n_ocid), = q(cur, """
        SELECT count(*), count(DISTINCT c.ocid)
          FROM convocatorias c JOIN entidades e ON e.ruc = c.entidad_ruc
          JOIN postores p ON p.ocid = c.ocid JOIN ofertas o ON o.postor_id = p.id
          JOIN empresas emp ON emp.ruc = p.empresa_ruc
          JOIN rnp_conformacion_juridica r ON r.ruc_empresa = emp.ruc
          JOIN visitas_entidades v ON v.numero_documento = r.numero_documento
           AND v.entidad_visitada_norm = UPPER(unaccent(e.nombre))
           AND c.fecha_convocatoria IS NOT NULL
           AND v.fecha_visita BETWEEN (c.fecha_convocatoria - INTERVAL '180 days') AND c.fecha_convocatoria""")
    print(f"- Regla `lobby_visits_pre_convocatoria` (misma SQL que compliance_rules, todos los contratos con postores): **{n_regla} visitas en {n_ocid} contratos**")
    (n_rnp, n_rnp_p), = q(cur, "SELECT count(*), count(DISTINCT v.numero_documento) FROM visitas_entidades v WHERE EXISTS (SELECT 1 FROM rnp_conformacion_juridica r WHERE r.numero_documento = v.numero_documento)")
    print(f"- Visitas de personas que figuran en el RNP como socio/representante de algún proveedor del Estado: **{n_rnp:,} visitas · {n_rnp_p:,} personas**")
    (n_ent,), = q(cur, "SELECT count(DISTINCT v.entidad_visitada_norm) FROM visitas_entidades v JOIN entidades e ON UPPER(unaccent(e.nombre)) = v.entidad_visitada_norm")
    (n_vis_ent,), = q(cur, "SELECT count(*) FROM visitas_entidades v JOIN entidades e ON UPPER(unaccent(e.nombre)) = v.entidad_visitada_norm")
    print(f"- Entidades visitadas que están en `entidades` (tienen convocatorias en la cola): **{n_ent}** ({n_vis_ent:,} visitas)")
    ents = q(cur, """SELECT DISTINCT e.nombre FROM convocatorias c JOIN postores p ON p.ocid=c.ocid JOIN entidades e ON e.ruc=c.entidad_ruc
                     WHERE EXISTS (SELECT 1 FROM visitas_entidades v WHERE v.entidad_visitada_norm = UPPER(unaccent(e.nombre))) ORDER BY 1""")
    print(f"- Entidades de contratos ya procesados con visitas registradas: {', '.join(r[0] for r in ents)}")

    print("\n## onpe_aportantes / onpe_candidatos\n")
    print("| proceso | aportes | aportantes distintos | monto (S/) | primer aporte | último aporte |")
    print("|---|---|---|---|---|---|")
    for r in q(cur, "SELECT COALESCE(proceso, '(export manual 2015-2016, sin proceso)'), count(*), count(DISTINCT numero_documento), sum(monto), min(fecha_aporte), max(fecha_aporte) FROM onpe_aportantes GROUP BY 1 ORDER BY 1"):
        print(f"| {r[0]} | {r[1]:,} | {r[2]:,} | {float(r[3] or 0):,.2f} | {r[4]} | {r[5]} |")
    (tot, con_doc, dni8, ruc11), = q(cur, "SELECT count(*), count(numero_documento), count(*) FILTER (WHERE length(numero_documento)=8), count(*) FILTER (WHERE length(numero_documento)=11) FROM onpe_aportantes WHERE proceso IS NOT NULL")
    print(f"\n- Aportes con proceso (API Claridad): **{tot:,}** · con documento {con_doc:,} (DNI {dni8:,} · RUC {ruc11:,})")
    (a1, p1), = q(cur, """SELECT count(*), count(DISTINCT a.numero_documento) FROM onpe_aportantes a WHERE a.proceso IS NOT NULL AND EXISTS (
        SELECT 1 FROM rnp_conformacion_juridica r JOIN postores p ON p.empresa_ruc = r.ruc_empresa WHERE r.numero_documento = a.numero_documento)""")
    print(f"- Aportantes persona que son socios/representantes (RNP) de postores en contratos procesados: **{a1} aportes · {p1} personas**")
    (a2, p2), = q(cur, "SELECT count(*), count(DISTINCT a.numero_documento) FROM onpe_aportantes a WHERE a.proceso IS NOT NULL AND EXISTS (SELECT 1 FROM postores p WHERE p.empresa_ruc = a.numero_documento)")
    print(f"- Aportantes empresa (RUC) que son postores en contratos procesados: **{a2} aportes · {p2} empresas**")
    (a3, p3), = q(cur, "SELECT count(*), count(DISTINCT a.numero_documento) FROM onpe_aportantes a WHERE a.proceso IS NOT NULL AND length(a.numero_documento)=11 AND EXISTS (SELECT 1 FROM rnp_conformacion_juridica r WHERE r.ruc_empresa = a.numero_documento)")
    print(f"- Aportantes empresa inscritas en el RNP (proveedores del Estado): **{a3:,} aportes · {p3:,} empresas**")
    (a4, p4), = q(cur, "SELECT count(*), count(DISTINCT a.numero_documento) FROM onpe_aportantes a WHERE a.proceso IS NOT NULL AND length(a.numero_documento)=8 AND EXISTS (SELECT 1 FROM rnp_conformacion_juridica r WHERE r.numero_documento = a.numero_documento)")
    print(f"- Aportantes persona que son socios/representantes de algún proveedor del Estado (RNP): **{a4:,} aportes · {p4:,} personas**")
    (a5, p5), = q(cur, "SELECT count(*), count(DISTINCT a.numero_documento) FROM onpe_aportantes a WHERE a.proceso IS NOT NULL AND EXISTS (SELECT 1 FROM jne_autoridades j WHERE j.dni = a.numero_documento)")
    print(f"- Aportantes que hoy son autoridades vigentes (por DNI, `jne_autoridades`): **{a5:,} aportes · {p5:,} personas**")
    (c_tot, c_dni), = q(cur, "SELECT count(*), count(dni) FROM onpe_candidatos")
    print(f"- `onpe_candidatos`: **{c_tot:,}** candidatos ({c_dni:,} con DNI) · procesos: " + ", ".join(f"{r[0]} {r[1]:,}" for r in q(cur, "SELECT proceso, count(*) FROM onpe_candidatos GROUP BY 1 ORDER BY 2 DESC")))

    print("\n## jne_autoridades / jne_candidaturas\n")
    (t, d, u, v), = q(cur, "SELECT count(*), count(dni), count(ubigeo), count(*) FILTER (WHERE vigente) FROM jne_autoridades")
    print(f"- `jne_autoridades`: **{t:,}** filas · {d:,} con DNI (vía onpe_candidatos) · {u:,} con ubigeo INEI · {v:,} vigentes")
    for r in q(cur, "SELECT cargo, count(*), count(dni) FROM jne_autoridades GROUP BY 1 ORDER BY 2 DESC"):
        print(f"  - {r[0]}: {r[1]:,} ({r[2]:,} con DNI)")
    for dep, code in (("Cusco", "08"), ("Puno", "21")):
        (n, nd, alc), = q(cur, "SELECT count(*), count(dni), count(*) FILTER (WHERE cargo LIKE 'ALCALDE%%') FROM jne_autoridades WHERE left(ubigeo,2)=%s", (code,))
        print(f"- {dep} ({code}): {n:,} autoridades · {nd:,} con DNI · {alc} alcaldes")
    (n_e,), = q(cur, "SELECT count(DISTINCT e.ruc) FROM entidades e WHERE e.ubigeo IS NOT NULL AND EXISTS (SELECT 1 FROM jne_autoridades_vigentes a WHERE a.ubigeo = e.ubigeo)")
    (n_c,), = q(cur, "SELECT count(DISTINCT c.ocid) FROM convocatorias c JOIN entidades e ON e.ruc=c.entidad_ruc WHERE EXISTS (SELECT 1 FROM jne_autoridades_vigentes a WHERE a.ubigeo = e.ubigeo AND a.cargo LIKE 'ALCALDE%%')")
    print(f"- Entidades con autoridades vigentes en su mismo ubigeo: **{n_e:,}** · convocatorias en la cola cuya entidad tiene alcalde vigente identificado: **{n_c:,}**")
    (jc, jd), = q(cur, "SELECT count(*), count(numero_documento) FROM jne_candidaturas")
    print(f"- `jne_candidaturas`: {jc:,} filas · **{jd:,} con DNI** (antes de este frente: 0)")

    print("\n## dji_funcionarios / dji_empleos\n")
    (f_n, f_e), = q(cur, "SELECT count(*), count(DISTINCT upper(entidad)) FROM dji_funcionarios")
    (e_n, e_r), = q(cur, "SELECT count(*), count(ruc_entidad) FROM dji_empleos")
    print(f"- `dji_funcionarios`: **{f_n:,}** declaraciones · {f_e:,} entidades · `dji_empleos`: **{e_n:,}** empleos previos ({e_r:,} con RUC)")
    (x1, x2, x3), = q(cur, "SELECT count(*), count(DISTINCT e.ruc_entidad), count(DISTINCT e.codigo_ddjj) FROM dji_empleos e WHERE e.ruc_entidad IN (SELECT DISTINCT empresa_ruc FROM postores)")
    print(f"- Empleos previos en empresas postoras de contratos procesados (puerta giratoria, C9): **{x1:,} empleos · {x2} empresas · {x3:,} funcionarios**")
    (x4,), = q(cur, "SELECT count(*) FROM dji_empleos e WHERE e.ruc_entidad IN (SELECT DISTINCT ruc FROM empresas)")
    print(f"- Empleos previos en cualquier empresa de `empresas`: **{x4:,}**")
    (x5,), = q(cur, "SELECT count(*) FROM dji_funcionarios f WHERE upper(immutable_unaccent(f.entidad)) IN (SELECT upper(immutable_unaccent(nombre)) FROM entidades)")
    print(f"- Declaraciones de funcionarios de entidades con convocatorias en la cola: **{x5:,}**")
    conn.close()


if __name__ == "__main__":
    main()
