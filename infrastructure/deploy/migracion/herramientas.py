"""Herramientas de la mudanza de proyecto de GCP (las usa migrar-proyecto.sh; también sirven sueltas).

Cada subcomando es lo que se hizo a mano en la mudanza vivid-spot → formulab del 29/09/2026:

  secretos        copia secretos de Secret Manager entre proyectos sin imprimirlos
  vertex-search   copia el data store de Vertex AI Search (esquema + documentos) y crea el motor
  catalogo-rag    reescribe las URIs gs:// del catálogo del RAG al bucket nuevo
  agentes-yaml    genera los 4 servicios de agentes (Cloud Run) para `gcloud run services replace`
  comparar-bases  compara dos bases objeto por objeto: estructura, filas, dueños y permisos

Credenciales: gcloud (cuentas por --cuenta-origen/--cuenta-destino) y, para las bases, PG* por
parámetro. Nada de esto guarda ni imprime secretos.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import ssl
import subprocess
import sys

GCLOUD = shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"
DE = "https://discoveryengine.googleapis.com/v1/projects/{p}/locations/global/collections/default_collection"


def gcloud(*args: str, cuenta: str | None = None, entrada: bytes | None = None) -> subprocess.CompletedProcess:
    cmd = [GCLOUD, *args] + ([f"--account={cuenta}"] if cuenta else [])
    return subprocess.run(cmd, input=entrada, capture_output=True)


def token(cuenta: str | None) -> str:
    r = gcloud("auth", "print-access-token", cuenta=cuenta)
    if r.returncode:
        sys.exit(f"sin token de gcloud para {cuenta or 'la cuenta activa'}: {r.stderr.decode()[-200:]}")
    return r.stdout.decode().strip()


# ── secretos ────────────────────────────────────────────────────────────────────────────────────
def cmd_secretos(a) -> None:
    for nombre in a.nombres:
        r = gcloud("secrets", "versions", "access", "latest", "--secret", nombre, "--project", a.origen, cuenta=a.cuenta_origen)
        if r.returncode:
            print(f"  ✗ {nombre}: no se pudo leer en {a.origen}")
            continue
        gcloud("secrets", "create", nombre, "--replication-policy", "automatic", "--project", a.destino, cuenta=a.cuenta_destino)
        w = gcloud("secrets", "versions", "add", nombre, "--data-file=-", "--project", a.destino, cuenta=a.cuenta_destino, entrada=r.stdout)
        print(f"  {'✓' if w.returncode == 0 else '✗'} {nombre} ({len(r.stdout)} bytes)")


# ── Vertex AI Search ────────────────────────────────────────────────────────────────────────────
def cmd_vertex_search(a) -> None:
    import time
    import requests
    ho = {"Authorization": f"Bearer {token(a.cuenta_origen)}", "X-Goog-User-Project": a.origen, "Content-Type": "application/json"}
    hn = {"Authorization": f"Bearer {token(a.cuenta_destino)}", "X-Goog-User-Project": a.destino, "Content-Type": "application/json"}
    bo, bn = DE.format(p=a.origen), DE.format(p=a.destino)
    ds = a.datastore
    r = requests.post(f"{bn}/dataStores?dataStoreId={ds}", headers=hn, json={
        "displayName": ds, "industryVertical": "GENERIC", "contentConfig": "NO_CONTENT", "solutionTypes": ["SOLUTION_TYPE_SEARCH"]})
    print(f"  data store {ds}: HTTP {r.status_code}")
    for _ in range(60):
        if requests.get(f"{bn}/dataStores/{ds}", headers=hn).status_code == 200:
            break
        time.sleep(5)
    esquema = requests.get(f"{bo}/dataStores/{ds}/schemas/default_schema", headers=ho).json()
    cuerpo = {k: esquema[k] for k in ("structSchema", "jsonSchema") if k in esquema}
    if cuerpo:
        r = requests.patch(f"{bn}/dataStores/{ds}/schemas/default_schema", headers=hn, json=cuerpo)
        print(f"  esquema: HTTP {r.status_code}")
    docs, pagina = [], None
    while True:
        u = f"{bo}/dataStores/{ds}/branches/default_branch/documents?pageSize=1000" + (f"&pageToken={pagina}" if pagina else "")
        d = requests.get(u, headers=ho).json()
        docs += d.get("documents", [])
        pagina = d.get("nextPageToken")
        if not pagina:
            break
    for i in range(0, len(docs), 100):
        lote = [{"id": x["id"], "structData": x.get("structData", {})} for x in docs[i:i + 100]]
        requests.post(f"{bn}/dataStores/{ds}/branches/default_branch/documents:import", headers=hn,
                      json={"inlineSource": {"documents": lote}, "reconciliationMode": "INCREMENTAL"})
    print(f"  documentos: {len(docs)} en importación")
    r = requests.post(f"{bn}/engines?engineId={a.motor}", headers=hn, json={
        "displayName": a.motor, "dataStoreIds": [ds], "solutionType": "SOLUTION_TYPE_SEARCH",
        "searchEngineConfig": {"searchTier": "SEARCH_TIER_STANDARD"}})
    print(f"  motor {a.motor}: HTTP {r.status_code}")


# ── catálogo del RAG ────────────────────────────────────────────────────────────────────────────
def cmd_catalogo_rag(a) -> None:
    from google.cloud import storage
    b = storage.Client(project=a.proyecto).bucket(a.bucket_nuevo)
    blob = b.blob("catalogo.json")
    texto = blob.download_as_bytes().decode("utf-8")
    n = texto.count(f"gs://{a.bucket_viejo}/")
    datos = json.loads(texto.replace(f"gs://{a.bucket_viejo}/", f"gs://{a.bucket_nuevo}/"))
    blob.upload_from_string(json.dumps(datos, ensure_ascii=False, indent=1).encode("utf-8"), content_type="application/json")
    print(f"  catalogo.json: {n} URIs reescritas, {len(datos)} entradas")


# ── agentes ─────────────────────────────────────────────────────────────────────────────────────
# Configuración que no depende del proyecto (la de producción el 29/09/2026).
FIJAS = {
    "ARIZE_PROJECT": "vigia-peru", "ARIZE_SPACE_ID": "U3BhY2U6NDU3NTc6WkYyVA==",
    "GEMINI_MODEL": "gemini-3.6-flash", "GEMINI_MODEL_SMART": "gemini-3.6-flash",
    "GEMINI_MODEL_FAST": "gemini-3.5-flash-lite", "GEMINI_MODEL_JUDGE": "gemini-3.5-flash-lite", "GEMINI_FLEX": "1",
    "GOOGLE_CLOUD_LOCATION": "global", "VERTEX_LOCATION": "global", "GOOGLE_GENAI_USE_VERTEXAI": "true",
    "LOCAL_DOWNLOADER_URL": "http://149.104.66.211:8080", "OECE_RELAY_URL": "https://oece-relay.vigia-peru.workers.dev",
    "LOG_EXECUTION_ID": "true", "OPENINFERENCE_HIDE_INPUT_IMAGES": "true",
    "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT": "100000", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT": "100000",
    "PHOENIX_COLLECTOR_ENDPOINT": "https://app.phoenix.arize.com/s/edwin-soto-c/v1/traces",
    "DOCAI_LOCATION": "us", "PARSE_CALL_TIMEOUT_MS": "300000", "PARSE_PAGES_PER_SHARD": "29", "PARSE_SHARD_THRESHOLD": "29",
    "PARSE_GLOBAL_BUDGET_S": "1800", "DETERMINISTIC_PIPELINE": "1",
    "MARKET_CHUNK_SIZE": "2", "MARKET_TIMEOUT_S": "480", "MARKET_MAX_WORKERS": "12",
    "LEGAL_RAG_BACKEND": "rag_engine", "RAG_LOCATION": "us-central1", "RAG_TOP_K": "5",
}
SECRETOS_AGENTE = {
    "PGPASSWORD": "cloudsql-password", "GOOGLE_API_KEY": "google-api-key", "PHOENIX_API_KEY": "phoenix-api-key",
    "PINECONE_API_KEY": "pinecone-api-key", "ARIZE_API_KEY": "arize-api-key", "DECOLECTA_API_KEY": "decolecta-api-key",
    "LOCAL_DOWNLOADER_TOKEN": "local-downloader-token",
}
PERFILES = [("agent-orchestrator-adk", "bienes", "8Gi", "2"), ("agente-servicios", "servicios", "4Gi", "1"),
            ("agente-obras", "obras", "4Gi", "1"), ("agente-otros", "otros", "4Gi", "1")]


def cmd_agentes_yaml(a) -> None:
    import yaml
    from google.cloud import storage
    corpus = json.loads(storage.Client(project=a.proyecto).bucket(a.rag_bucket).blob("corpus.json").download_as_bytes())
    conexion = f"{a.proyecto}:{a.region}:vigia-db"
    propias = {"GOOGLE_CLOUD_PROJECT": a.proyecto, "VERTEX_PROJECT": a.proyecto, "PGHOST": f"/cloudsql/{conexion}",
               "DOCAI_PROCESSOR_ID": a.docai, "RAG_BUCKET": a.rag_bucket,
               **{v["env"]: v["resource_name"] for v in corpus.values()}}
    os.makedirs(a.salida, exist_ok=True)
    for svc, perfil, mem, maxs in PERFILES:
        env = [{"name": k, "value": v} for k, v in {**FIJAS, **propias, "PIPELINE_PROFILE": perfil}.items()]
        env += [{"name": k, "valueFrom": {"secretKeyRef": {"name": s, "key": "latest"}}} for k, s in SECRETOS_AGENTE.items()]
        spec = {"apiVersion": "serving.knative.dev/v1", "kind": "Service",
                "metadata": {"name": svc, "namespace": a.proyecto, "labels": {"vigia-perfil": perfil},
                             "annotations": {"run.googleapis.com/ingress": "all"}},
                "spec": {"template": {
                    "metadata": {"annotations": {"run.googleapis.com/cloudsql-instances": conexion,
                                                 "run.googleapis.com/startup-cpu-boost": "true",
                                                 "autoscaling.knative.dev/maxScale": maxs}},
                    "spec": {"serviceAccountName": f"vigia-agentes@{a.proyecto}.iam.gserviceaccount.com",
                             "containerConcurrency": 1, "timeoutSeconds": 3600,
                             "containers": [{"image": a.imagen, "env": env, "ports": [{"containerPort": 8080, "name": "http1"}],
                                             "resources": {"limits": {"cpu": "2", "memory": mem}}}]}}}}
        ruta = os.path.join(a.salida, f"{svc}.yaml")
        with open(ruta, "w", encoding="utf-8") as f:
            yaml.safe_dump(spec, f, sort_keys=False, allow_unicode=True)
        print(f"  {ruta} ({perfil}, {mem})")


# ── comparar bases ──────────────────────────────────────────────────────────────────────────────
def _conectar(dsn: str):
    import pg8000.native as pg
    partes = dict(p.split("=", 1) for p in dsn.split())
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    c = pg.Connection(partes.get("user", "postgres"), host=partes["host"], database=partes.get("dbname", "vigia"),
                      password=partes.get("password") or os.environ.get(partes.get("password_env", ""), ""),
                      ssl_context=ctx, timeout=600)
    c.run("SET default_transaction_read_only = on")
    c.run("SET statement_timeout = '300s'")
    return c


def cmd_comparar_bases(a) -> None:
    v, n = _conectar(a.origen), _conectar(a.destino)
    q_obj = ("SELECT c.relname, c.relkind FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace "
             "AND c.relkind IN ('r','p','m','v','S') ORDER BY 1")
    ov, on = dict(map(tuple, v.run(q_obj))), dict(map(tuple, n.run(q_obj)))
    print(f"objetos: origen {len(ov)}, destino {len(on)}; faltan {sorted(set(ov) - set(on)) or 'ninguno'}; "
          f"sobran {sorted(set(on) - set(ov)) or 'ninguno'}")
    for nombre, q in [("funciones", "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace"),
                      ("triggers", "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal"),
                      ("índices", "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'"),
                      ("restricciones", "SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace")]:
        x, y = v.run(q)[0][0], n.run(q)[0][0]
        print(f"{nombre}: {x} / {y} {'OK' if x == y else 'DISTINTO'}")
    distintas = []
    for rel, k in sorted(ov.items()):
        if k in ("r", "p", "m") and rel in on:
            x = v.run(f'SELECT count(*) FROM public."{rel}"')[0][0]
            y = n.run(f'SELECT count(*) FROM public."{rel}"')[0][0]
            if x != y:
                distintas.append((rel, x, y))
    print(f"filas: {sum(1 for r, k in ov.items() if k in ('r', 'p', 'm') and r in on) - len(distintas)} tablas iguales; "
          f"distintas: {len(distintas)}")
    for rel, x, y in distintas:
        print(f"   {rel}: {x} → {y} ({y - x:+d})")
    q_acl = ("SELECT c.relname, a.grantee::regrole::text, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a "
             "WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','m','v','S')")
    av, an = set(map(tuple, v.run(q_acl))), set(map(tuple, n.run(q_acl)))
    print(f"permisos: {len(av - an)} faltan, {len(an - av)} sobran")
    q_d = ("SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace "
           "AND c.relkind IN ('r','p','m','v','S')")
    dv, dn = dict(map(tuple, v.run(q_d))), dict(map(tuple, n.run(q_d)))
    print(f"dueños distintos: {[(r, dv[r], dn[r]) for r in dv if r in dn and dv[r] != dn[r]] or 0}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(required=True)

    p = sub.add_parser("secretos", help="copiar secretos entre proyectos")
    p.add_argument("--origen", required=True); p.add_argument("--destino", required=True)
    p.add_argument("--cuenta-origen"); p.add_argument("--cuenta-destino")
    p.add_argument("nombres", nargs="+"); p.set_defaults(fn=cmd_secretos)

    p = sub.add_parser("vertex-search", help="copiar data store + motor de Vertex AI Search")
    p.add_argument("--origen", required=True); p.add_argument("--destino", required=True)
    p.add_argument("--cuenta-origen"); p.add_argument("--cuenta-destino")
    p.add_argument("--datastore", default="vigia-oece"); p.add_argument("--motor", default="vigia-oece-search")
    p.set_defaults(fn=cmd_vertex_search)

    p = sub.add_parser("catalogo-rag", help="reescribir URIs del catálogo del RAG")
    p.add_argument("--proyecto", required=True); p.add_argument("--bucket-viejo", required=True)
    p.add_argument("--bucket-nuevo", required=True); p.set_defaults(fn=cmd_catalogo_rag)

    p = sub.add_parser("agentes-yaml", help="specs de los 4 servicios de agentes")
    p.add_argument("--proyecto", required=True); p.add_argument("--region", default="us-central1")
    p.add_argument("--imagen", required=True); p.add_argument("--docai", required=True)
    p.add_argument("--rag-bucket", required=True); p.add_argument("--salida", default="agentes-yaml")
    p.set_defaults(fn=cmd_agentes_yaml)

    p = sub.add_parser("comparar-bases", help="comparar dos bases (solo lectura)")
    p.add_argument("--origen", required=True, help='"host=<ip> user=postgres dbname=vigia password_env=PGPW_ORIGEN"')
    p.add_argument("--destino", required=True, help='"host=<ip> user=postgres dbname=vigia password_env=PGPW_DESTINO"')
    p.set_defaults(fn=cmd_comparar_bases)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
