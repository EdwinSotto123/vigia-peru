# Set de prueba: actas de buena pro

100 actas de procesos de un ítem y un ganador en soles. Respuesta oficial de CONOSCE: postores (con el nombre y los integrantes de cada consorcio), ganador y monto adjudicado. Estratos: bandera_alta 50, postor_unico 20, varios_postores 30.
Generado por `calificar.py`; el detalle por caso queda en `datos/` (fuera del repo: trae nombres).

## v2-haiku-medio (claude-haiku-5-5, esfuerzo medium)

- Respuestas: {'ok': 100}; sin respuesta (red o límite): 0.
- Costo: USD 0.265 en total, 0.0026 por acta (en lote, 0.0013); tokens por acta (mediana) 11028 de entrada y 2375 de salida; 11 s.

| Métrica | Todo | postor_unico | bandera_alta | varios_postores |
|---|---|---|---|---|
| Reconoce el acta | 100 % (n=100) | 100 % (n=20) | 100 % (n=50) | 100 % (n=30) |
| Cuántos postores (exacto) | 93 % (n=100) | 95 % (n=20) | 98 % (n=50) | 83 % (n=30) |
| Postores de CONOSCE encontrados | 98 % (n=100) | 100 % (n=20) | 100 % (n=50) | 92 % (n=30) |
| Ganador | 99 % (n=100) | 100 % (n=20) | 98 % (n=50) | 100 % (n=30) |
| Monto del ganador (±1 %) | 98 % (n=98) | 100 % (n=19) | 96 % (n=50) | 100 % (n=29) |
| Motivo de cada descartado | 100 % (n=77) | 100 % (n=1) | 100 % (n=50) | 100 % (n=26) |
| Citas que están en el PDF (con texto) | 88 % (n=14) | 75 % (n=4) | 92 % (n=6) | 95 % (n=4) |

Banderas (actas): postor_unico 23, solo_queda_el_ganador 19, descalificados_por_formalidad 15, oferta_mas_baja_descartada 1, requisito_a_la_medida 11, nulidad_o_desierto 1, fechas_irregulares 7, otra_irregularidad 34.
Actas con alguna bandera: 68 % (n=100); con observaciones del modelo: 44 % (n=100); PDF con texto: 24 % (n=100).

Contra el piloto con Opus 5.5 (12 actas, esquema v1): mismo número de postores 100 % (n=12); Opus acertó el ganador en 100 % (n=12) y coinciden en acertar o fallar en 100 % (n=12).

## v2-haiku-bajo (claude-haiku-5-5, esfuerzo low)

- Respuestas: {'ok': 100}; sin respuesta (red o límite): 0.
- Costo: USD 0.216 en total, 0.0022 por acta (en lote, 0.0011); tokens por acta (mediana) 11028 de entrada y 1272 de salida; 7 s.

| Métrica | Todo | postor_unico | bandera_alta | varios_postores |
|---|---|---|---|---|
| Reconoce el acta | 100 % (n=100) | 100 % (n=20) | 100 % (n=50) | 100 % (n=30) |
| Cuántos postores (exacto) | 93 % (n=100) | 95 % (n=20) | 98 % (n=50) | 83 % (n=30) |
| Postores de CONOSCE encontrados | 96 % (n=100) | 95 % (n=20) | 99 % (n=50) | 92 % (n=30) |
| Ganador | 98 % (n=100) | 95 % (n=20) | 98 % (n=50) | 100 % (n=30) |
| Monto del ganador (±1 %) | 98 % (n=99) | 100 % (n=19) | 96 % (n=50) | 100 % (n=30) |
| Motivo de cada descartado | 100 % (n=77) | 100 % (n=1) | 100 % (n=50) | 100 % (n=26) |
| Citas que están en el PDF (con texto) | 95 % (n=11) | 100 % (n=1) | 92 % (n=6) | 100 % (n=4) |

Banderas (actas): postor_unico 23, solo_queda_el_ganador 19, descalificados_por_formalidad 15, oferta_mas_baja_descartada 1, requisito_a_la_medida 15, nulidad_o_desierto 1, fechas_irregulares 11, otra_irregularidad 25.
Actas con alguna bandera: 66 % (n=100); con observaciones del modelo: 37 % (n=100); PDF con texto: 24 % (n=100).

Contra el piloto con Opus 5.5 (12 actas, esquema v1): mismo número de postores 100 % (n=12); Opus acertó el ganador en 100 % (n=12) y coinciden en acertar o fallar en 100 % (n=12).

## Estabilidad entre corridas

- postor_unico: 23 en v2-haiku-medio, 23 en v2-haiku-bajo, 23 en ambas (coinciden 1.00)
- solo_queda_el_ganador: 19 en v2-haiku-medio, 19 en v2-haiku-bajo, 19 en ambas (coinciden 1.00)
- descalificados_por_formalidad: 15 en v2-haiku-medio, 15 en v2-haiku-bajo, 14 en ambas (coinciden 0.88)
- oferta_mas_baja_descartada: 1 en v2-haiku-medio, 1 en v2-haiku-bajo, 1 en ambas (coinciden 1.00)
- requisito_a_la_medida: 11 en v2-haiku-medio, 15 en v2-haiku-bajo, 7 en ambas (coinciden 0.37)
- nulidad_o_desierto: 1 en v2-haiku-medio, 1 en v2-haiku-bajo, 1 en ambas (coinciden 1.00)
- fechas_irregulares: 7 en v2-haiku-medio, 11 en v2-haiku-bajo, 4 en ambas (coinciden 0.29)
- otra_irregularidad: 34 en v2-haiku-medio, 25 en v2-haiku-bajo, 19 en ambas (coinciden 0.47)
- Actas con exactamente las mismas banderas: 64 de 100.
