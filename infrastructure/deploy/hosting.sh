#!/usr/bin/env bash
# Publica la configuración de Firebase Hosting (infrastructure/hosting/firebase.json): CDN delante del
# frontend y de la API. No construye ni despliega los servicios de Cloud Run.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../hosting"
firebase deploy --only hosting:vigia-peru --project vivid-spot-480905-a4 --non-interactive
