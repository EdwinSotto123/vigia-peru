#!/usr/bin/env bash
# Publica la configuración de Firebase Hosting (infrastructure/hosting/firebase.json): CDN delante del
# frontend y de la API. No construye ni despliega los servicios de Cloud Run.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
cd "$(dirname "${BASH_SOURCE[0]}")/../hosting"
# El sitio vigia-peru.web.app es del proyecto de la entrada (ENTRADA_PROJECT_ID).
firebase deploy --only hosting:vigia-peru --project "$ENTRADA_PROJECT_ID" --non-interactive
