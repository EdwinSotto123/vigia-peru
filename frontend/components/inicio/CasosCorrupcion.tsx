"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { CeldaFecha, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila } from "@/components/listado";
import { Buscador } from "@/components/listado/BarraFiltros";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { TAM_INFORMES, TIPO_RESPONSABILIDAD, paginaCorrupcion, type Corrupcion, type PaginaInformes, type TipoInforme } from "@/lib/corrupcion";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { BloqueInicio, SinDato } from "./BloquesInicio";

/**
 * "Casos de corrupción" del Inicio (entidad, región, partido), con los rótulos de docs/CORRUPCION.md y en dos partes
 * que nunca se suman:
 *   · Procuraduría Anticorrupción: lo COMPROBADO (casos con sentencia firme, en ejecución de sentencia) y los casos en
 *     trámite, en cifras; por sede, que es casi siempre un departamento. Con su tabla de sedes si hay más de una.
 *   · Contraloría: sus cifras y TODOS los informes con responsabilidad PRESUNTA en una tabla paginada, filtrable por
 *     tipo; cada fila abre el informe oficial (el PDF nombra a los funcionarios: se enlaza, no se copia).
 * `ruta` es la de la API (lib/corrupcion.ts, rutaCorrupcion): la tabla pide ahí las páginas siguientes.
 */
export function CasosCorrupcion({
  datos,
  ruta,
  ambito,
  nombreRegion,
  nota,
}: {
  datos: Corrupcion | null | undefined;
  ruta: string;
  /** De quién es la sección: cambia los textos y si se muestra la Procuraduría (no hay cifras por partido). */
  ambito: "entidad" | "region" | "partido";
  nombreRegion?: string | null;
  /** Una advertencia bajo el título de la Contraloría (la usa el partido). */
  nota?: string;
}) {
  return (
    <BloqueInicio
      ancho
      titulo="Casos de corrupción"
      ayuda={
        <Ayuda titulo="¿De dónde salen y qué significan?">
          <span className="block">
            <strong>Procuraduría Anticorrupción</strong> (Procuraduría General del Estado): los casos penales por
            corrupción en los que el Estado es la parte agraviada. «Con sentencia firme» son los que están en ejecución de
            sentencia: ya hay una decisión firme y se cobra la reparación. Publica sus cifras por sede, casi siempre un
            departamento.
          </span>
          <span className="mt-2 block">
            <strong>Contraloría</strong>: informes de control que señalan una responsabilidad presunta (penal, civil o
            administrativa) de funcionarios y la derivan a quien corresponde. No es una condena.
          </span>
          <span className="mt-2 block">Las dos fuentes van por separado y nunca se suman.</span>
        </Ayuda>
      }
    >
      {datos === undefined ? (
        <SinDato>Cargando…</SinDato>
      ) : datos === null ? (
        <SinDato>Sin dato: el servicio no respondió.</SinDato>
      ) : (
        <div className="space-y-6">
          {ambito !== "partido" && <Procuraduria datos={datos} ambito={ambito} nombreRegion={nombreRegion} />}
          <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} />
        </div>
      )}
    </BloqueInicio>
  );
}

function Subtitulo({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-[14px] font-semibold text-ink">{titulo}</h4>
      <p className="text-[12.5px] text-mute">{bajada}</p>
    </div>
  );
}

function Procuraduria({ datos, ambito, nombreRegion }: { datos: Corrupcion; ambito: "entidad" | "region"; nombreRegion?: string | null }) {
  const pp = datos.procuraduria;
  const bajada = ambito === "entidad" && nombreRegion
    ? `Lo comprobado en ${nombreRegion}: la Procuraduría publica cifras por sede, no por entidad.`
    : "Lo comprobado: casos con sentencia firme.";
  return (
    <section>
      <Subtitulo titulo="Procuraduría Anticorrupción" bajada={bajada} />
      {!pp ? (
        <SinDato>La Procuraduría no publica una sede para este departamento en su último boletín.</SinDato>
      ) : (
        <div className="space-y-3">
          <Indicadores
            items={[
              { valor: numero(pp.en_ejecucion), etiqueta: "con sentencia firme", contexto: "en ejecución de sentencia", tono: "alta" },
              { valor: numero(pp.en_tramite), etiqueta: "casos en trámite", contexto: "incluye los de sentencia firme" },
              { valor: pp.sentencias != null ? numero(pp.sentencias) : null, etiqueta: "sentencias en el año", contexto: "condenas o decisiones firmes nuevas" },
              { valor: pp.reparacion_civil != null ? solesCompacto(pp.reparacion_civil) : null, etiqueta: "reparación cobrada", contexto: "en el año" },
            ]}
          />
          {pp.sedes.length > 1 && (
            <Tabla
              etiqueta="Casos de la Procuraduría por sede"
              densidad="compacta"
              medida="contenedor"
              columnas={COLUMNAS_SEDES}
              filas={pp.sedes.map((s) => ({
                id: s.sede,
                celdas: {
                  sede: <CeldaPrincipal titulo={s.sede} enLinea />,
                  firme: <span className="font-mono text-[13px] tabular-nums text-ink">{numero(s.en_ejecucion)}</span>,
                  tramite: <span className="font-mono text-[13px] tabular-nums text-inkSoft">{numero(s.en_tramite)}</span>,
                },
              }))}
            />
          )}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px]">
            <div className="flex gap-1.5">
              <dt className="text-mute">Corte</dt>
              <dd className="text-ink">{fechaCorta(pp.corte)}</dd>
            </div>
            {pp.sedes.length > 1 && (
              <div className="flex gap-1.5">
                <dt className="text-mute">Sedes</dt>
                <dd className="text-ink">{numero(pp.sedes.length)}</dd>
              </div>
            )}
            {pp.url_fuente && (
              <a href={pp.url_fuente} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
                Boletín oficial (PDF) <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

const COLUMNAS_SEDES: Columna[] = [
  { clave: "sede", titulo: "Sede", ancho: "minmax(0,1fr)" },
  { clave: "firme", titulo: "Con sentencia firme", ancho: "150px", alinear: "der" },
  { clave: "tramite", titulo: "En trámite", ancho: "110px", alinear: "der" },
];

const VARIANTE: Record<string, "crimson" | "amber" | "neutral"> = { penal: "crimson", civil: "amber" };

function Contraloria({ datos, ruta, ambito, nota }: { datos: Corrupcion; ruta: string; ambito: "entidad" | "region" | "partido"; nota?: string }) {
  const inf = datos.informes;
  const [tipo, setTipo] = useState<TipoInforme | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState<PaginaInformes>(inf.pagina);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);

  const pedir = async (page: number, t: TipoInforme | null, q: string) => {
    setCargando(true);
    setFallo(false);
    const r = await paginaCorrupcion(ruta, page, t, q || null);
    if (r) setPagina(r);
    else setFallo(true);
    setCargando(false);
  };
  const filtrar = (t: TipoInforme | null) => {
    setTipo(t);
    void pedir(1, t, busca);
  };
  const buscar = (q: string) => {
    setBusca(q);
    void pedir(1, tipo, q);
  };

  const conEntidad = ambito !== "entidad";
  const columnas: Columna[] = [
    { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md" },
    { clave: "numero", titulo: "Informe", ancho: "148px", desde: "lg" },
    { clave: "asunto", titulo: "Asunto", ancho: "minmax(0,1.5fr)" },
    ...(conEntidad ? [{ clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)", desde: "lg" as const }] : []),
    { clave: "tipo", titulo: "Responsabilidad presunta", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  ];
  const filas: Fila[] = pagina.filas.map((i) => ({
    id: i.numero,
    href: i.urlPdf ?? undefined,
    externo: true,
    celdas: {
      fecha: <CeldaFecha fecha={i.fecha} />,
      numero: <span className="font-mono text-[12.5px] text-inkSoft">{i.numero}</span>,
      asunto: (
        <CeldaPrincipal
          titulo={i.titulo ? tituloNatural(i.titulo) : "Sin asunto registrado"}
          dosLineas
          meta={[i.funcionarios ? <Dato key="f" tipo="personas" nombre="Funcionarios comprendidos">{numero(i.funcionarios)} funcionarios comprendidos</Dato> : null]}
        />
      ),
      entidad: <span className="line-clamp-2 text-[13px] text-inkSoft" title={i.entidad ?? undefined}>{i.entidad ? tituloNatural(i.entidad) : "Sin dato"}</span>,
      tipo: (
        <ul className="flex flex-wrap gap-1" aria-label="Tipos de responsabilidad">
          {i.responsabilidades.map((r) => (
            <li key={r}><Badge variant={VARIANTE[r] ?? "neutral"}>{TIPO_RESPONSABILIDAD[r] ?? r}</Badge></li>
          ))}
        </ul>
      ),
    },
  }));
  const opciones: { t: TipoInforme | null; etiqueta: string; n: number }[] = [
    { t: null, etiqueta: "Todos", n: inf.total },
    { t: "penal", etiqueta: "Penal", n: inf.penal },
    { t: "civil", etiqueta: "Civil", n: inf.civil },
    { t: "administrativa", etiqueta: "Administrativa", n: inf.administrativa },
  ];
  const paginas = Math.max(1, Math.ceil(pagina.total / TAM_INFORMES));

  return (
    <section>
      <Subtitulo titulo="Contraloría" bajada="Presunta responsabilidad de funcionarios: no es una condena." />
      {nota && <p className="-mt-1 mb-3 max-w-3xl text-[12.5px] text-mute">{nota}</p>}
      {inf.total === 0 ? (
        <SinDato>La Contraloría no tiene informes con responsabilidad en su buscador para este alcance.</SinDato>
      ) : (
        <div className="space-y-4">
          <Indicadores
            items={[
              { valor: numero(inf.total), etiqueta: "informes de control", contexto: inf.desde ? `de ${inf.desde.slice(0, 4)} a ${inf.hasta?.slice(0, 4)}` : undefined },
              { valor: numero(inf.penal), etiqueta: "con presunta responsabilidad penal", tono: "alta" },
              { valor: numero(inf.civil), etiqueta: "con presunta responsabilidad civil", tono: "media" },
              { valor: numero(inf.funcionarios), etiqueta: "funcionarios comprendidos", contexto: conEntidad ? `en ${numero(inf.entidades)} entidades` : undefined },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Buscador
              placeholder="Buscar un asunto, un número de informe o una entidad…"
              etiqueta="Buscar en los informes de la Contraloría"
              valor={busca}
              min={2}
              onBuscar={buscar}
            />
            <div role="group" aria-label="Filtrar por tipo de responsabilidad" className="inline-flex flex-wrap gap-1.5">
              {opciones.map((o) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  aria-pressed={tipo === o.t}
                  onClick={() => filtrar(o.t)}
                  className={
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors " +
                    (tipo === o.t ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
                  }
                >
                  {o.etiqueta}
                  <span className={"font-mono text-[12px] tabular-nums " + (tipo === o.t ? "text-paper/80" : "text-mute")}>{numero(o.n)}</span>
                </button>
              ))}
            </div>
            <Paginacion
              actual={pagina.page}
              paginas={paginas}
              total={pagina.total}
              tam={TAM_INFORMES}
              navegacion="interna"
              onChange={(n) => void pedir(n, tipo, busca)}
              cargando={cargando}
              nombre="informes"
            />
          </div>
          {fallo ? (
            <SinDato>No pudimos traer esa página. Vuelve a intentarlo.</SinDato>
          ) : busca && pagina.total === 0 ? (
            <SinDato>Ningún informe coincide con “{busca}”.</SinDato>
          ) : (
            <div className={cargando ? "opacity-60 transition-opacity" : undefined} aria-busy={cargando}>
              <Tabla columnas={columnas} filas={filas} etiqueta="Informes de control de la Contraloría" medida="contenedor" />
            </div>
          )}
          <p className="text-[12px] text-mute">
            Cada fila abre el informe oficial en la Contraloría. Todos están también en su{" "}
            <a href="https://buscadorinformes.contraloria.gob.pe/" target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
              buscador de informes
            </a>
            .
          </p>
        </div>
      )}
    </section>
  );
}
