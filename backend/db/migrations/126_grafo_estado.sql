-- 126 · Grafo de la estructura del Estado (dataset/CLAUDE-GENERADO, corte 2026).
--
-- Importa el grafo institucional del Estado peruano: nodos (pligos, entidades, órganos, cargos, decisiones RS/RM,
-- personas = altos funcionarios actuales, unidades ejecutoras…) y aristas (quién ocupa/designa/firma un cargo, jerarquía,
-- y la "estructura tipo" que define la AGA = la autoridad que aprueba los contratos de cada entidad). Fuentes oficiales,
-- confianza A/B en el 99% de las aristas. Es un SNAPSHOT (no se auto-actualiza). Lo cargan los CSV con cargar_grafo.py.
--
-- Sirve para mostrar, en la ficha de una entidad, QUIÉN decide y firma sus contratos (acercar la responsabilidad).

CREATE TABLE IF NOT EXISTS grafo_nodos (
  id                text PRIMARY KEY,
  tipo              text,
  subtipo           text,
  nombre            text,
  nombre_origen     text,
  sigla             text,
  codigo_origen     text,   -- pliego (nacionales) o código de la fuente
  nivel_gobierno    text,   -- GN / GR / GL
  sector            text,
  ubigeo            text,   -- entidades locales (municipalidades)
  departamento      text,
  provincia         text,
  entidad           text,
  padre_arbol       text,
  estado            text,
  fuentes           text,
  pia               numeric,
  pim               numeric,
  devengado         numeric,
  periodo_ind       text,
  ref_personas      text,
  ref_monto_mensual text,   -- texto: viene con formatos mixtos
  fecha             text,   -- texto: mezcla 'YYYY-MM-DD' y 'YYYY-MM'
  desde             text,
  hasta             text,
  nota              text
);
CREATE INDEX IF NOT EXISTS grafo_nodos_tipo ON grafo_nodos (tipo);
CREATE INDEX IF NOT EXISTS grafo_nodos_ubigeo ON grafo_nodos (ubigeo) WHERE ubigeo <> '';
CREATE INDEX IF NOT EXISTS grafo_nodos_codigo ON grafo_nodos (codigo_origen) WHERE codigo_origen <> '';

CREATE TABLE IF NOT EXISTS grafo_aristas (
  id              text PRIMARY KEY,
  origen          text,
  destino         text,
  tipo            text,
  fundamento      text,
  fuente          text,
  vigencia_desde  text,   -- texto: mezcla 'YYYY-MM-DD', 'YYYY-MM' y 'YYYY'
  vigencia_hasta  text,
  confianza       text,
  clase_hecho     text,
  explicacion     text,
  estado          text,
  hoja            text
);
CREATE INDEX IF NOT EXISTS grafo_aristas_origen ON grafo_aristas (origen);
CREATE INDEX IF NOT EXISTS grafo_aristas_destino ON grafo_aristas (destino);
CREATE INDEX IF NOT EXISTS grafo_aristas_tipo ON grafo_aristas (tipo);

ALTER TABLE grafo_nodos OWNER TO vigia_jobs;
ALTER TABLE grafo_aristas OWNER TO vigia_jobs;

-- Puente grafo ↔ nuestras entidades: por nombre normalizado (pliego_id_mef y tipo están vacíos en entidades; el nombre
-- empata ~78% del grafo). DISTINCT ON por ruc para un solo nodo por entidad.
CREATE OR REPLACE VIEW grafo_entidad AS
  SELECT DISTINCT ON (e.ruc) e.ruc, n.id AS nodo_id, n.nivel_gobierno, n.sector, n.codigo_origen, n.ubigeo
    FROM grafo_nodos n
    JOIN entidades e ON n.tipo = 'ENTIDAD' AND mef_norm(n.nombre) = mef_norm(e.nombre)
   ORDER BY e.ruc, n.id;
ALTER VIEW grafo_entidad OWNER TO vigia_jobs;
