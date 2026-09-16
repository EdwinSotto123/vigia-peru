# Autoridades vigentes/electas (reporte oficial JNE, vía PNDA). Cloud Scheduler: día 5.
# Ver backend/cloud_functions/README.md (matriz cloud-safe / Peru-only, cómo se despliega).
FROM us-central1-docker.pkg.dev/vivid-spot-480905-a4/cloud-run-source-deploy/scrapers-base:latest
ENTRYPOINT ["python", "-m", "backend.scrapers.jne_infogob.pipeline"]
