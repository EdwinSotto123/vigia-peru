# A/B de modelos · 20261012-064917

Base: **gemini** · contratos: 20

## Resumen por variante

| variante | completó | tiempo mediano | costo medio | tokens medios | llamadas | respaldo bandera | cita norma | precio plausible | tono ok | URL/RUC/DNI sin respaldo | banderas citadas que no existen | descartes de esquema | acusatorio |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **gemini** | 20/20 | 255.0 s | 0.1131 USD | 182515 | 19 | 75% | 100% | 89% | 100% | 0 | 3 | 57 | 1 |
| **glm** | 20/20 | 364.0 s | 0.0616 USD | 151748 | 18 | 73% | 100% | 75% | 100% | 0 | 46 | 79 | 0 |

## glm frente a gemini

- **Banderas:** coinciden 18 · solo gemini: 20 · solo glm: 22 → acuerdo 30%
- **Veredicto de mercado igual:** 14/20
- **Extracción de documentos** (menor/mayor, 100 % = igual): ítems 100% · postores 100% · firmantes 100%
- **Ahorro de costo medio:** 43%

## Por agente: glm frente a gemini

| agente | banderas coinciden | solo gemini | solo glm | acuerdo | `sin_dato` gemini | `sin_dato` glm | costo medio gemini | costo medio glm |
|---|---|---|---|---|---|---|---|---|
| regla | 9 | 0 | 0 | 100% | 0 | 0 | 0.0000 | 0.0000 |
| legal | 9 | 9 | 12 | 30% | 8 | 6 | 0.0239 | 0.0063 |
| person_network (conteo; texto libre) | 11 en gemini | — | 8 en glm | n/c | 0 | 0 | 0.0230 | 0.0154 |
| compliance_ext | 0 | 0 | 2 | 0% | 18 | 16 | 0.0034 | 0.0012 |
| report_writer (costo) | — | — | — | — | — | — | 0.0336 | 0.0091 |

## Por contrato

| ocid | gemini: s / USD / banderas / sin respaldo / fantasma | glm: s / USD / banderas / sin respaldo / fantasma |
|---|---|---|
| 1226968 | 323.6 / 0.147 / 1 / 0 / 0 | 317.3 / 0.056 / 1 / 0 / 3 |
| 1226572 | 540.3 / 0.121 / 3 / 0 / 0 | 206.7 / 0.049 / 0 / 0 / 0 |
| 1225394 | 222.6 / 0.113 / 0 / 0 / 0 | 376.4 / 0.096 / 0 / 0 / 3 |
| 1226228 | 224.6 / 0.112 / 4 / 0 / 0 | 349.2 / 0.061 / 5 / 0 / 3 |
| 1225562 | 202.7 / 0.091 / 1 / 0 / 0 | 497.6 / 0.064 / 1 / 0 / 3 |
| 1226288 | 255.0 / 0.100 / 1 / 0 / 0 | 364.0 / 0.045 / 1 / 0 / 4 |
| 1227786 | 208.2 / 0.101 / 2 / 0 / 0 | 354.3 / 0.057 / 2 / 0 / 2 |
| 1225958 | 335.1 / 0.139 / 1 / 0 / 0 | 463.7 / 0.087 / 3 / 0 / 0 |
| 1226168 | 218.9 / 0.093 / 0 / 0 / 0 | 582.3 / 0.064 / 0 / 0 / 3 |
| 1225407 | 194.7 / 0.083 / 2 / 0 / 0 | 314.4 / 0.050 / 2 / 0 / 0 |
| 1228898 | 277.9 / 0.102 / 3 / 0 / 0 | 453.5 / 0.064 / 4 / 0 / 4 |
| 1226432 | 160.2 / 0.085 / 0 / 0 / 0 | 279.5 / 0.062 / 1 / 0 / 3 |
| 1225486 | 134.3 / 0.064 / 0 / 0 / 3 | 279.7 / 0.039 / 2 / 0 / 3 |
| 1227539 | 323.1 / 0.090 / 1 / 0 / 0 | 344.9 / 0.062 / 2 / 0 / 3 |
| 1229287 | 298.5 / 0.090 / 2 / 0 / 0 | 385.9 / 0.052 / 1 / 0 / 3 |
| 1228889 | 557.9 / 0.201 / 2 / 0 / 0 | 563.2 / 0.066 / 4 / 0 / 3 |
| 1226232 | 143.4 / 0.094 / 2 / 0 / 0 | 298.8 / 0.060 / 2 / 0 / 3 |
| 1230874 | 375.2 / 0.143 / 2 / 0 / 0 | 416.7 / 0.080 / 1 / 0 / 0 |
| 1225755 | 213.6 / 0.096 / 6 / 0 / 0 | 360.1 / 0.060 / 6 / 0 / 0 |
| 1226954 | 470.0 / 0.198 / 5 / 0 / 0 | 371.1 / 0.058 / 2 / 0 / 3 |
