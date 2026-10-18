-- vigia-precios (D1). Aplicar: npx wrangler d1 execute vigia-precios --remote --file schema.sql

-- Respuesta de una tienda para un término, por 7 días (TTL_CACHE_DIAS): no se le pregunta dos veces lo mismo.
CREATE TABLE IF NOT EXISTS cache_busqueda (
  clave TEXT PRIMARY KEY,          -- "<tienda>|<término normalizado>"
  respuesta TEXT NOT NULL,         -- JSON: Producto[]
  creado INTEGER NOT NULL          -- epoch ms
);

-- Corte automático por tienda (tiendas.ts: estadoTrasFallo).
CREATE TABLE IF NOT EXISTS estado_tienda (
  tienda TEXT PRIMARY KEY,
  errores INTEGER NOT NULL DEFAULT 0,
  bloqueada_hasta INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  actualizado INTEGER NOT NULL
);

-- Índice propio: cada precio visto (canasta semanal y búsquedas), con fecha.
CREATE TABLE IF NOT EXISTS precio_observado (
  fecha TEXT NOT NULL,             -- YYYY-MM-DD
  termino TEXT NOT NULL,           -- normalizado
  tienda TEXT NOT NULL,
  sku TEXT,
  producto TEXT NOT NULL,
  marca TEXT,
  precio REAL NOT NULL,
  precio_lista REAL,
  url TEXT NOT NULL,
  origen TEXT NOT NULL,            -- 'canasta' | 'busqueda'
  PRIMARY KEY (fecha, tienda, termino, producto)
);
CREATE INDEX IF NOT EXISTS ix_precio_termino ON precio_observado (termino, fecha);

-- Osinergmin, Registro de Precios de Distribuidores Minoristas: la última foto del reporte diario.
CREATE TABLE IF NOT EXISTS combustible (
  fecha TEXT NOT NULL,
  departamento TEXT NOT NULL,
  producto TEXT NOT NULL,
  producto_original TEXT,
  ruc TEXT,
  razon_social TEXT,
  precio_min REAL,
  precio_max REAL,
  unidad TEXT
);
CREATE INDEX IF NOT EXISTS ix_combustible ON combustible (producto, departamento, fecha);

CREATE TABLE IF NOT EXISTS actualizacion (
  que TEXT PRIMARY KEY,            -- 'combustible' | 'canasta'
  cuando INTEGER NOT NULL,
  detalle TEXT
);

-- EMMSA · Gran Mercado Mayorista de Lima: precio diario por kg de cada variedad (src/mayorista.ts).
CREATE TABLE IF NOT EXISTS mayorista (
  fecha TEXT NOT NULL,             -- YYYY-MM-DD
  producto TEXT NOT NULL,
  variedad TEXT NOT NULL,
  precio_min REAL,
  precio_max REAL,
  precio_prom REAL,
  PRIMARY KEY (fecha, producto, variedad)
);
CREATE INDEX IF NOT EXISTS ix_mayorista_fecha ON mayorista (fecha);
