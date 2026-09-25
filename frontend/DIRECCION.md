# Dirección de rediseño — la APP de Vigía Perú

Consolidado de seis auditorías independientes (UX, producto, visualización de
datos, arquitectura frontend, inventario de datos reales, craft visual) sobre
el código real y sobre producción. Alcance: las superficies `/app/*` del
dashboard. La landing queda fuera: su propuesta ya fue aprobada e iterada.

---

## THESIS

**El producto no muestra su trabajo.** Diez agentes leen un expediente, cruzan
catorce portales del Estado y citan la página exacta de un acta — y todo eso
llega al usuario como prosa gris en la séptima pestaña, debajo del costo en
dólares. Mientras tanto, lo que sí ocupa la pantalla son cajas con números sin
denominador, la mitad de ellos en cero.

La APP se reorganiza alrededor de **la evidencia y quién la encontró**, no
alrededor de las páginas que hoy existen. Lo que se rechaza explícitamente: la
plantilla de métrica heroica (número grande, label chico, acento) como
estructura de página, que hoy es la estructura de las tres superficies de
conversión.

## OWN-WORLD

> **Actualización 2026-09-25:** el color y la tipografía de este apartado quedan reemplazados por
> `DESIGN_SYSTEM.md` (granate del logo, llamita, maíz, Montserrat). La arquitectura compositiva de
> abajo (densidad, tres profundidades, severidad con tres canales, sin kicker) sigue vigente.

Se conserva el mundo visual existente —`heroViolet` de marca, `heroGreen`
positivo, neutros de papel, serif para títulos— porque la identidad no es el
problema y la landing ya la validó. Lo que se reemplaza es la **arquitectura
compositiva**:

- **Densidad donde hay volumen.** 18 394 contratos, 2 121 entidades y 94
  alertas son tablas, no tarjetas. La tarjeta se reserva a objetos con
  identidad propia: una zona, un aliado, un agente, la cabecera de un dossier.
- **Tres profundidades, una superficie.** Lista/mapa → panel lateral anclado →
  página propia sólo para los cinco objetos compartibles (contrato, entidad,
  aliado, región, comprobante). El panel preserva el contexto; navegar lo
  destruye.
- **Severidad con tres canales.** Color + ícono dibujado + palabra, siempre.
  Nunca color solo.
- **Sin kicker sobre el título.** Prohibición absoluta, y aquí es de manual:
  "Contratos" encima de "Todos los contratos" roba jerarquía sin aportar nada.
- **Sin cascadas de entrada en producto.** El usuario entra a una tarea.

## STORY

El visitante entiende, en este orden: *cuánto dinero público hay sin leer cerca
suyo* → *qué se encontró en lo que sí se leyó* → *quién lo encontró y con qué
prueba* → *cómo se financia que se lea más*. Hoy ese orden está invertido: la
primera pantalla pide elegir región sobre un mapa que no dice nada, y la prueba
está enterrada.

## Los seis protagonistas, según el dato que existe de verdad

El inventario de datos cambió las prioridades del brief, con evidencia:

| Eje | Dato real | Decisión |
|---|---|---|
| **Contrato auditado** | 98 dossieres con expediente, postores, precios, citas con página, traza de 16 fases | **Protagonista principal** |
| **Región / gasto público** | `/contratos/geo` con ubigeo, monto real, cola, procesados, señales, 3 niveles | **Protagonista principal** |
| **Hallazgo / señal** | 94 alertas, 30 reglas, norma citada, agente de origen, campo `verificada` | **Se promueve a superficie propia** (hoy no tiene ninguna) |
| **Auditoría de agentes IA** | 16 fases con `desde`/`hasta` reales, motivo de omisión, costo, reglas por perfil | **Sube al encabezado del dossier y se vuelve filtro** |
| **Patrocinador** | **N = 1, S/135 recaudados, y ese aliado es la propia Vigía Perú** | **Se degrada** — ver abajo |
| **Denuncia ciudadana** | 6 registros mock sembrados en la base | **Se diseña para el vacío** |

### Por qué el patrocinador NO es un pilar visual (discrepancia con el brief)

El brief pide podio, muro, grafo y card heroica de patrocinadores. El dato real
es **un** financiador, que es la propia plataforma autofinanciándose, con S/135
recaudados. Un podio con dos losas "vacante" no celebra: prueba soledad. Y en
una herramienta anticorrupción, dar superficie heroica a quien paga se lee como
lavado de imagen — contra la promesa central del producto, que es que *el que
paga no elige*.

La inversión: el financiamiento se muestra como **procedencia de cada
auditoría** ("esta lectura la pagó X · código VIG-… · S/3"), que es
trazabilidad y refuerza la independencia en vez de erosionarla. Se conserva
**una** ficha de aliado rica, porque ahí sí hay cadena completa hasta los
contratos. La card de patrocinador se diseña igual —el brief la pide— pero con
la obligación de leer bien con n=1, n=12 y n=500.

---

## P0 — Verdad. No son defectos de estilo

1. **El mapa pinta métricas inventadas sobre geografía real.** `lib/peru-data.ts`
   declara en su línea 2 "métricas mock para el demo"; `PeruChoropleth.tsx:364`
   colorea provincias con `p.mockProv.alertas`, y `MapaWrapper.tsx:632` invita:
   "Toca una provincia roja para abrir su detalle". Un producto que acusa de
   falta de transparencia no puede fabricar señales de riesgo sobre provincias
   reales del Perú. **La geografía de `peru-data` (centroides INEI, nombres) se
   conserva; las métricas se amputan.**

2. **Los fallbacks silenciosos a mock.** `MapaWrapper.tsx:268,314` hacen
   `alertasApi.length > 0 ? alertasApi : ALERTAS_MOCK`: si la API cae, el mapa y
   el ticker "EN VIVO" muestran alertas inventadas sin decirlo. Si la API cae,
   se dice. El patrón correcto ya existe en `TableroAuditoria.tsx:171`.

3. **BlurFade ocultaba el contenido en producción.** Medido: 11 de 14 filas de
   `/app/contratos` servidas con `opacity:0`. **Ya corregido.**

4. **La severidad no pasaba el piso de contraste.** `rust #CF3A2C` contra
   `amber` daba ΔE 13.6 (piso 15). **Ya corregido** a `#A81E12` (ΔE 18.3), con
   fuente única en `lib/severidad.ts` que reemplaza las siete escaleras de
   umbral que existían, dos de ellas invertidas entre sí.

5. **El mapa no es alcanzable por teclado.** Medido en producción: 25 paths de
   departamento, **0** enfocables. Es el primer paso de todo el flujo del
   producto.

## Decisiones de interacción

- **Panel lateral por defecto, modal casi nunca.** Tres modales en toda la app:
  confirmación de aporte, captura de foto+geo de denuncia, confirmaciones
  destructivas de admin. En este producto el contexto que queda detrás (el mapa,
  la lista filtrada, el dossier) *es parte de la evidencia*: taparlo con un modal
  es perder la prueba.
- **Los overlays van en el top layer.** `<dialog>` nativo y atributo `popover`.
  No es preferencia: `FlowGraph.tsx:375`, `RelationshipGraph.tsx:358` y
  `MapaWrapper.tsx:365` son `overflow-hidden`, y por eso hoy `NodeDetailPanel`
  se renderiza *debajo* del SVG y el usuario pierde de vista el nodo que acaba
  de tocar. **Ya construido** (`components/ui/Panel.tsx`, `Flotante.tsx`).
- **El dictamen sigue siendo prosa, y eso es correcto** (discrepancia con el
  brief). Es el artefacto que un periodista cita y una fiscalía lee: partirlo en
  tarjetas destruye justo lo que lo hace útil. Se le da tipografía de lectura
  real, medida de 65–75 ch, índice con anclas y afordancia de cita. Es una isla
  de modo Read dentro de una app de modo Operate. Lo que sí se extrae en
  componentes son las **señales**, que hoy viven ahogadas dentro de esa prosa.

## Lo que se visualiza, y lo que no

Se grafica sólo lo que responde una pregunta comparativa:

- **Ofertado vs mercado** → dumbbell/range plot por ítem. Es el mayor hueco del
  producto: hoy son 584 líneas de números formateados para la pregunta más
  cuantitativa que existe ("¿cuánto se pagó de más y en qué ítems?").
- **Auditoría de agentes** → Gantt de tres carriles con las duraciones reales,
  y cada agente es un **filtro** sobre la evidencia (clic en `market_price` →
  la página se acota a lo que ese agente encontró). El nexo agente→hallazgo ya
  existe en el dato (`SenalRiesgo.agente`) y ningún componente lo usa.
- **Reglas evaluadas** → matriz regla × resultado: "se evaluaron 25 reglas,
  dispararon 5", incluidas las que **no** dispararon. Es la interacción más
  honesta que permite el dato.
- **Magnitud geográfica** → coropleto por cuantiles (no `value/max` lineal:
  con Lima dominando, manda a todo el resto al escalón más bajo).

**No se grafica**: ninguna serie temporal. El campo `serie` de las entidades
sale literalmente de `metadata->'serie_mock'` en el backend. No existe ningún
endpoint público con historia. Cualquier sparkline aquí sería ficción — y
además Impeccable ya los prohíbe como sustituto de contenido.

## FINISH

Esta dirección no está terminada cuando compila. Termina con: la app corriendo,
revisión visual batcheada en escritorio y móvil, corrección en un solo lote,
una confirmación más, el detector de Impeccable corrido una vez sobre lo
cambiado, y despliegue verificado en vivo.
