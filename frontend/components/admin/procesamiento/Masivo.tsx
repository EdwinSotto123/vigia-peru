"use client";

import { useAdmin } from "@/lib/useAdmin";
import { rutaContrato } from "@/lib/rutas";
import { BarraSegmentada, Medidor, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { Badge, DataTable, EmptyState, ErrorBanner, StatCard, StatGrid, TONO, hace, type Columna } from "@/components/admin/ui";

/** GET /admin/masivo (migraciones 272 y 274). */
interface Red {
  red: string;
  hechos: number;
  errores: number;
  enVuelo: number;
  costo: number;
  medio: number | null;
  segundos: number | null;
  alto: number;
}
interface Dia {
  dia: string;
  hechos: number;
  errores: number;
  costo: number;
}
interface Tanda {
  origen: string;
  inicio: string;
  fin: string | null;
  tope: number;
  plan: string;
  filtro: string;
  pendientes: Record<string, number>;
  sinInfo: Record<string, number>;
  gastadoAlInicio: number | null;
  ok: number | null;
  errores: number | null;
  costo: number | null;
}
interface Ultimo {
  ocid: string;
  red: string;
  estado: "ok" | "error";
  costo: number;
  segundos: number | null;
  score: number | null;
  error: string | null;
  terminadoEn: string | null;
}
interface RespuestaMasivo {
  gastado: number;
  tope: number | null;
  hechos: number;
  medioGlobal: number | null;
  errores: number;
  enVuelo: number;
  pendientes: Record<string, number>;
  sinInfo: Record<string, number>;
  faltanUsd: number;
  alcanzaPara: number | null;
  filtro: string | null;
  redes: Red[];
  dias: Dia[];
  tandas: Tanda[];
  ultimos: Ultimo[];
}

const NUM = new Intl.NumberFormat("es-PE");
const usd = (n: number, dec = 2) => `US$ ${n.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const NOMBRE_RED: Record<string, string> = {
  bienes: "Bienes",
  servicios: "Servicios",
  consultoria: "Consultoría",
  obras: "Obras",
  otros: "Directas y otros",
  externo: "Pruebas y otros gastos",
};
const nombreRed = (r: string) => NOMBRE_RED[r] ?? r;
const minutos = (s: number | null) => (s == null ? "" : `${(s / 60).toLocaleString("es-PE", { maximumFractionDigits: 1 })} min`);
const fecha = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });
};
const hora = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const suma = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + n, 0);
const jobDe = (origen: string) => /^gitlab-(\d+)$/.exec(origen)?.[1] ?? null;

/**
 * Análisis masivo de contratos con las Lambdas de agentes y modelos abiertos de Workers AI (2026-11-12). El usuario:
 * «que salga en la plataforma cuánto hemos gastado y demás». Lo gastado frente al tope, lo hecho y lo que falta por red,
 * el gasto por día, las tandas de GitLab (cada 3 h) y los últimos contratos con su dictamen.
 */
export function Masivo() {
  const { data, error, isLoading, mutate } = useAdmin<RespuestaMasivo>("/masivo", { refreshInterval: 60_000 });
  const redes = (data?.redes ?? []).filter((r) => r.red !== "externo");
  const faltan = data ? suma(data.pendientes) : 0;
  const esperan = data ? suma(data.sinInfo) : 0;
  const alto = redes.reduce((a, r) => a + r.alto, 0);
  const parte = data?.tope ? data.gastado / data.tope : 0;
  const filasRed = redes.map((r) => ({ ...r, faltan: data?.pendientes[r.red] ?? 0, esperan: data?.sinInfo[r.red] ?? 0 }));

  const colRed: Columna<(typeof filasRed)[number]>[] = [
    {
      clave: "red",
      titulo: "Red",
      principal: true,
      celda: (r) => (
        <span className="inline-flex items-center gap-2">
          <MuestraSerie i={Math.max(0, redes.findIndex((x) => x.red === r.red))} />
          {nombreRed(r.red)}
        </span>
      ),
    },
    { clave: "hechos", titulo: "Analizados", alinear: "derecha", celda: (r) => NUM.format(r.hechos) },
    { clave: "alto", titulo: "Riesgo 70+", alinear: "derecha", celda: (r) => NUM.format(r.alto) },
    { clave: "errores", titulo: "Con error", alinear: "derecha", celda: (r) => NUM.format(r.errores) },
    { clave: "costo", titulo: "Gastado", alinear: "derecha", celda: (r) => usd(r.costo) },
    { clave: "medio", titulo: "Por contrato", alinear: "derecha", celda: (r) => (r.medio != null ? usd(r.medio, 3) : "") },
    { clave: "segundos", titulo: "Tiempo", alinear: "derecha", soloEscritorio: true, celda: (r) => minutos(r.segundos) },
    { clave: "faltan", titulo: "Faltan", alinear: "derecha", celda: (r) => NUM.format(r.faltan) },
    { clave: "esperan", titulo: "Esperan lecturas", alinear: "derecha", soloEscritorio: true, celda: (r) => NUM.format(r.esperan) },
  ];
  const colDia: Columna<Dia>[] = [
    { clave: "dia", titulo: "Día", principal: true, celda: (d) => fecha(d.dia) },
    { clave: "hechos", titulo: "Analizados", alinear: "derecha", celda: (d) => NUM.format(d.hechos) },
    { clave: "errores", titulo: "Con error", alinear: "derecha", celda: (d) => NUM.format(d.errores) },
    { clave: "costo", titulo: "Gastado", alinear: "derecha", celda: (d) => usd(d.costo) },
  ];
  const colTanda: Columna<Tanda>[] = [
    { clave: "inicio", titulo: "Empezó", principal: true, celda: (t) => hora(t.inicio) },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (t) => (t.fin ? <Badge tono="ok">Terminó</Badge> : <Badge tono="pending">Corriendo</Badge>),
    },
    { clave: "ok", titulo: "Analizados", alinear: "derecha", celda: (t) => (t.ok != null ? NUM.format(t.ok) : "") },
    {
      clave: "errores",
      titulo: "Con error",
      alinear: "derecha",
      celda: (t) => (t.errores != null ? <span className={t.errores > 10 ? `font-semibold ${TONO.danger.texto}` : ""}>{NUM.format(t.errores)}</span> : ""),
    },
    { clave: "costo", titulo: "Gastó", alinear: "derecha", celda: (t) => (t.costo != null ? usd(t.costo) : "") },
    { clave: "pendientes", titulo: "Faltaban", alinear: "derecha", soloEscritorio: true, celda: (t) => NUM.format(suma(t.pendientes)) },
    { clave: "plan", titulo: "Reparto", soloEscritorio: true, celda: (t) => <span className="font-mono text-meta">{t.plan}</span> },
    {
      clave: "job",
      titulo: "Job",
      soloEscritorio: true,
      celda: (t) => {
        const id = jobDe(t.origen);
        return id ? (
          <a className="text-granate underline-offset-2 hover:underline" href={`https://gitlab.com/simplia-group/vigia-peru/-/jobs/${id}`} target="_blank" rel="noreferrer">
            {id}
          </a>
        ) : (
          t.origen
        );
      },
    },
  ];
  const colUltimo: Columna<Ultimo>[] = [
    { clave: "ocid", titulo: "Contrato", principal: true, celda: (u) => <span className="font-mono">{u.ocid}</span> },
    { clave: "red", titulo: "Red", celda: (u) => nombreRed(u.red) },
    {
      clave: "estado",
      titulo: "Resultado",
      celda: (u) =>
        u.estado === "ok" ? (
          <Badge tono={u.score != null && u.score >= 70 ? "danger" : "ok"}>{u.score != null ? `Riesgo ${u.score}` : "Listo"}</Badge>
        ) : (
          <Badge tono="danger">{u.error ? "Error" : "Se cortó"}</Badge>
        ),
    },
    { clave: "costo", titulo: "Costo", alinear: "derecha", celda: (u) => usd(u.costo, 3) },
    { clave: "segundos", titulo: "Tiempo", alinear: "derecha", soloEscritorio: true, celda: (u) => minutos(u.segundos) },
    { clave: "cuando", titulo: "Cuándo", alinear: "derecha", celda: (u) => hace(u.terminadoEn) ?? "" },
  ];

  return (
    <div className="space-y-6">
      {error && <ErrorBanner error={error} titulo="No se pudo cargar el análisis masivo" onReintentar={() => mutate()} />}

      <StatGrid columnas={4}>
        <StatCard
          etiqueta="Gastado"
          valor={data ? usd(data.gastado) : null}
          pista={data ? (data.tope ? `de un tope de ${usd(data.tope, 0)}; quedan ${usd(Math.max(0, data.tope - data.gastado))}` : "Sin tope anotado todavía") : undefined}
          tono={parte >= 0.9 ? "warn" : "neutral"}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Contratos analizados"
          valor={data ? NUM.format(data.hechos) : null}
          pista={data ? `${NUM.format(alto)} con riesgo de 70 o más; ${NUM.format(data.errores)} con error (se reintentan una vez)` : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Faltan"
          valor={data ? NUM.format(faltan) : null}
          pista={data ? `con información bastante, unos ${usd(data.faltanUsd, 0)}; ${NUM.format(esperan)} esperan que se lean más documentos` : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="El tope alcanza para"
          valor={data?.alcanzaPara != null ? NUM.format(data.alcanzaPara) : data ? "Sin dato" : null}
          pista={data?.medioGlobal != null ? `contratos más, a ${usd(data.medioGlobal, 3)} cada uno` : undefined}
          cargando={isLoading}
        />
      </StatGrid>

      {data && data.tope ? (
        <section className="space-y-3 rounded-xl border border-line bg-paper p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-dato font-semibold text-ink">Gasto frente al tope</h3>
            <span className="text-meta text-mute">{Math.round(parte * 100)} % usado</span>
          </div>
          <Medidor parte={parte} etiqueta={`Gastado ${usd(data.gastado)} de ${usd(data.tope, 0)}`} />
          {redes.length > 0 && (
            <>
              <BarraSegmentada
                etiqueta="Gasto por red"
                partes={redes.map((r) => ({ clave: r.red, nombre: nombreRed(r.red), valor: r.costo, texto: usd(r.costo) }))}
              />
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink">
                {redes.map((r, i) => (
                  <li key={r.red} className="inline-flex items-center gap-1.5">
                    <MuestraSerie i={i} />
                    {nombreRed(r.red)} {usd(r.costo)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.filtro && <p className="text-meta text-mute">Solo entran contratos con {data.filtro}.</p>}
        </section>
      ) : null}

      {data && !data.redes.length ? (
        <EmptyState titulo="Todavía no hay análisis masivo" descripcion="Aparece cuando corre la primera tanda en GitLab." />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Por red</h3>
            <DataTable etiqueta="Análisis masivo por red" columnas={colRed} filas={data ? filasRed : undefined} claveFila={(r) => r.red} cargando={isLoading} />
          </section>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Tandas de GitLab</h3>
            <p className="text-meta text-mute">Una cada 3 horas. Muchos errores seguidos suelen ser los modelos de Cloudflare lentos.</p>
            <DataTable etiqueta="Tandas del análisis masivo" columnas={colTanda} filas={data?.tandas} claveFila={(t) => t.origen} cargando={isLoading} />
          </section>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Por día</h3>
            <DataTable etiqueta="Análisis masivo por día" columnas={colDia} filas={data?.dias} claveFila={(d) => d.dia} cargando={isLoading} />
          </section>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Últimos contratos</h3>
            <DataTable
              etiqueta="Últimos contratos del análisis masivo"
              columnas={colUltimo}
              filas={data?.ultimos}
              claveFila={(u) => `${u.ocid}:${u.terminadoEn}`}
              hrefFila={(u) => (u.estado === "ok" ? rutaContrato(u.ocid, "dictamen") : rutaContrato(u.ocid))}
              externo
              porPagina={20}
              cargando={isLoading}
            />
          </section>
        </>
      )}
    </div>
  );
}
