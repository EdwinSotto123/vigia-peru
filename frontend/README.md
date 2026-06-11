# Vigía Perú — Frontend

Next.js 14 (App Router) + TypeScript + Tailwind + d3-geo + Magic UI.

## Cómo correrlo

```powershell
# 1. Bajar la geometría real del Perú (una sola vez)
python ..\scripts\fetch_peru_geo.py

# 2. Instalar dependencias y arrancar
cd frontend
npm install
npm run dev
```

Abre <http://localhost:3000>. El paso 1 deja `public/peru-departments.json`,
con el cual el choropleth se dibuja. Si saltás ese paso, el mapa muestra una
tarjeta con instrucciones para correr el script.

## Stack

| Capa | Elección |
|---|---|
| Framework | Next.js 14 (App Router) |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS con tokens semánticos |
| Mapa | **d3-geo** (proyección geoMercator + geoPath) sobre SVG nativo |
| Datos del mapa | **geoBoundaries ADM1** vía `scripts/fetch_peru_geo.py` |
| Animaciones de UI | **Magic UI** (NumberTicker, BorderBeam, Marquee) — open source MIT |
| Íconos | `lucide-react` |
| Fuentes | Inter (sans), Source Serif Pro (display), JetBrains Mono (números) |

## Por qué d3-geo en vez de Leaflet/react-simple-maps

- **Leaflet** sirve mapas tile-based (terreno, calles). Nuestro caso no necesita eso.
- **react-simple-maps** envuelve d3-geo, pero ha tenido problemas de compatibilidad con React 18.
- **d3-geo** es el estándar de facto para proyecciones cartográficas: 12KB gzip, sin peer deps,
  sólo matemática. Renderizamos `<path>` SVG directo y tenemos control total de estilos.

## Por qué Magic UI

Magic UI es una librería de componentes copy-paste (estilo shadcn), MIT, ampliamente usada
y bien mantenida. Tomé tres componentes representativos:

- **NumberTicker** — anima los KPIs del hero al entrar al viewport (intersection observer + RAF).
- **BorderBeam** — haz de luz girando alrededor del contenedor del mapa, en dos
  capas con colores invertidos para efecto continuo.
- **Marquee** — ticker horizontal de alertas debajo del header del dashboard.

Implementados como vanilla TS, sin framer-motion ni dependencias extra. Animaciones
declaradas en `tailwind.config.ts` (`marquee`, `border-beam`, `shimmer`).

## Estructura

```
frontend/
├── app/                            # Next App Router
│   ├── page.tsx                    # Home (hero · métricas · cómo funciona · agentes · mapa · alertas · CTAs)
│   ├── alerta/[id]/page.tsx        # Detalle de alerta
│   ├── reporte/nuevo/page.tsx      # Form ciudadano
│   ├── noticia/page.tsx            # Generador de borrador de noticia con IA (mock)
│   ├── preguntas/page.tsx          # FAQ
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── PeruChoropleth.tsx          # SVG + d3-geo · fetch a /peru-departments.json
│   ├── MapaWrapper.tsx             # Shell BI: switcher, marquee, BorderBeam, panel
│   ├── RegionDetailPanel.tsx       # Drilldown · sparkline · mini-barras · top casos
│   ├── AgentsRibbon.tsx            # Ribbon en vivo de los 5 agentes IA + AgentsStrip
│   ├── MetricsHero.tsx             # 4 KPIs con NumberTicker
│   ├── TopAlertasList.tsx
│   ├── HowItWorks.tsx              # 3 pasos (vuelto a poner claro)
│   ├── CallToActionsRow.tsx        # 3 CTAs: denunciar / generar noticia / FAQ
│   ├── Header.tsx / Footer.tsx / DisclaimerBanner.tsx
│   ├── magicui/                    # Magic UI (copy-paste, MIT)
│   │   ├── NumberTicker.tsx
│   │   ├── BorderBeam.tsx
│   │   └── Marquee.tsx
│   ├── charts/
│   │   ├── Sparkline.tsx           # SVG puro
│   │   └── MiniBars.tsx            # SVG puro
│   └── ui/                         # Primitives propios (Badge, Button, Card)
├── lib/
│   ├── mock-data.ts                # Alertas, reportes, convergencias (frontend-only)
│   ├── peru-data.ts                # Datos por región/provincia + helpers
│   └── utils.ts                    # cn() + normalizeRegionId()
├── public/
│   └── peru-departments.json       # ← generado por scripts/fetch_peru_geo.py
└── types/
```

## El motor: 5 agentes de IA (Google ADK)

La home menciona explícitamente que detrás del análisis hay **cinco agentes de IA**
orquestados con Google ADK, cada uno con un rol acotado:

1. `compliance_agent` — aplica las 8 reglas duras de cumplimiento normativo.
2. `network_agent` — mapea socios, representantes y miembros de consorcio.
3. `citizen_match_agent` — cruza reportes ciudadanos con alertas automáticas.
4. `web_research_agent` — busca en SUNAT, JNE, ONPE, Poder Judicial, El Peruano.
5. `report_writer_agent` — redacta el dictamen final citando opiniones OECE.

Detalle completo en `../MANUAL.md`. Visualmente el `AgentsRibbon` muestra
actividad en vivo encima del mapa.

## Conectar al backend real

Todo el contenido sale de `lib/mock-data.ts` y `lib/peru-data.ts` mientras el
backend FastAPI no esté arriba. Para conectar:

1. Crear `lib/api.ts` con `fetchAlertas()`, `fetchReportes()`, `postReporte()`.
2. Reemplazar imports en `MapaWrapper`, `MetricsHero`, `TopAlertasList`,
   `app/alerta/[id]/page.tsx`.
3. `POST /reportes` ya simula con `setTimeout` — cambiar por `fetch`.
4. El generador de noticia llama `buildMockNoticia` localmente. En real va a
   `POST /caso/{id}/noticia` → invoca `report_writer_agent` (ver `MANUAL.md` §3.6).

## Decisiones de UX

- **El mapa es la home.** No un anexo: quien entra ve el problema inmediatamente.
- **El disclaimer ("no acusamos a nadie") está en cada página relevante.**
  No es letra chica del footer.
- **Los agentes IA narrados con autoridad.** Una sección dedicada explicando los 5
  agentes con nombre, rol y herramientas. La cinta en vivo refuerza que algo
  está pasando ahora.
- **Denunciar es 5 pasos numerados.** Foto obligatoria; sin ella no se publica.
- **Generar noticia muestra el proceso.** "Cruzando con SEACE… buscando opiniones
  OECE… redactando…" — la transparencia del modelo es parte de la confianza.
- **FAQ contesta las preguntas duras**: ¿la IA decide?, ¿reemplazan a Contraloría?,
  ¿quién financia esto?, etc.
