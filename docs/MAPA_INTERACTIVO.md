# Mapa interactivo del Perú — guía para portarlo a otro proyecto

> Receta exacta de cómo está construido el mapa de Vigía Perú para que puedas
> reusarlo en otro proyecto. **No es HTML plano: es un SVG generado por React
> con `d3-geo`.** No usamos Leaflet, ni Mapbox, ni tiles — todo está dibujado
> a mano sobre un `<svg>` desde GeoJSON.

---

## 1. Resumen en una línea

Un `<svg viewBox="0 0 480 700">` que pinta los 25 departamentos del Perú
(y las 197 provincias del departamento seleccionado) leyendo dos GeoJSON
locales, proyectados con `geoMercator().fitExtent()`. Zoom-to-region animado
con `requestAnimationFrame` modificando el `transform` de un `<g>` interno.

---

## 2. Stack / dependencias

| Pieza | Versión usada | Para qué |
|---|---|---|
| **Next.js** | 14.2.5 | App router, SSR (el mapa se carga `dynamic` con `ssr: false`) |
| **React** | 18.3.1 | UI |
| **TypeScript** | 5.5.3 | Tipos `geojson` |
| **`d3-geo`** | 3.1.1 | `geoMercator`, `geoPath`, `geoCentroid` |
| **`@types/d3-geo`** | 3.1.0 | Tipos |
| **`@types/geojson`** | 7946.0.14 | Tipos `Feature`, `FeatureCollection` |
| **Tailwind** | 3.4.6 | Estilos del wrapper (opcional — el SVG en sí no depende de Tailwind) |
| **`lucide-react`** | 0.460.0 | Íconos del wrapper (opcional) |

Instalación mínima en un proyecto nuevo:

```bash
npm i d3-geo
npm i -D @types/d3-geo @types/geojson
```

---

## 3. Archivos involucrados

```
frontend/
├── app/(dashboard)/app/mapa/page.tsx        ← Server Component, monta el wrappe  r
├── components/
│   ├── MapaWrapper.tsx                      ← Client Component, controla estado/UI
│   └── PeruChoropleth.tsx                   ← Client Component, dibuja el SVG
├── lib/
│   ├── peru-data.ts                         ← Datos mock por región/provincia
│   └── utils.ts                             ← `normalizeRegionId` (slug sin tildes)
├── public/
│   ├── peru-departments.json                ← GeoJSON de 25 departamentos
│   └── peru-provinces.json                  ← GeoJSON de 197 provincias
└── scripts/
    └── fetch_peru_geo.py                    ← Descarga los GeoJSON desde GitHub
```

---

## 4. GeoJSON del Perú — de dónde sale

**Fuente primaria:** repo público `juaneladio/peru-geojson` en GitHub.
Son los polígonos oficiales del INEI ya simplificados a GeoJSON.

```
https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_departamental_simple.geojson
https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_provincial_simple.geojson
```

El script `backend/scripts/fetch_peru_geo.py` los baja, **renombra** las
propiedades de cada feature a un esquema homogéneo y los escribe en
`public/peru-departments.json` y `public/peru-provinces.json`.

Esquema final de cada feature (lo que el componente espera):

```ts
// peru-departments.json
{
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { id: "ancash", name: "Áncash", code: "02" },
    geometry: { type: "MultiPolygon", coordinates: [...] }
  }, ...]
}

// peru-provinces.json
{
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: {
      id: "ancash-huaraz",
      name: "Huaraz",
      departamento: "Áncash",
      regionId: "ancash",
      code: "0201"
    },
    geometry: { ... }
  }, ...]
}
```

Si lo portás a un proyecto que no usa Python para el build, podés:
- Bajar los GeoJSON una sola vez con `curl` y commitearlos.
- O reescribir `fetch_peru_geo.py` como un script Node equivalente.

---

## 5. La "página HTML" — Server Component que monta el mapa

`app/(dashboard)/app/mapa/page.tsx`:

```tsx
import { MapPin } from "lucide-react";
import { MapaWrapper } from "@/components/MapaWrapper";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function MapaPage() {
  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Mapa interactivo"
        icon={<MapPin size={11} className="text-clay" />}
        title="El Perú departamento por departamento"
        subtitle="Click cualquier región para ver presupuesto MEF, alertas, entidades y provincias."
      />
      <MapaWrapper />
    </div>
  );
}
```

Ese es el "HTML" externo. Es trivial — todo el peso está adentro de
`MapaWrapper` y `PeruChoropleth`.

---

## 6. El wrapper — estado y controles

`components/MapaWrapper.tsx` (resumen — el archivo completo tiene marquee,
drawer móvil y leyenda):

```tsx
"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// SSR off: el SVG calcula proyecciones que dependen del DOM/timing.
const PeruChoropleth = dynamic(
  () => import("./PeruChoropleth").then((m) => m.PeruChoropleth),
  { ssr: false, loading: () => <MapSkeleton /> },
);

export function MapaWrapper() {
  const [metric, setMetric] = useState<MetricaId>("alertas");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [provinciaActiva, setProvinciaActiva] = useState<any | null>(null);

  return (
    <div className="aspect-[480/700] max-h-[680px] w-full overflow-hidden">
      <PeruChoropleth
        metric={metric}
        selectedRegionId={selectedRegionId}
        hoveredRegionId={hoveredRegionId}
        onHoverRegion={setHoveredRegionId}
        onSelectRegion={setSelectedRegionId}
        onSelectProvincia={(regionId, p) =>
          setProvinciaActiva({ regionId, ...p })
        }
      />
    </div>
  );
}
```

Puntos clave:

- **`dynamic(..., { ssr: false })`** — no rendereamos en servidor. El cálculo
  de proyección depende del bundle de `d3-geo` y del flujo cliente-side.
- **`aspect-[480/700]`** — Tailwind arbitrary value que fija la relación de
  aspecto del viewBox del SVG. Sin esto, el contenedor se deforma.
- Todo el estado (métrica, región seleccionada, hover, provincia activa)
  vive en el wrapper. El componente del SVG es **controlado**.

---

## 7. El SVG — corazón del componente

`components/PeruChoropleth.tsx` — el archivo completo está en el repo.
Lo que **tenés que copiar literal**:

### 7.1. Constantes de viewBox

```tsx
const VB_W = 480;
const VB_H = 700;
```

Relación de aspecto cercana a la forma real del Perú. Cambia `aspect-[480/700]`
en el wrapper si modificás estos números.

### 7.2. Fetch y proyección

```tsx
useEffect(() => {
  fetch("/peru-departments.json").then((r) => r.json()).then(setDeptData);
  fetch("/peru-provinces.json").then((r) => r.json()).then(setProvData);
}, []);

const projection = useMemo(() => {
  if (!deptData) return null;
  return geoMercator().fitExtent(
    [[16, 24], [VB_W - 16, VB_H - 16]],  // padding 16px arriba/lados, 24 abajo
    deptData as any,
  );
}, [deptData]);
```

`fitExtent` calcula automáticamente el zoom y el centro para encajar **todo
el Perú** dentro del viewBox. No tenés que hardcodear escala ni centro.

### 7.3. Generación de paths

```tsx
const pg = geoPath(projection);

const deptPaths = (deptData.features as DeptFeature[]).map((feat) => ({
  id: feat.properties.id,
  name: feat.properties.name,
  d: pg(feat as any) || "",           // ← el atributo `d` del <path>
  centroid: pg.centroid(feat as any), // ← [cx, cy] para colocar etiquetas
  bounds: pg.bounds(feat as any),     // ← para el zoom-to-region
}));
```

### 7.4. Zoom-to-region animado

Cuando seleccionás un departamento, calculamos un transform que centra y
hace zoom sobre sus bounds:

```tsx
const targetTransform = useMemo(() => {
  if (!selectedRegionId) return { tx: 0, ty: 0, s: 1 };
  const sel = deptPaths.find((p) => p.id === selectedRegionId)!;
  const [[x0, y0], [x1, y1]] = sel.bounds;
  const w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const padding = 0.78;
  const s = Math.min((VB_W * padding) / w, (VB_H * padding) / h);
  return { tx: VB_W / 2 - cx * s, ty: VB_H / 2 - cy * s, s };
}, [selectedRegionId, deptPaths]);

// Animación con requestAnimationFrame — cubic ease-out, 700ms.
useEffect(() => {
  const duration = 700, start = performance.now(), from = animTransform;
  const step = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    setAnimTransform({
      tx: from.tx + (targetTransform.tx - from.tx) * eased,
      ty: from.ty + (targetTransform.ty - from.ty) * eased,
      s:  from.s  + (targetTransform.s  - from.s)  * eased,
    });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}, [targetTransform.tx, targetTransform.ty, targetTransform.s]);
```

> **Importante:** el zoom se aplica como atributo SVG `transform` en un `<g>`
> envolvente, **no** como `transform` CSS. Esto evita que los strokes y las
> fuentes se escalen mal. Para mantener el tamaño visual de los textos y
> bordes, dividimos sus tamaños por `zoomScale`:
>
> ```tsx
> const fs = { dept: 9 / zoomScale, deptSelected: 11.5 / zoomScale, ... };
> const sw = { dept: 0.6 / zoomScale, deptSelected: 1.6 / zoomScale, ... };
> ```

### 7.5. Estructura del JSX (esqueleto del SVG)

```tsx
<svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
  <defs>
    {/* Patrón de océano: papel kraft con trazos diagonales */}
    <pattern id="ocean" width="26" height="26" patternUnits="userSpaceOnUse"
             patternTransform="rotate(28)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#D4C8AA" strokeWidth="0.6" />
    </pattern>
    {/* Sombra papel para los departamentos */}
    <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1.5" dy="3" stdDeviation="2.5"
                    floodColor="#1B1611" floodOpacity="0.22" />
    </filter>
  </defs>

  {/* Fondo */}
  <rect width={VB_W} height={VB_H} fill="#F4EEDD" />
  <rect width={VB_W} height={VB_H} fill="url(#ocean)" opacity={0.55} />

  {/* Grupo que recibe el zoom */}
  <g transform={`translate(${tx},${ty}) scale(${zoomScale})`}>
    <g filter="url(#paper-shadow)">
      {deptPaths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          fill={fillForValue(p.value, max)}
          stroke={isSelected ? "#1B1611" : "#76695A"}
          strokeWidth={isSelected ? sw.deptSelected : sw.dept}
          onMouseEnter={() => onHoverRegion(p.id)}
          onMouseLeave={() => onHoverRegion(null)}
          onClick={() => onSelectRegion(isSelected ? null : p.id)}
          style={{ cursor: "pointer", opacity: isDimmed ? 0.25 : 1 }}
        />
      ))}
    </g>

    {/* Provincias del departamento seleccionado */}
    {selectedRegionId && provincePaths.map((p) => (
      <path key={p.id} d={p.d} ... />
    ))}

    {/* Etiquetas: dos <text> superpuestos para halo con paintOrder: stroke */}
    {deptPaths.map((p) => (
      <g transform={`translate(${cx},${cy})`}>
        <text fill="#1B1611" stroke="#F4EEDD" strokeWidth={sw.labelHalo}
              style={{ paintOrder: "stroke" }}>
          {p.name}
        </text>
        <text fill="#1B1611">{p.name}</text>
      </g>
    ))}
  </g>
</svg>
```

---

## 8. Paleta de colores (papel kraft / cálida)

```ts
function fillForValue(value: number, max: number): string {
  if (max === 0 || value === 0) return "#E8DFC7"; // warm0
  const t = value / max;
  if (t < 0.20) return "#D9B97A"; // sand
  if (t < 0.45) return "#C28840"; // bronze
  if (t < 0.70) return "#A05A1F"; // tobacco
  if (t < 0.90) return "#7A2E18"; // oxblood
  return "#4A150C";               // deep
}
```

Otros colores usados en el SVG:

| Uso | Color |
|---|---|
| Fondo papel | `#F4EEDD` |
| Trazos de océano | `#D4C8AA` |
| Borde departamento | `#76695A` |
| Borde dept seleccionado | `#1B1611` |
| Provincia con datos (fill) | `rgba(139, 42, 30, 0.45)` |
| Provincia con datos (stroke) | `#8B2A1E` |
| Provincia vacía | `rgba(118, 105, 90, 0.08)` |
| Sombra | `#1B1611` @ 22% |

Reemplazá estos hex si querés otra estética (azul océano, verde militar, etc.)
— el resto del componente es independiente del color.

---

## 9. Pasos para portarlo a otro proyecto Next.js

1. **Copiá los GeoJSON** a tu carpeta `public/`:
   - `peru-departments.json`
   - `peru-provinces.json`
2. **Instalá** `d3-geo`:
   ```bash
   npm i d3-geo
   npm i -D @types/d3-geo @types/geojson
   ```
3. **Copiá** `components/PeruChoropleth.tsx` tal cual.
4. **Adaptá** las dependencias del wrapper:
   - Reemplazá `REGIONES` (de `lib/peru-data.ts`) por tu propia fuente de datos
     indexada por `id` de departamento.
   - Reemplazá `regionMetric()` por tu función que devuelve el valor a pintar.
   - Quitá Tailwind si no lo usás (las clases en el SVG son sólo `h-full w-full`).
5. **Montá el componente** dentro de un wrapper marcado como `"use client"`
   con `dynamic(..., { ssr: false })`.

### Versión mínima sin Tailwind / sin datos externos

Si lo único que querés es **el mapa del Perú** clickeable, sin métricas:

```tsx
// MapPeruMinimal.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";

export function MapPeruMinimal({ onClick }: { onClick?: (id: string) => void }) {
  const [data, setData] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    fetch("/peru-departments.json").then((r) => r.json()).then(setData);
  }, []);

  const paths = useMemo(() => {
    if (!data) return [];
    const projection = geoMercator().fitExtent([[16, 24], [464, 684]], data);
    const pg = geoPath(projection);
    return data.features.map((f: any) => ({
      id: f.properties.id,
      name: f.properties.name,
      d: pg(f) || "",
    }));
  }, [data]);

  if (!data) return <div>Cargando…</div>;

  return (
    <svg viewBox="0 0 480 700" style={{ width: "100%", height: "100%" }}>
      <rect width="480" height="700" fill="#F4EEDD" />
      {paths.map((p) => (
        <path key={p.id} d={p.d}
              fill="#D9B97A" stroke="#76695A" strokeWidth="0.6"
              onClick={() => onClick?.(p.id)}
              style={{ cursor: "pointer" }} />
      ))}
    </svg>
  );
}
```

Esto es **todo** lo que necesitás para un mapa estático del Perú clickeable
por departamento. ~25 líneas.

---

## 10. Si NO usás Next.js

El componente es 100% portable a:

- **Vite + React** — funciona idéntico. Sólo borrá el `dynamic()` y el
  `"use client"` y serví los GeoJSON desde `public/` (Vite los expone igual).
- **Vue / Svelte / vanilla JS** — la lógica de `geoMercator().fitExtent()`
  + `geoPath()` + render del `<path>` es la misma. Sólo cambia el binding
  de eventos.
- **HTML puro sin framework** — sí, también. Cargás `d3-geo` por CDN
  (`https://cdn.jsdelivr.net/npm/d3-geo@3/+esm`), hacés `fetch` del GeoJSON,
  generás los strings de `d` y los inyectás como atributos en `<path>`.

---

## 11. Gotchas que ya resolvimos por vos

| Problema | Solución que ya está en el código |
|---|---|
| El mapa se renderiza vacío en SSR | `dynamic(..., { ssr: false })` |
| Los strokes se hacen gigantes al hacer zoom | Dividir `strokeWidth` por `zoomScale` |
| Las etiquetas no se leen sobre colores oscuros | Doble `<text>` con `paintOrder: stroke` y halo color papel |
| Al volver al país, el zoom "salta" | Animación con `requestAnimationFrame` y ease-out cúbico |
| Polígonos del INEI son pesados (~4 MB cada uno) | El repo `juaneladio/peru-geojson` ya los entrega simplificados (~600 KB) |
| Joins entre provincias del GeoJSON y datos mock fallan por tildes | `normalizeRegionId()` en `lib/utils.ts` — slug sin acentos |

---

## 12. Licencias

- **GeoJSON** (`juaneladio/peru-geojson`): datos del INEI, dominio público.
- **`d3-geo`**: BSD-3-Clause.
- **Código del componente** (este repo): el que decidas para tu proyecto destino.

---

*Documento generado a partir del código actual de Vigía Perú
(`frontend/components/PeruChoropleth.tsx`, `frontend/components/MapaWrapper.tsx`,
`backend/scripts/fetch_peru_geo.py`). Si modificás el componente original, regenerá
este archivo.*
