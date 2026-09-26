#!/usr/bin/env bash
# Despliega los CUATRO servicios de agentes (mismo código backend/agent, distinto PIPELINE_PROFILE):
#   bienes    → agent-orchestrator-adk   (servicio histórico; se ACTUALIZA, nunca se recrea)
#   servicios → agente-servicios
#   obras     → agente-obras
#   otros     → agente-otros             (consultoría · convenio · directa · otro)
#
# Uso:  bash infrastructure/deploy/agentes.sh [bienes|servicios|obras|otros|all]   (default: all)
#       IMAGE=us-central1-docker.pkg.dev/…/agentes:abc123 bash infrastructure/deploy/agentes.sh obras  (reusar imagen)
#       EXTRA_ENV="PARALLEL_RESEARCH=0" bash infrastructure/deploy/agentes.sh all   (variables extra, mergeadas)
#
# Cómo funciona:
#   1. La imagen se construye UNA vez con Cloud Build (Dockerfile de backend/agent) y se etiqueta
#      con el sha del árbol: $AR_REPO/agentes:<sha>.
#   2. bienes: `gcloud run services update agent-orchestrator-adk --image … --update-env-vars …`.
#      NUNCA --set-env-vars: borra las ~40 variables, los secretos montados y Cloud SQL.
#   3. servicios/obras/otros: se toma el spec vivo de agent-orchestrator-adk (`describe --format yaml`),
#      se limpian los campos de solo lectura, se cambia nombre/imagen/PIPELINE_PROFILE y se aplica con
#      `gcloud run services replace` → heredan variables, secretos, Cloud SQL, 8Gi/2 CPU/3600 s/
#      concurrency 1 sin transcribirlos. Luego roles/run.invoker a la cuenta de servicio que los invoca
#      (INVOKER_SA; default: la SA de Compute que usan frontend, API y dispatcher). allUsers SOLO con
#      AGENTES_PUBLICOS=1 (comportamiento histórico): el objetivo es que los agentes sean IAM-only.
#   4. Verifica GET / de cada servicio (devuelve {ok, perfil, modelos}) con un ID token de gcloud.
#   DECOLECTA_API_KEY: bienes la monta desde Secret Manager (secretos_decolecta_flags, _common.sh);
#   servicios/obras/otros la heredan al copiar el spec.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

QUE="${1:-all}"
AR_REPO="${AR_REPO:-us-central1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy}"
BASE_SERVICE="agent-orchestrator-adk"
EXTRA_ENV="${EXTRA_ENV:-}"
# CUOTA: "Total memory allocation" de Cloud Run en us-central1 es 40 GiB para TODO el proyecto
# (compartido con ~40 servicios). 4 servicios x 8Gi = 32 GiB con UNA instancia cada uno: los
# perfiles nuevos salen con maxScale=1 (MAX_INSTANCES_PERFIL) y bienes conserva su maxScale.
# Con la cuota saturada (instancias corriendo) el rollout falla con "Quota exceeded for total
# allowable memory" o "no available instance": reintentar cuando no haya análisis en curso o
# pedir aumento de cuota (Cloud Run > Quotas > Total memory allocation, us-central1).
MAX_INSTANCES_PERFIL="${MAX_INSTANCES_PERFIL:-1}"
# Cuota "Total memory allocation" del proyecto (us-central1) = 40 GiB compartidos con ~40 servicios:
# los perfiles nuevos van con 4Gi (bienes conserva 8Gi). Pedir aumento a ≥128 GiB para volver a 8Gi.
MEMORIA_PERFIL="${MEMORIA_PERFIL:-4Gi}"
# Modelos por tier (verificados 2026-09-15 en Vertex global). Se pueden sobreescribir por env.
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.6-flash}"
GEMINI_MODEL_SMART="${GEMINI_MODEL_SMART:-gemini-3.6-flash}"
GEMINI_MODEL_FAST="${GEMINI_MODEL_FAST:-gemini-3.5-flash-lite}"
GEMINI_MODEL_JUDGE="${GEMINI_MODEL_JUDGE:-gemini-3.5-flash-lite}"
# Flex PayGo (50 % menos) por llamada, con salida a Standard si Flex no atiende (backend/agent/tools/flex.py).
GEMINI_FLEX="${GEMINI_FLEX:-1}"
MODEL_ENV="GEMINI_MODEL=${GEMINI_MODEL},GEMINI_MODEL_SMART=${GEMINI_MODEL_SMART},GEMINI_MODEL_FAST=${GEMINI_MODEL_FAST},GEMINI_MODEL_JUDGE=${GEMINI_MODEL_JUDGE},GEMINI_FLEX=${GEMINI_FLEX}"

declare -A SERVICIO=( [bienes]="$BASE_SERVICE" [servicios]="agente-servicios" [obras]="agente-obras" [otros]="agente-otros" )
# Quién invoca a los agentes (frontend /api/agent/*, API /admin/operacion, job vigia-dispatcher): hoy
# todos corren con la SA de Compute por defecto.
AGENTES_PUBLICOS="${AGENTES_PUBLICOS:-0}"
if [[ -z "${INVOKER_SA:-}" ]]; then
  INVOKER_SA="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi

case "$QUE" in
  all) PERFILES=(bienes servicios obras otros) ;;
  bienes|servicios|obras|otros) PERFILES=("$QUE") ;;
  *) echo "uso: $0 [bienes|servicios|obras|otros|all]" >&2; exit 2 ;;
esac

# ── 1. Imagen (una sola vez) ────────────────────────────────────────────────
if [[ -z "${IMAGE:-}" ]]; then
  if ! gcloud artifacts repositories describe cloud-run-source-deploy --location us-central1 >/dev/null 2>&1; then
    gcloud artifacts repositories create cloud-run-source-deploy --repository-format=docker --location=us-central1 --quiet
  fi
  SHA="$(cd "$REPO_ROOT" && git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
  # Árbol sucio (cambios sin commit) → sufijo con timestamp para no pisar la imagen del commit.
  if ! (cd "$REPO_ROOT" && git diff --quiet HEAD -- backend/agent 2>/dev/null); then SHA="${SHA}-$(date +%H%M%S)"; fi
  IMAGE="${AR_REPO}/agentes:${SHA}"
  echo "▶ construyendo ${IMAGE}"
  gcloud builds submit "$REPO_ROOT/backend/agent" --tag "$IMAGE" --quiet
fi
echo "imagen: $IMAGE"

# ── helpers ─────────────────────────────────────────────────────────────────
env_flag() {  # PIPELINE_PROFILE + modelos + EXTRA_ENV
  local perfil="$1"
  local vars="PIPELINE_PROFILE=${perfil},${MODEL_ENV}"
  [[ -n "$EXTRA_ENV" ]] && vars="${vars},${EXTRA_ENV}"
  echo "$vars"
}

verificar() {  # GET / → {ok, perfil, …}
  local svc="$1" perfil="$2"
  local url; url="$(gcloud run services describe "$svc" --region "$REGION" --format='value(status.url)')"
  # ID token (el servicio puede ser IAM-only): --audiences solo vale para cuentas de servicio
  # (Cloud Build); con cuenta de usuario, gcloud emite uno que Cloud Run acepta sin audiencia.
  local tok; tok="$(gcloud auth print-identity-token --audiences="$url" 2>/dev/null || gcloud auth print-identity-token 2>/dev/null || true)"
  local auth=(); [[ -n "$tok" ]] && auth=(-H "Authorization: Bearer ${tok}")
  local body; body="$(curl -fsS --max-time 60 "${auth[@]}" "$url/" || true)"
  if [[ "$body" == *"\"perfil\": \"${perfil}\""* ]]; then
    echo "✓ ${svc} ${url} → perfil ${perfil}"
  else
    echo "✗ ${svc} ${url} → respuesta inesperada: ${body:0:300}" >&2
    return 1
  fi
}

replace_desde_base() {  # crea/actualiza agente-<perfil> copiando el spec vivo del de bienes
  local perfil="$1" svc="${SERVICIO[$1]}"
  local tmp; tmp="$(mktemp -t "${svc}.XXXXXX.yaml")"
  gcloud run services describe "$BASE_SERVICE" --region "$REGION" --format yaml > "$tmp.base"
  IMAGE="$IMAGE" SVC="$svc" PERFIL="$perfil" MODEL_ENV="$MODEL_ENV" EXTRA_ENV="$EXTRA_ENV" MAX_INSTANCES_PERFIL="$MAX_INSTANCES_PERFIL" MEMORIA_PERFIL="$MEMORIA_PERFIL" \
  "${PYTHON:-python}" - "$tmp.base" "$tmp" <<'PY'
import os, sys, yaml
src, dst = sys.argv[1], sys.argv[2]
d = yaml.safe_load(open(src, encoding="utf-8"))
# Solo lectura / propios del servicio origen.
d.pop("status", None)
md = d["metadata"]
for k in ("creationTimestamp", "generation", "resourceVersion", "selfLink", "uid"):
    md.pop(k, None)
md["name"] = os.environ["SVC"]
ann = md.get("annotations") or {}
keep = {"run.googleapis.com/ingress"}
md["annotations"] = {k: v for k, v in ann.items() if k in keep}
labels = md.get("labels") or {}
md["labels"] = {k: v for k, v in labels.items() if "cloudfunctions" not in k and k != "goog-managed-by"}
md["labels"]["vigia-perfil"] = os.environ["PERFIL"]
tpl = d["spec"]["template"]
tmd = tpl.setdefault("metadata", {})
tmd.pop("name", None)
tann = tmd.get("annotations") or {}
drop_prefix = ("cloudfunctions.googleapis.com/", "run.googleapis.com/client-")
tmd["annotations"] = {k: v for k, v in tann.items() if not k.startswith(drop_prefix)}
tmd["annotations"]["autoscaling.knative.dev/maxScale"] = os.environ.get("MAX_INSTANCES_PERFIL", "1")
cont = tpl["spec"]["containers"][0]
cont.setdefault("resources", {}).setdefault("limits", {})["memory"] = os.environ.get("MEMORIA_PERFIL", "4Gi")
tlabels = tmd.get("labels") or {}
tmd["labels"] = {k: v for k, v in tlabels.items() if "cloudfunctions" not in k and k != "goog-managed-by"}
c = tpl["spec"]["containers"][0]
c["image"] = os.environ["IMAGE"]
# Variables: PIPELINE_PROFILE + modelos + extra; el resto (secretos, Cloud SQL, PG*, DOCAI, relay…) se hereda.
nuevas = {}
for par in (os.environ["MODEL_ENV"] + ("," + os.environ["EXTRA_ENV"] if os.environ.get("EXTRA_ENV") else "")).split(","):
    if "=" in par:
        k, v = par.split("=", 1)
        nuevas[k.strip()] = v
nuevas["PIPELINE_PROFILE"] = os.environ["PERFIL"]
env = [e for e in (c.get("env") or []) if e.get("name") not in nuevas]
env += [{"name": k, "value": v} for k, v in nuevas.items()]
c["env"] = env
d["spec"]["traffic"] = [{"percent": 100, "latestRevision": True}]
yaml.safe_dump(d, open(dst, "w", encoding="utf-8"), sort_keys=False, allow_unicode=True)
print(f"spec de {os.environ['SVC']}: {len(env)} variables, imagen {os.environ['IMAGE']}")
PY
  gcloud run services replace "$tmp" --region "$REGION" --quiet
  if [[ "$AGENTES_PUBLICOS" == "1" ]]; then
    gcloud run services add-iam-policy-binding "$svc" --region "$REGION" --member=allUsers --role=roles/run.invoker --quiet >/dev/null
  else
    # Aditivo e idempotente: no quita allUsers si ya estaba (eso se hace a propósito, después de
    # desplegar los clientes con ID token — ver infrastructure/README.md).
    gcloud run services add-iam-policy-binding "$svc" --region "$REGION" --member="serviceAccount:${INVOKER_SA}" --role=roles/run.invoker --quiet >/dev/null
  fi
  rm -f "$tmp" "$tmp.base"
}

# ── 2/3. Despliegue por perfil ──────────────────────────────────────────────
for perfil in "${PERFILES[@]}"; do
  svc="${SERVICIO[$perfil]}"
  echo "▶ ${perfil} → ${svc}"
  if [[ "$perfil" == "bienes" ]]; then
    mapfile -t SECRET_FLAGS < <(secretos_decolecta_flags)
    gcloud run services update "$svc" --region "$REGION" --image "$IMAGE" \
      --update-env-vars "$(env_flag bienes)" "${SECRET_FLAGS[@]}" --quiet
  else
    replace_desde_base "$perfil"
  fi
done

# ── 4. Verificación ─────────────────────────────────────────────────────────
rc=0
for perfil in "${PERFILES[@]}"; do
  verificar "${SERVICIO[$perfil]}" "$perfil" || rc=1
done
exit $rc
