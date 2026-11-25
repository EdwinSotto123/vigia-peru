# Lector de documentos

La lectura de los documentos de las contrataciones (bases, actas, contratos, cuadros de evaluación, garantías y demás),
cada documento una sola vez, y lo que se saca de ellos: texto, piezas, fichas y banderas. Son scripts de Python que
escriben en la base. Lo leído lo usan la ficha del contrato, el laboratorio de precios y los agentes.

## Las capas

| Paso | Script | Con modelo | Qué deja |
|---|---|---|---|
| 1 | `texto.py` | no | el texto de cada página (PyMuPDF), en `documentos_texto` |
| 2 | `piezas.py` | no | cada documento cortado en piezas con su tipo, y lo que se lee por plantilla o por regla (`documento_pieza`, `pieza_lectura`); `--bases` lee las bases por secciones |
| 3 | `transcribir.py` | sí, con visión | el texto de las páginas escaneadas, en la misma fila de `documentos_texto` |
| 4 | `por_pieza.py --lector <tipo>` | sí | la ficha de cada pieza (bases, contrato, evaluación, garantía, modificación, resolución, desierto…) en `pieza_lectura` |
| 5 | `backend/scripts/tareas_ci.py prod refrescar-piezas` | no | postores, ítems y hechos por proceso |

`por_pieza.py` comprueba que cada cita que copió el modelo esté en el texto que se le dio. Las lecturas por regla de la
misma pieza quedan al lado, como segunda lectura independiente (`backend/evals/hechos/comparar.py` mide cuánto
coinciden).

**Contratos menores** (hasta 8 UIT): `menores.py` lee el requerimiento (`menor_tdr`) y el contrato u orden
(`menor_contrato`) y guarda en `menor_lectura`; `menor_marcas.py` mira las marcas que nombra el requerimiento.
`cadena_menores.sh` corre todo en orden y al final refresca las señales.

`leer.py`, `continuo.py`, `orquestar_workers.py` y `publicar.py` son la primera versión, por clase de documento
(`documento_lectura`).

## Modelos

Todo va por `vigia-llm` (`backend/llm-worker`), que sólo sirve modelos abiertos de Workers AI:

- `motor_workers.py` (pasos 3 y 4, y `leer.py --motor workers`): `/v1/chat/completions` con DeepSeek V4.1 Flash por
  defecto (`MODELO_DEFECTO`; `--modelo` para otro) y `x-vigia-respaldo: nunca`.
- `base.py` (`menores.py` y `leer.py` sin `--motor`): la ruta `/nativo`, que `vigia-llm` también responde con Workers AI
  (DeepSeek V4.1 Flash o GLM 5.3, según `NATIVO_MODELOS`).

Los documentos se bajan de R2 por `vigia-r2-sync` (`/objeto`). Los tokens salen de SSM, nunca de un archivo.

## Topes

- Cada corrida tiene su `--tope-usd` y su `--limite`.
- Los pasos con modelo de piezas (3 y 4) tienen además un tope total contado en la base (`TOPE_TOTAL_USD`, US$ 315, en
  `pieza_lectura.costo_usd`). Al llegar, salen sin hacer nada.
- Un candado en la base (`pg_try_advisory_lock`) evita que dos corridas lean la misma cola a la vez.
- Todo es reanudable: lo ya leído no se vuelve a leer.

## Dónde corre

En GitLab CI, contra producción por el túnel a la base, con el rol `vigia_ci` (`.gitlab-ci.yml`):

- `tarea:piezas`: los pasos 1 a 5, con un tiempo por paso (job de 3 h).
- `tarea:lector-menores`: `bash backend/lector/cadena_menores.sh prod 15 8`.

Los dos son manuales en `main` o corren por horario. También se pueden correr desde una PC, por ejemplo
`python -X utf8 backend/lector/por_pieza.py prod --lector bases --limite 50 --tope-usd 1` (el uso de cada script está en
su encabezado).

## Probar

```bash
python -m pytest backend/lector/tests -q      # sin red ni modelo
```
