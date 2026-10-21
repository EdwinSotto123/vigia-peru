# Corrupción: lo que el Estado ya investigó o juzgó

Vigía marca señales de riesgo en las contrataciones. Esta capa agrega lo que dos instituciones oficiales ya dijeron sobre
corrupción, ligado a cada **entidad** (por RUC) y a cada **región** (ubigeo del departamento, 2 dígitos). Son dos cosas
distintas y la web nunca debe mezclarlas:

| | Contraloría General de la República | Procuraduría Anticorrupción (PPEDC) |
|---|---|---|
| Qué es | Informes de control que **señalan** responsabilidad de funcionarios | Casos penales por delitos de corrupción en los que el Estado es parte agraviada |
| Peso | **Presunta.** La Contraloría identifica y deriva (al Ministerio Público, a la entidad o a su propio procedimiento sancionador). No es una condena | **Comprobado** en lo que está "en ejecución de sentencia": hay sentencia firme y se cobra la reparación civil. El resto son casos en trámite |
| Grano | Un informe, con su entidad, fecha, tipos de responsabilidad y cuántos funcionarios | Cifras por sede de la Procuraduría (no por entidad) |
| Tabla | `informes_control` | `procuraduria_casos_sede` |
| Carga | `backend/scripts/cargar_contraloria_informes.py` (y la fuente `contraloria_informes` de vigia-scrapers, que hoy no llega) | `backend/scripts/cargar_ppedc_boletin.py` |

Migración: `backend/db/migrations/90_corrupcion.sql`.

## Rótulos en la web

- **"Sentencia firme (Procuraduría Anticorrupción)"**: sólo para `en_ejecucion` (casos en ejecución de sentencia).
- **"Casos en trámite (Procuraduría Anticorrupción)"**: `en_tramite`. Incluye los en ejecución (así los cuenta la PPEDC).
- **"Presunta responsabilidad penal (Contraloría) — no es una condena"** y **"Presunta responsabilidad civil (Contraloría) — no
  es una condena"**: informes con `penal` / `civil` en `responsabilidades`. Las administrativas: "Presunta responsabilidad
  administrativa (Contraloría)".
- Siempre con el enlace al informe (`url_pdf`) o al boletín (`url_fuente`), y la fecha del informe o del corte.
- Un informe de la Contraloría **no es** un caso de la Procuraduría ni una sentencia: no sumarlos ni ponerlos en la misma cifra.

## Privacidad

- El buscador de la Contraloría trae, en el campo `Text` de cada fila, el **DNI y el nombre** de cada funcionario
  comprendido. No se guarda: ni la base ni el crudo en R2 lo tienen. Sólo `funcionarios` (cuántos). Las dos cargas leen una
  lista cerrada de campos (`CAMPOS` en `contraloria_informes.ts`, `a_informe()` en el script).
- El boletín de la Procuraduría son cifras agregadas: no hay personas.
- El `titulo` es el asunto oficial del informe. Revisado el 2026-10-21: sin DNI (los números de 8 cifras son códigos SIAF,
  pólizas, rutas). Puede nombrar hospitales o instituciones con nombre de persona; si la web lo muestra, que pase por la
  misma máscara que el resto de los textos (docs/PRIVACIDAD.md).
- El PDF del informe (`url_pdf`) es público y sí nombra a los funcionarios: se enlaza, no se copia.

## Contraloría: informes de control

**Fuente.** Buscador de Informes de la Contraloría (`https://appbp.contraloria.gob.pe/BuscadorCGR/Informes/Avanzada.html`), que
consulta `BusquedaInformesCGR.ashx?ActionPage=TransportType&Action=loadInformesElastic&PageSize=1000&PageNumber=<n>&pGeneral=%20
&pResponsabilidad="PENAL" OR "CIVIL" OR "ADMINISTRATIVO ENTIDAD" OR "ADMINISTRATIVO PAS"`. JSON, sin captcha ni login,
ordenado por fecha de publicación. El 2026-10-21: 14 099 informes (penal 7 386, civil 5 012, administrativa de la entidad
10 620, PAS 3 519; uno puede tener varias), emitidos entre 2015 y 2026, en 15 páginas.

Campos que se guardan: `CodigoInforme` (clave), `NumeroInforme`, `Descripcion` (título, cortado a 400 caracteres por la
Contraloría), modalidad, sector, nivel de gobierno, entidad (nombre, sin RUC), departamento/provincia/distrito (nombres),
responsabilidades, `TotalFuncionarios`, fechas de emisión, publicación y fin de ejecución, y los enlaces al informe
(`TIPOARCHIVO=ADJUNTO`) y al resumen ejecutivo (`TIPOARCHIVO=RE`), en https.

**Sólo responde desde el Perú.** El servidor (161.132.x.x) no contesta a IPs extranjeras: medido el 2026-10-21, 522 desde
Cloudflare (Worker en Miami, relay en Zúrich, Browser Rendering) y timeout desde AWS us-east-2 (también
`procuraduriaanticorrupcion.minjus.gob.pe`). Por eso:

- La carga es `python backend/scripts/cargar_contraloria_informes.py --entorno prod` desde una PC en el Perú (~1 minuto de
  descarga, upsert y cruce).
- La fuente `contraloria_informes` del Worker existe (misma lógica, una página por paso, crudo limpio en R2) pero no tiene
  cron. `GET /diagnostico?partes=cgr` de vigia-scrapers dice si llega por alguna vía (directo, relay, navegador); si un día
  llega, agregarla a `src/calendario.ts` (día 10 del mes).

**Cadencia.** Mensual (la Contraloría publica decenas de informes con responsabilidad al mes). Cada carga rehace todo:
upsert por código (un informe que deja de aparecer no se borra) y `refrescar_informes_control_entidad()`.

**Ubigeo.** Por nombre contra `zonas` (departamento → provincia → distrito; "P. C. DEL CALLAO" = Callao; sin el paréntesis de
"PUEBLO LIBRE(MAGDALENA VIEJA)"). Queda el nivel más fino: 14 008 de 14 099 con distrito, todos con departamento. Ojo: es la
ubicación que da la Contraloría, que suele ser la sede de la entidad pero a veces la oficina donde pasó (EsSalud en
Arequipa, SUNAT en Tacna). El resumen por región usa esta ubicación.

**RUC.** `refrescar_informes_control_entidad()` cruza el nombre con `entidades` (los compradores del OECE, ~3 200), por
niveles: nombre igual (normalizado: sin tildes, signos, artículos, 'SEDE CENTRAL' final, 'S.A.' = 'SA'), nombre sin el último
tramo menor de un lado o del otro ('… - ESSALUD', '… - JULIACA', '… - Administración General'), subunidad de un gobierno
regional o de un ministerio ('GOBIERNO REGIONAL DE ICA-HOSPITAL REGIONAL DE ICA'), sigla final ('… - SEDAPAL') y, para las
municipalidades, la única municipalidad distrital (o provincial) de ese ubigeo. Los informes de gobiernos locales y
regionales exigen que la entidad esté en el mismo departamento; con varios candidatos gana el del mismo ubigeo o
departamento, y si aun así hay más de uno queda sin RUC (`entidad_cruce = 'ambiguo'`). Nunca se fuerza.
`entidad_cruce` dice por qué regla cruzó cada informe.

En DEV (2026-10-21): **11 090 de 14 099 con RUC (78,7 %)**; penal 81,6 %, civil 77,3 %; gobiernos locales 93 %, regionales
53 %, nacionales 76 %; 0 ambiguos; 1 518 entidades distintas. Lo que no cruza es, casi siempre, una entidad que no está en
`entidades` (no compra por el OECE con ese RUC o con ese nombre): MIDAGRI, PNP, SEDAPAR, Electrocentro, direcciones
regionales sin unidad propia…

## Procuraduría Anticorrupción: boletín estadístico

**Fuente.** Boletín estadístico mensual de la PPEDC (`https://procuraduriaanticorrupcion.minjus.gob.pe/`, Publicaciones), en
PDF. El de julio de 2026: `…/wp-content/uploads/2026/09/BOLETIN-PPEDC-A-JULIO-2026.pdf` (56 páginas, publicado en agosto).
Datos del SICPROJ de la Procuraduría.

Por sede (37 en julio de 2026) y corte (último día del mes del boletín):

| Columna | Del boletín |
|---|---|
| `en_tramite` | Tabla N.° 02, TOTAL: casos en trámite (incluye los en ejecución) |
| `en_ejecucion` | Tabla N.° 02, EJECUCIÓN: casos en ejecución de sentencia (sentencia firme, cobro de reparación civil) |
| `importancia_a_mas`, `_a`, `_b` | Tabla N.° 02: A+ (emblemáticos), A, B. Las cuatro categorías no suman el total en el propio boletín (+1,5 %) |
| `sentencias` | Página de la sede, "Sentencias favorables": sentencias y autos consentidos o ejecutoriados que fijan reparación civil, del 1 de enero al corte (521 en 2026 a julio) |
| `reparacion_civil` | Página de la sede, "Cobro de reparaciones civiles": S/ cobrados del 1 de enero al corte |
| `casos_nuevos` | Página de la sede: casos ingresados del 1 de enero al corte |

El script comprueba antes de escribir que las sedes sumen la fila Total, que las sentencias y los casos nuevos sumen lo que
dice el texto, y que las sedes agrupadas por departamento den la Figura N.° 02 (casos por departamento). Si no cuadra, no
carga: el formato cambió y hay que revisarlo (`--forzar` para cargar igual).

**Sede → departamento.** Las sedes siguen a los distritos judiciales: Lima = Lima (Sede Central) + Lima Norte + Lima Sur +
Huaura + Cañete (y Lima Este, si aparece); Callao (y Ventanilla); Áncash + Del Santa; Ica + Chincha; Cusco + La Convención;
Loreto + Yurimaguas; Piura + Sullana; Amazonas + Bagua; San Martín + Moyobamba; Ucayali + Atalaya; Junín (y Selva
Central). El mapa está en `SEDES` del script. "Lima (Sede Central)" lleva además los casos de alcance nacional.

**Cadencia.** Mensual, cuando sale el boletín (un mes o dos después del corte). Desde una PC en el Perú (el sitio de MINJUS
tampoco responde desde el extranjero):

```bash
python backend/scripts/cargar_ppedc_boletin.py --url <pdf del boletín> --seco          # leer y revisar
python backend/scripts/cargar_ppedc_boletin.py --url <pdf del boletín> --entorno prod  # cargar (reemplaza ese corte)
```

Cada corte queda guardado (la tabla tiene la historia); la API usa el último.

## Lo que lee la API

Rol `vigia_api` (también `vigia_api_admin` y `vigia_mcp`); `statement_timeout` de 10 s, ambas funciones tardan milisegundos.

- `informes_control_de_entidad(p_ruc)` → filas, del más nuevo al más viejo: `numero, titulo, fecha, responsabilidades,
  funcionarios, modalidad, url_pdf, url_resumen`. Gobierno Regional de Puno (20406325815): 42; Ejército (20131369124): 15.
- `corrupcion_resumen_region(p_ubigeo2)` → jsonb:

```json
{
  "departamento": "21",
  "procuraduria": {"corte": "2026-07-31", "en_tramite": 2223, "en_ejecucion": 358, "sentencias": 13, "reparacion_civil": 119925.0,
                   "casos_nuevos": 187, "url_fuente": "https://…/BOLETIN-PPEDC-A-JULIO-2026.pdf",
                   "sedes": [{"sede": "Puno", "en_tramite": 2223, "en_ejecucion": 358, "sentencias": 13, "reparacion_civil": 119925.0}]},
  "informes": {"total": 512, "penal": 380, "civil": 133, "administrativa_entidad": 364, "administrativa_pas": 123,
               "funcionarios": 2993, "entidades": 67, "desde": "2017-06-15", "hasta": "2026-09-23"},
  "ultimos": [{"numero": "020-2026-2-5182", "titulo": "…", "fecha": "2026-09-23", "entidad": "…", "entidad_ruc": null,
               "responsabilidades": ["civil"], "url_pdf": "https://apps8.contraloria.gob.pe/…"}]
}
```

`procuraduria` es null si el departamento no tiene sede en el último boletín; `ultimos` son los 10 informes más nuevos.
Los datos son públicos: ningún rol que lee pierde acceso; los agentes (`vigia_agentes`) leen pero no escriben.

## Desplegar

1. Migración en RDS: `psql "$DSN" -v ON_ERROR_STOP=1 -f backend/db/migrations/90_corrupcion.sql` (por el túnel de
   `infrastructure/aws/tunel_rds.py prod`).
2. vigia-scrapers: `npx wrangler deploy` desde `backend/scrapers-worker` (registra la fuente y la prueba `cgr` de
   `/diagnostico`; no agrega crons).
3. Informes: `python backend/scripts/cargar_contraloria_informes.py --entorno prod` (desde el Perú).
4. Boletín: `python backend/scripts/cargar_ppedc_boletin.py --url <pdf> --entorno prod` (desde el Perú).
