# Pruebas A/B de modelos (Gemini vs Cloudflare Workers AI)

Mismo pipeline real de agentes, mismos contratos y mismas entradas (OCDS, documentos, clasificación), con un rol de base
de **solo lectura** para que la prueba no pise análisis reales.

```
infrastructure/deploy/gcp/agente-ab.sh crear <variante> 0|1   # servicio sombra (USAR_WORKERS_AI=0|1), rol vigia_ab (migración 44)
backend/scripts/ab_modelos.py correr --n 20 --variante gemini=<url> --variante glm=<url>
backend/scripts/ab_modelos.py correr --completar <carpeta> ...   # reintenta lo que falló (429 de cuota)
backend/scripts/ab_modelos.py comparar <carpeta> --base gemini    # informe markdown
```

Las salidas completas (`backend/scripts/ab_out/`) llevan datos de contratos y están en `.gitignore`.

## Resultado 2026-10-12 — `@cf/zai-org/glm-5.3-flash` (razonamiento `low`) vs `gemini-3.6-flash`, 20 contratos

Ver `informe-2026-10-12-glm-5.3-flash-vs-gemini-3.6-flash.md`. Resumen:

| | Gemini | GLM (todos los agentes elegibles) |
|---|---|---|
| Completó | 20/20 | 20/20 |
| Costo medio por contrato | US$0,113 | US$0,062 (−43 %) |
| Tiempo mediano | 255 s | 364 s (+43 %) |
| Banderas coincidentes | — | 30 % (legal 30 %; reglas de código 100 %) |
| Precio plausible (juez) | 89 % | 75 % |
| URL/RUC/DNI sin respaldo | 0 | 0 |
| Banderas citadas que no existen | 3 | 46 |

Lecciones técnicas (todas medidas):
- GLM razona sin parar: sin límite agota el presupuesto pensando y Workers AI corta con error 3046. `reasoning_effort: low` lo
  arregla (27 s → 3 s en una consulta corta). El Worker `vigia-llm` lo pone por defecto y limita `max_tokens`.
- El primer pedido tras un rato sin uso puede tardar ~100 s (arranque en frío del modelo).
- Los agentes con `google_search` y el orquestador siguen en Gemini. La extracción de documentos sale de caché (idéntica en ambos).
- Costos: `glm-5.3-flash` ≈ US$0,15 / 0,50 por millón de tokens (entrada / salida), medido por neuronas.
