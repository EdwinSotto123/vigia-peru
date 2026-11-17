"use client";

/**
 * «Ahora mismo»: lo que Vigía está leyendo en este momento, arriba de «Cómo trabaja Vigía» (pedido del usuario del
 * 2026-11-17: «no destacamos la auditoría en tiempo real»). Sale de GET /transparencia/ahora y se vuelve a pedir cada
 * 15 s mientras la pestaña está a la vista. Muestra:
 *   · una frase con la última hora (documentos leídos, páginas escaneadas pasadas a texto, análisis terminados) y lo
 *     que está en análisis en este momento;
 *   · las cifras de hoy;
 *   · el ritmo de las últimas 24 horas, hora por hora (documentos arriba, análisis abajo: escalas distintas);
 *   · los últimos dictámenes publicados, con su nivel, que llevan a su contrato.
 * Sin datos de personas: los dictámenes salen con su código, su objeto y su entidad, como en la lista de contratos.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Radio, ScanText, Sparkles, Wallet } from "lucide-react";
import { baseApiNavegador } from "@/lib/api-client";
import { numero, plural } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";
import { tituloNatural } from "@/lib/landing";
import { diaCorto, dolares, enLima, horaDe, type AhoraVigia } from "@/lib/transparencia";
import { Severidad } from "@/components/ui/Severidad";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { colorSerie, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { cn } from "@/lib/utils";

const CADA_MS = 15_000;

/** «21:27» si fue hoy (Lima); «16 nov. 21:27» si fue otro día: una hora sola haría creer que fue hoy. */
function cuando(fechaHora: string | null | undefined, hoy: string | null): string {
  if (!fechaHora) return "";
  const dia = fechaHora.slice(0, 10);
  return dia === hoy ? horaDe(fechaHora) ?? "" : `${diaCorto(dia)} ${horaDe(fechaHora) ?? ""}`.trim();
}

/** ¿Hubo actividad en los últimos 20 minutos? Sólo entonces late el punto (lo «en vivo» no se finge). */
function reciente(ultima: string | null, generado: string): boolean {
  if (!ultima) return false;
  const lima = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(generado));
  const a = Date.parse(`${ultima.replace(" ", "T")}:00Z`);
  const b = Date.parse(`${lima.replace(" ", "T")}:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b - a <= 20 * 60_000;
}

export function AhoraMismo({ inicial }: { inicial: AhoraVigia | null }) {
  const [d, setD] = useState<AhoraVigia | null>(inicial);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`${baseApiNavegador()}/transparencia/ahora`)
        .then((r) => (r.ok ? (r.json() as Promise<AhoraVigia>) : Promise.reject(new Error(String(r.status)))))
        .then((x) => {
          if (vivo) {
            setD(x);
            setFallo(false);
          }
        })
        .catch(() => vivo && setFallo(true));
    };
    const t = window.setInterval(pedir, CADA_MS);
    document.addEventListener("visibilitychange", pedir);
    return () => {
      vivo = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", pedir);
    };
  }, []);

  if (!d) {
    return (
      <section aria-labelledby="ahora-titulo" className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-6">
        <h2 id="ahora-titulo" className="font-display text-bloque font-bold text-ink">Ahora mismo</h2>
        <p className="mt-1 text-dato text-inkSoft">No pudimos leer la actividad en este momento. La auditoría sigue corriendo; vuelve a intentar en un minuto.</p>
      </section>
    );
  }

  const h = d.ultimaHora;
  const hoy = d.hoy;
  const enVuelo = d.enVuelo?.analisis ?? 0;
  const late = reciente(d.ultimaActividad, d.generado);
  const hoyLima = enLima(d.generado)?.slice(0, 10) ?? null;
  const frase = h
    ? h.documentos || h.analisis
      ? [
          h.documentos > 0 && `leyó ${plural(h.documentos, "documento", "documentos")}`,
          h.paginas > 0 && `pasó a texto ${plural(h.paginas, "página escaneada", "páginas escaneadas")}`,
          h.analisis > 0 && `terminó ${plural(h.analisis, "análisis de contrato", "análisis de contratos")}`,
        ].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " y $1")
      : null
    : null;

  return (
    <section aria-labelledby="ahora-titulo" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-6">
        <h2 id="ahora-titulo" className="flex items-center gap-2.5 font-display text-bloque font-bold text-ink">
          {late ? <PulseDot /> : <Radio size={16} className="text-mute" aria-hidden />}
          Ahora mismo
        </h2>
        <p className="text-rotulo text-mute" aria-live="polite">
          {fallo ? "Sin conexión con la auditoría: se muestra lo último que llegó" : `Se actualiza solo cada 15 segundos`}
          {d.ultimaActividad ? `. Última lectura: ${cuando(d.ultimaActividad, hoyLima)}` : ""}
        </p>
      </div>

      <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <p className="max-w-[60ch] text-destacado font-semibold leading-snug text-ink text-pretty">
            {frase ? <>En la última hora Vigía {frase}.</> : <>En la última hora no hubo lecturas: la cola sigue y la próxima tanda arranca sola.</>}
            {enVuelo > 0 && <> Ahora mismo hay {plural(enVuelo, "contrato en análisis", "contratos en análisis")}.</>}
          </p>

          {hoy && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Cifra icono={<FileText size={14} aria-hidden />} etiqueta="Documentos leídos hoy" valor={numero(hoy.documentos)} />
              <Cifra icono={<ScanText size={14} aria-hidden />} etiqueta="Páginas pasadas a texto" valor={numero(hoy.paginas)} />
              <Cifra icono={<Sparkles size={14} aria-hidden />} etiqueta="Contratos analizados hoy" valor={numero(hoy.analisis)} />
              <Cifra icono={<Wallet size={14} aria-hidden />} etiqueta="Gastado hoy en modelos" valor={dolares(hoy.usd)} />
            </dl>
          )}

          {d.porHora && <Ritmo horas={d.porHora} />}
        </div>

        <div className="min-w-0">
          <h3 className="text-cuerpo font-semibold text-ink">Últimos dictámenes publicados</h3>
          {d.recientes.length ? (
            <ul className="mt-2 divide-y divide-line">
              {d.recientes.map((r, i) => (
                <li key={`reciente-${i}`}>
                  <Link
                    href={rutaContrato(r.codigo ?? r.ocid, "dictamen")}
                    prefetch={false}
                    className="group flex items-start gap-3 py-2.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:bg-paperSoft focus-visible:outline-none"
                  >
                    <span className="mt-0.5 shrink-0"><Severidad score={r.score} formato="punto" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-dato font-medium leading-snug text-ink group-hover:text-granate">{r.objeto ? tituloNatural(r.objeto) : "Contrato sin objeto registrado"}</span>
                      <span className="mt-0.5 block truncate text-rotulo text-mute">{r.entidad ? tituloNatural(r.entidad) : "Entidad sin nombre"}</span>
                    </span>
                    <span className="shrink-0 font-mono text-rotulo tabular-nums text-mute">{cuando(r.analizado, hoyLima)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-dato text-inkSoft">Todavía no hay dictámenes publicados hoy.</p>
          )}
          <EnlaceAccion href="/app/auditoria" variante="secundario" flecha className="mt-3">
            Abrir la auditoría en vivo
          </EnlaceAccion>
        </div>
      </div>
    </section>
  );
}

function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-moss" />
    </span>
  );
}

function Cifra({ icono, etiqueta, valor }: { icono: React.ReactNode; etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-start gap-1.5 text-rotulo leading-snug text-mute">
        <span className="mt-px shrink-0 text-granate">{icono}</span>
        <span>{etiqueta}</span>
      </dt>
      <dd className="mt-0.5 whitespace-nowrap font-display text-bloque font-bold tabular-nums text-ink sm:text-cifra">{valor}</dd>
    </div>
  );
}

/**
 * Las últimas 24 horas en dos filas que comparten el eje: arriba los documentos leídos, abajo los análisis terminados
 * (escalas distintas: una hora lee cientos de documentos y termina decenas de análisis). La hora actual va marcada.
 */
function Ritmo({ horas }: { horas: { hora: string; analisis: number; documentos: number }[] }) {
  const W = 24 * 12;
  const maxD = Math.max(1, ...horas.map((x) => x.documentos));
  const maxA = Math.max(1, ...horas.map((x) => x.analisis));
  const totD = horas.reduce((t, x) => t + x.documentos, 0);
  const totA = horas.reduce((t, x) => t + x.analisis, 0);
  const fila = (campo: "documentos" | "analisis", max: number, serie: number, alto: number) => (
    <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden>
      <line x1={0} x2={W} y1={alto - 0.5} y2={alto - 0.5} className="stroke-line" strokeWidth={1} />
      {horas.map((x, i) => {
        const v = x[campo];
        const hgt = v > 0 ? Math.max(2, ((alto - 2) * v) / max) : 0;
        return (
          <rect key={x.hora} x={i * 12 + 1.5} y={alto - 1 - hgt} width={9} height={hgt} rx={1.5}
                style={{ fill: colorSerie(serie), opacity: i === horas.length - 1 ? 1 : 0.85 }} />
        );
      })}
    </svg>
  );
  const etiqueta = (i: number) => horas[i]?.hora.slice(11, 13);
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
        <span className="font-semibold text-inkSoft">Últimas 24 horas</span>
        <span className="inline-flex items-center gap-1.5"><MuestraSerie i={1} /> {plural(totD, "documento leído", "documentos leídos")}</span>
        <span className="inline-flex items-center gap-1.5"><MuestraSerie i={0} /> {plural(totA, "análisis", "análisis")}</span>
      </figcaption>
      <div
        role="img"
        aria-label={`Ritmo de las últimas 24 horas: ${totD} documentos leídos y ${totA} análisis terminados. La hora con más documentos tuvo ${maxD}; la de más análisis, ${maxA}.`}
        className="mt-2 space-y-1"
      >
        <div className="h-14">{fila("documentos", maxD, 1, 56)}</div>
        <div className="h-7">{fila("analisis", maxA, 0, 28)}</div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-rotulo tabular-nums text-mute" aria-hidden>
        {[0, 6, 12, 18, 23].map((i) => (
          <span key={i} className={cn(i === 23 && "text-ink")}>{i === 23 ? "ahora" : `${etiqueta(i)} h`}</span>
        ))}
      </div>
    </figure>
  );
}
