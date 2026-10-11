# Pipeline de audio y montaje de la campaña

Convierte un guion y el mp4 **silencioso** que exporta Moda en un video de TikTok terminado: voz en off, música original, efectos y sonoridad de -14 LUFS.

Moda no genera audio ni video (ver [`docs/campanas/capacidades-moda.md`](../../../docs/campanas/capacidades-moda.md)), así que el sonido se hace aquí y se mezcla con `ffmpeg`.

## Flujo recomendado

```
1  guion JSON          escenas con texto y pausas ("Este camino [500] lleva años...")
2  generar_voz.py      voz por escena + voz_total.wav + marcas.json (tiempos por escena y por palabra)
3  duraciones          cada escena de Moda dura "duracion_escena_s" de marcas.json
4  escenas en Moda     una página por escena, subtítulos con recipe-fade-word y speed = palabras_por_segundo
5  export a mp4        export(format='mp4', scope='sequence'), sin audio
6  sintetizar_musica   la pista de la historia (T1 a T4), 30 s
7  sintetizar_sfx      efectos sueltos que se colocan por tiempo (sfx.json)
8  mezclar.py          video + voz + música + efectos -> mp4 final
9  verificación        ffprobe: 1080x1920, yuv420p, aac 48 kHz, duración, -14 LUFS (la hace mezclar.py)
```

## Scripts

| Script | Qué hace |
|---|---|
| `generar_voz.py` | Lee un guion JSON y produce un WAV por escena, `voz_total.wav` y `marcas.json` con los tiempos exactos de cada palabra. Acepta pausas dentro del texto con `[600]` (milisegundos). `--externo carpeta` incorpora voz ya grabada (ElevenLabs o humana) |
| `sintetizar_musica.py` | Cuatro pistas originales de 30 s (T1 tensa que se resuelve en esperanza, T2 curiosa y luminosa, T3 ligera y en avance, T4 cálida y emotiva), por síntesis: cuerdas, latido, charango (Karplus y Strong) y quena. Sin muestras de terceros |
| `sintetizar_sfx.py` | Nueve efectos originales: viento, pasos en tierra, papel, clic de celular, monedas, latido, whoosh, golpe sordo y campana suave |
| `mezclar.py` | Mezcla con `ffmpeg`: la música baja unos 10 dB cuando habla la voz (sidechain), normalización a -14 LUFS con pico de -1,5 dBTP en dos pasadas, video copiado sin recodificar si ya es h264 yuv420p, y verificación con `ffprobe` |
| `prueba_humo.py` | Prueba de punta a punta con un mp4 real de Moda. Comprueba formato, sonoridad y que la música baje de verdad cuando habla la voz |
| `_comun.py` | Ubicación de `ffmpeg` y medidas (`ffprobe`, LUFS) |

## Ejemplo

```bash
cd backend/scripts/campana
python generar_voz.py ejemplo_guion.json --salida ../../../../campanas-vigia/audio/voz/T1
python sintetizar_musica.py --pista T1 --duracion 30 --salida ../../../../campanas-vigia/audio/musica
python sintetizar_sfx.py --salida ../../../../campanas-vigia/audio/sfx
python mezclar.py --video silencioso_T1.mp4 --voz .../voz/T1/voz_total.wav \
    --musica .../musica/musica_T1_30s.wav --sfx sfx_T1.json --salida final_T1.mp4

python prueba_humo.py --video ruta/a/un_mp4_de_moda.mp4      # comprueba todo el pipeline
```

`sfx_T1.json`:

```json
[
  {"archivo": "../../../../campanas-vigia/audio/sfx/sfx_viento.wav", "t_s": 0.0, "db": -16},
  {"archivo": "../../../../campanas-vigia/audio/sfx/sfx_whoosh.wav", "t_s": 11.8, "db": -8}
]
```

## La voz

| Motor | Estado | Para qué |
|---|---|---|
| **ElevenLabs** (conector de Claude) | **Falta autenticarlo**: escribe `/mcp`, elige «claude.ai ElevenLabs» y autoriza. Sus herramientas aparecen solas después | **Voz final recomendada** (natural, expresiva) |
| **edge-tts** (`es-PE-CamilaNeural`, `es-PE-AlexNeural`) | Instalado y probado. Licencia LGPL-3.0 | **Voz provisional**: sirve para el ritmo y para borradores. Usa el servicio en línea de Microsoft Edge sin clave: **no es una API oficial y no tiene licencia comercial explícita**, así que no conviene publicar con esta voz sin revisar sus términos |
| **SAPI** (voz local de Windows, `Microsoft Sabina`, es-MX) | Probado. `--motor sapi` | Respaldo sin red ni términos de servicio, más robótico |
| **Locución humana** | `--externo carpeta` con `escena_<id>.wav` | La opción más auténtica para una campaña peruana |

Para cambiar de motor no se rehace nada: `generar_voz.py` mantiene el mismo formato de `marcas.json`. Con voz externa los tiempos de palabra se reparten por número de letras (aproximados); para una alineación exacta, transcribir con el conector de ElevenLabs.

## Medidas de la prueba de humo (11 oct 2026)

- Entrada: mp4 de Moda de 8 s, 1080 x 1920, h264.
- Salida: h264 1080 x 1920 yuv420p copiado sin recodificar; audio aac 48 kHz estéreo; duración 8,00 s; **-14,1 LUFS**; pico real -1,6 dBTP.
- Ducking medido: la música baja **10,7 dB** cuando habla la voz (se pidió 10).
- Música: las cuatro pistas de 30 s miden de -16 a -19 LUFS a nivel de cama (la voz va encima).

## Carpetas de trabajo

Los archivos pesados (audio, video, imágenes) viven **fuera del repositorio**:

```
C:\Users\usuario\Desktop\PROYECTOS\campanas-vigia\
├── tiktok  facebook  linkedin       entregables por plataforma
├── assets                           imágenes generadas y pruebas (assets/pruebas)
├── audio                            musica/  sfx/  voz/
├── proyectos_editables              enlaces y exportaciones editables
├── exportaciones                    archivos finales
└── documentacion                    registros de pruebas (documentacion/humo)
```

## Dependencias

`numpy`, `scipy` y `ffmpeg` (7.x). `edge-tts` (LGPL-3.0) solo si se usa el motor `edge`: `pip install edge-tts`.
