# Set de prueba: actas de buena pro

Mide qué tan bien un modelo lee el «otorgamiento de la buena pro» de un proceso del SEACE (quiénes se presentaron, quién
quedó fuera y por qué, quién ganó y por cuánto), antes de leer las ~3 700 actas que ya están en el R2.

- **Casos** (`armar_casos.py`): 100 actas de procesos de un ítem y un ganador en soles, en tres estratos
  (`bandera_alta` 50, `varios_postores` 30, `postor_unico` 20).
- **Respuesta oficial**: viene de CONOSCE, no de un modelo. Trae los postores (con el nombre y los integrantes de cada
  consorcio, que en CONOSCE tienen un código propio y no un RUC), el ganador y el monto adjudicado.
- **Extractor** (`comun.py`, v2): el modelo extrae HECHOS; las banderas las calcula `banderas_de` con reglas fijas.
- **Ejecutor** (`correr.py`): se reanuda donde quedó. Lo que no llegó a respuesta va a `errors.jsonl` y no cuenta como error
  del modelo.
- **Calificador** (`calificar.py`): compara contra CONOSCE, verifica las citas en los PDF con texto y mide la estabilidad de
  las banderas entre dos corridas. Escribe `informe.md`.
- **Datos**: las actas, las respuestas y el detalle por caso quedan en `datos/` (en `.gitignore`: traen nombres de personas).

```bash
python -X utf8 backend/evals/actas_buena_pro/armar_casos.py              # una vez (o --solo-oficial)
python -X utf8 backend/evals/actas_buena_pro/correr.py --etiqueta <etiqueta-bajo> --esfuerzo low
python -X utf8 backend/evals/actas_buena_pro/calificar.py <etiqueta-bajo> <etiqueta-medio>
```

Las llamadas van por el Worker `vigia-llm` (`/nativo`) y los documentos por `vigia-r2-sync`. Las dos llaves salen de SSM.
Hoy `vigia-llm` responde `/nativo` sólo con modelos abiertos de Workers AI: `--modelo` es un alias interno que traduce
`NATIVO_MODELOS`, y con el de defecto responde DeepSeek V4.1 Flash.

## Resultado del 2026-11-03

Medido con el modelo comercial que `/nativo` usaba entonces, antes de pasar a modelos abiertos. Con los de hoy no hay
medición en este set: `informe.md` sólo tiene las corridas de entonces.

| | Esfuerzo bajo | Esfuerzo medio |
|---|---|---|
| Ganador | 98 % | 99 % |
| Monto del ganador (±1 %) | 98 % | 98 % |
| Postores de CONOSCE encontrados | 96 % | 98 % |
| Motivo de cada descartado | 100 % | 100 % |
| Costo por acta (en lote) | USD 0,0011 | USD 0,0013 |

- **Contar los postores** falla sobre todo cuando el acta es un aviso de 2-3 páginas que sólo nombra al ganador: ahí falta
  el dato en el documento, no en la lectura.
- **Banderas por reglas** (postor único, solo queda el ganador, descalificados por una formalidad): iguales entre corridas
  (0,88-1,00).
- **Observaciones que elige el modelo** (requisito a la medida, fechas irregulares, otra irregularidad): coinciden sólo
  0,29-0,47 entre corridas. No van como bandera sin una segunda lectura que las confirme.

Un modelo más grande del mismo proveedor (piloto de 14 actas) costaba unas 30 veces más por acta y no acertó más en
ganador ni postores. Detalle: `informe.md`.
