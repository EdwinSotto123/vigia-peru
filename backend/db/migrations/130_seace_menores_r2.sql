-- 130 · Marca de los requerimientos de contratos menores ya espejados a R2 (bucket vigia-peru-batch, clave
-- seace/menores/req/<id_contrato>.pdf). El requerimiento vive en prod6, cuyo WAF bloquea el egress de Cloudflare, así
-- que no se puede servir en vivo desde el Worker: el cargador (backend/scripts/cargar_seace_menores.py --espejar) lo baja
-- desde la PC y lo sube a R2, y recién ahí la API lo sirve y el botón «Requerimiento (TDR)» aparece. `req_r2=true` =
-- el PDF está en R2 y es descargable.
ALTER TABLE seace_menores ADD COLUMN IF NOT EXISTS req_r2 BOOLEAN NOT NULL DEFAULT false;
