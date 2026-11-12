-- D1 vigia-precios-lab: investigaciones de precio, sus pasos y las ofertas encontradas.
--   npx wrangler d1 execute vigia-precios-lab --remote --file schema.sql

CREATE TABLE IF NOT EXISTS investigacion (
  id                  TEXT PRIMARY KEY,
  clave               TEXT UNIQUE,              -- idempotencia: la misma entrada el mismo día
  estado              TEXT NOT NULL,            -- en_cola | corriendo | listo | error
  paso                TEXT,
  consulta            TEXT NOT NULL,
  entrada             TEXT NOT NULL,            -- JSON (tipos.ts Entrada)
  ficha               TEXT,                     -- JSON: lo que entendió el modelo
  resumen             TEXT,                     -- JSON: estadística y veredicto
  error               TEXT,
  tokens_entrada      INTEGER NOT NULL DEFAULT 0,
  tokens_salida       INTEGER NOT NULL DEFAULT 0,
  costo_modelo        REAL NOT NULL DEFAULT 0,  -- US$ de GLM 5.3 flash
  busquedas_web       INTEGER NOT NULL DEFAULT 0,
  costo_web           REAL NOT NULL DEFAULT 0,  -- US$ de Tavily
  segundos_navegador  REAL NOT NULL DEFAULT 0,  -- Browser Run
  segundos_contenedor REAL NOT NULL DEFAULT 0,  -- Crawl4AI en el contenedor de Cloudflare
  costo_contenedor    REAL NOT NULL DEFAULT 0,  -- US$ estimados (standard-1 mientras corre)
  creado              TEXT NOT NULL,
  terminado           TEXT
);
CREATE INDEX IF NOT EXISTS investigacion_creado ON investigacion (creado DESC);

CREATE TABLE IF NOT EXISTS paso (
  investigacion  TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  estado         TEXT NOT NULL,                 -- corriendo | listo | error | saltado
  detalle        TEXT,
  inicio         TEXT,
  fin            TEXT,
  PRIMARY KEY (investigacion, nombre)
);

CREATE TABLE IF NOT EXISTS oferta (
  investigacion    TEXT NOT NULL,
  n                INTEGER NOT NULL,
  fuente           TEXT NOT NULL,               -- tienda | web
  tienda           TEXT NOT NULL,
  titulo           TEXT NOT NULL,
  marca            TEXT,
  url              TEXT NOT NULL,
  precio           REAL,
  moneda           TEXT,
  disponibilidad   TEXT,
  extraccion       TEXT NOT NULL,               -- api_tienda | json_ld | microdatos | open_graph | ia | navegador_*
  confirmado       INTEGER,                     -- el precio aparece en el texto visible
  vendedor         TEXT,
  similitud        REAL,
  coincidencia     TEXT NOT NULL,               -- exacta | equivalente | distinta | sin_juicio
  unidades         REAL,
  razon            TEXT,
  precio_unitario  REAL,
  valida           INTEGER NOT NULL DEFAULT 0,
  motivo           TEXT,
  evidencia        TEXT,                        -- clave en R2
  PRIMARY KEY (investigacion, n)
);

-- Búsquedas web (Tavily, 3 días) y robots.txt (1 día).
CREATE TABLE IF NOT EXISTS cache_busqueda (
  clave   TEXT PRIMARY KEY,
  valor   TEXT NOT NULL,
  creado  INTEGER NOT NULL
);

-- 2026-11-12 (Crawl4AI en contenedor), para la base ya creada:
--   ALTER TABLE investigacion ADD COLUMN segundos_contenedor REAL NOT NULL DEFAULT 0;
--   ALTER TABLE investigacion ADD COLUMN costo_contenedor REAL NOT NULL DEFAULT 0;
