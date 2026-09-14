-- Opiniones OECE estructuradas — 721 filas (333 opiniones únicas, 1 fila por
-- artículo tocado). Permite búsqueda por (norma, articulo_ley | articulo_reglamento)
-- mucho más precisa que el RAG semántico.

CREATE TABLE IF NOT EXISTS opiniones_oece_estructurado (
    id                    BIGSERIAL PRIMARY KEY,
    ano                   INTEGER NOT NULL,
    norma                 TEXT    NOT NULL,
    num_opinion           TEXT    NOT NULL,
    articulo_ley          TEXT,
    numeral_art_ley       TEXT,
    literal_art_ley       TEXT,
    articulo_reglamento   TEXT,
    interpretacion        TEXT    NOT NULL,
    link                  TEXT
);
