# Registro de visitas a entidades (PNDA, mensual). Cloud Scheduler: días 1 y 15.
# Ver backend/cloud_functions/README.md (matriz cloud-safe / Peru-only, cómo se despliega).
FROM us-central1-docker.pkg.dev/vivid-spot-480905-a4/cloud-run-source-deploy/scrapers-base:latest
ENTRYPOINT ["python", "-m", "backend.scrapers.pnda_visitas.pipeline"]
