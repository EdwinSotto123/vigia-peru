# Convocatorias OCDS del OECE. 403 confirmado desde IP de nube (WAF): NO se agenda con Cloud Scheduler; correr con docker en el VPS de Lima o la laptop, como scrapers-job.sh hoy.
# Ver backend/cloud_functions/README.md (matriz cloud-safe / Peru-only, cómo se despliega).
FROM us-central1-docker.pkg.dev/vivid-spot-480905-a4/cloud-run-source-deploy/scrapers-base:latest
ENTRYPOINT ["python", "-m", "backend.scrapers.oece_ocds.pipeline"]
