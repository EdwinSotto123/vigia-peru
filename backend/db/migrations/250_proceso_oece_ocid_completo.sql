-- 250 · Contrataciones Abiertas del OECE abre un proceso SOLO con el OCID completo: /proceso/ocds-dgv273-seacev3-<ocid>.
-- Las reglas del agente guardaban /proceso/<ocid de Vigía> («No se encontró el proceso de contratación»; aviso del
-- 2026-11-04 sobre 1229308). El agente ya lo arma bien (backend/agent/tools/fuentes.py); esto corrige lo guardado:
-- banderas (641), la fuente de la alerta (372), el texto del dictamen (227) y analisis_full (306), y lleva el dominio
-- viejo (contratacionesabiertas.osce.gob.pe, que no responde) al nuevo. senales_publicas es una vista de banderas.
-- Idempotente: sólo toca las URL sin el prefijo «ocds-».

UPDATE banderas
   SET fuente_url = regexp_replace(fuente_url, '^https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)',
                                   'https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-')
 WHERE fuente_url ~ '^https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)';

UPDATE alertas
   SET fuente_url = regexp_replace(fuente_url, '^https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)',
                                   'https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-')
 WHERE fuente_url ~ '^https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)';

UPDATE alertas
   SET dictamen_markdown = regexp_replace(dictamen_markdown,
                                          'https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)([0-9])',
                                          'https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-\1', 'g')
 WHERE dictamen_markdown ~ 'contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)[0-9]';

UPDATE alertas
   SET analisis_full = regexp_replace(analisis_full::text,
                                      'https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)([0-9])',
                                      'https://contratacionesabiertas.oece.gob.pe/proceso/ocds-dgv273-seacev3-\1', 'g')::jsonb
 WHERE analisis_full::text ~ 'contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/(?!ocds-)[0-9]';
