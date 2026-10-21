#!/usr/bin/env bash
# Servicios SOMBRA para comparar modelos (backend/scripts/ab_modelos.py).
#
# Copian el spec vivo de agent-orchestrator-adk (mismo código, mismos secretos, misma red) y cambian solo:
#   · PGUSER=vigia_ab + PGPASSWORD=db-password-ab → rol de SOLO LECTURA (migración 44): no pueden pisar análisis reales
#   · USAR_WORKERS_AI=0|1 (+ lo que pase en EXTRA_ENV) → qué proveedor usan los agentes
#   · nombre agente-ab-<variante>, hasta 3 instancias
#
#   IMAGE=us-central1-docker.pkg.dev/…/agentes:<sha> bash infrastructure/deploy/gcp/agente-ab.sh crear gemini 0
#   IMAGE=… bash infrastructure/deploy/gcp/agente-ab.sh crear glm 1
#   EXTRA_ENV="USAR_WORKERS_AI_PERSON_NETWORK=0" bash …/agente-ab.sh crear glm-sin-red 1
#   SECRETS_ENV="ANTHROPIC_API_KEY=anthropic-api-key" EXTRA_ENV="USAR_ANTHROPIC=1,ANTHROPIC_WORKSPACE_ID=wrkspc_…" bash …/agente-ab.sh crear haiku 0
#   bash infrastructure/deploy/gcp/agente-ab.sh borrar gemini glm
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
BASE="agent-orchestrator-adk"
CMD="${1:-}"; shift || true

crear() {
  local variante="$1" workers="$2" svc="agente-ab-$1"
  [[ -n "${IMAGE:-}" ]] || { echo "falta IMAGE=<imagen de agentes>" >&2; exit 2; }
  local tmp; tmp="$(mktemp -t "${svc}.XXXXXX.yaml")"
  gcloud run services describe "$BASE" --region "$REGION" --format yaml > "$tmp.base"
  SVC="$svc" MEM="${MEM:-}" IMAGE="$IMAGE" WORKERS="$workers" EXTRA_ENV="${EXTRA_ENV:-}" SECRETS_ENV="${SECRETS_ENV:-}" "${PYTHON:-python}" - "$tmp.base" "$tmp" <<'PY'
import os, sys, yaml
src, dst = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(src, encoding="utf-8"))
d.pop("status", None)
md = d["metadata"]
for k in ("creationTimestamp", "generation", "resourceVersion", "selfLink", "uid"):
    md.pop(k, None)
md["name"] = os.environ["SVC"]
md["annotations"] = {k: v for k, v in (md.get("annotations") or {}).items() if k == "run.googleapis.com/ingress"}
md["labels"] = {k: v for k, v in (md.get("labels") or {}).items() if "cloudfunctions" not in k and k != "goog-managed-by"}
md["labels"]["vigia-perfil"] = "ab"
tpl = d["spec"]["template"]
tmd = tpl.setdefault("metadata", {})
tmd.pop("name", None)
tmd["annotations"] = {k: v for k, v in (tmd.get("annotations") or {}).items()
                      if not k.startswith(("cloudfunctions.googleapis.com/", "run.googleapis.com/client-"))}
tmd["annotations"]["autoscaling.knative.dev/maxScale"] = "3"
tmd["labels"] = {k: v for k, v in (tmd.get("labels") or {}).items() if "cloudfunctions" not in k and k != "goog-managed-by"}
c = tpl["spec"]["containers"][0]
c["image"] = os.environ["IMAGE"]
if os.environ.get("MEM"):  # p. ej. MEM=4Gi: varias sombras a la vez caben en la cuota de memoria de Cloud Run
    c.setdefault("resources", {}).setdefault("limits", {})["memory"] = os.environ["MEM"]
nuevas = {"PIPELINE_PROFILE": "bienes", "PGUSER": "vigia_ab", "USAR_WORKERS_AI": os.environ["WORKERS"]}
for par in filter(None, os.environ.get("EXTRA_ENV", "").split(",")):
    k, v = par.split("=", 1)
    nuevas[k.strip()] = v
env = []
for e in c.get("env") or []:
    if e["name"] in nuevas:
        continue
    if e["name"] == "PGPASSWORD":  # mismo nombre de variable, secreto de SOLO LECTURA
        e = {"name": "PGPASSWORD", "valueFrom": {"secretKeyRef": {"key": "latest", "name": "db-password-ab"}}}
    env.append(e)
env += [{"name": k, "value": v} for k, v in nuevas.items()]
for par in filter(None, os.environ.get("SECRETS_ENV", "").split(",")):  # NOMBRE=secreto-de-secret-manager
    k, sec = par.split("=", 1)
    env = [e for e in env if e["name"] != k.strip()]
    env.append({"name": k.strip(), "valueFrom": {"secretKeyRef": {"key": "latest", "name": sec.strip()}}})
c["env"] = env
d["spec"]["traffic"] = [{"percent": 100, "latestRevision": True}]
yaml.safe_dump(d, open(dst, "w", encoding="utf-8"), sort_keys=False, allow_unicode=True)
print(f"spec de {os.environ['SVC']}: {len(env)} variables")
PY
  gcloud run services replace "$tmp" --region "$REGION" --quiet
  local sa; sa="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
  gcloud run services add-iam-policy-binding "$svc" --region "$REGION" --member="serviceAccount:${sa}" --role=roles/run.invoker --quiet >/dev/null
  rm -f "$tmp" "$tmp.base"
  echo "✓ $svc $(gcloud run services describe "$svc" --region "$REGION" --format='value(status.url)')"
}

case "$CMD" in
  crear) crear "$@" ;;
  borrar) for v in "$@"; do gcloud run services delete "agente-ab-$v" --region "$REGION" --quiet; done ;;
  *) sed -n 2,13p "$0"; exit 2 ;;
esac
