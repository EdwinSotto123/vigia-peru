import type { Metadata } from "next";
import { AlertTriangle, ArrowUpRight, Clock3, FileCheck2, Gavel, MapPin, Phone, Search } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Migas } from "@/components/patrones/Migas";
import { Pixel } from "@/components/pixel/Pixel";
import { CONSULTAS } from "@/components/car/consultas";
import { FuenteFecha } from "@/components/salud/comun";
import { direccionLegible } from "@/components/salud/ficha/piezas";
import { Paginas } from "@/components/salud/lista/Paginas";
import { DEPARTAMENTOS, nombreLugar } from "@/components/salud/lista/filtros";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { fechaCorta, nombrePropio, numero } from "@/lib/gobserva-salud";
import datos from "@/data/car/citv.json";

export const metadata: Metadata = {
  title: "Revisión técnica: centros autorizados",
  description: "Los centros de inspección técnica vehicular (CITV) autorizados por el MTC, con su horario, sus líneas, su resolución y si tienen días sin transmitir o una sanción.",
  alternates: { canonical: urlCanonica("car", "/revision-tecnica") },
};

interface Centro {
  razonSocial: string;
  direccion: string | null;
  horario: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  telefono: string | null;
  resolucion: string | null;
  fechaResolucion: string | null;
  inicioOperacion: string | null;
  lineas: number | null;
  tipoLineas: string | null;
  diasSinTransmitir: number | null;
  sancion: string | null;
}

const CENTROS = (datos as { centros: Centro[] }).centros;
const POR_PAGINA = 12;
const DIAS = ["LU", "MA", "MI", "JU", "VI", "SA", "DO"];
const NOMBRE_DIA: Record<string, string> = { LU: "Lun", MA: "Mar", MI: "Mié", JU: "Jue", VI: "Vie", SA: "Sáb", DO: "Dom" };

/** «LU: 08:00-17:00 | SA: 08:00-13:00 | VI: …» → los días en orden, con su horario («Lun 08:00–17:00»). */
function horario(h: string | null): { dia: string; horas: string }[] {
  if (!h) return [];
  const out = [...h.matchAll(/\b(LU|MA|MI|JU|VI|SA|DO)\s*:\s*([0-9:]+\s*-\s*[0-9:]+)/g)].map((m) => ({ dia: m[1], horas: m[2].replace(/\s*-\s*/, "–") }));
  return out.sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia));
}

/** «MIXTO (1),MENOR (1)» → [«Mixta», «Menor»] con cuántas líneas de cada tipo. */
function lineas(t: string | null): { tipo: string; n: number }[] {
  if (!t) return [];
  return [...t.matchAll(/([A-ZÁÉÍÓÚÑ ]+)\s*\((\d+)\)/g)].map((m) => {
    const tipo = m[1].trim().toLowerCase();
    return { tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/o$/, "a"), n: Number(m[2]) };
  });
}

const texto = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Un centro como casilla: su dibujo, el nombre, dónde, el horario, las líneas, el teléfono, la resolución y los avisos. */
function Casilla({ c }: { c: Centro }) {
  const dias = horario(c.horario);
  const ls = lineas(c.tipoLineas);
  const lugar = [c.distrito, c.provincia !== c.distrito ? c.provincia : null, c.departamento].filter(Boolean).map((x) => nombreLugar(x)).join(", ");
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-granate-50 p-1.5">
          <Pixel nombre="auto" escala={3} animado={false} acento="accion" className="max-h-full max-w-full" />
        </span>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-cuerpo font-bold leading-snug text-ink">{nombrePropio(c.razonSocial)}</h3>
          <p className="mt-0.5 flex items-start gap-1 text-meta text-inkSoft">
            <MapPin size={13} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span>{lugar}</span>
          </p>
        </div>
      </div>
      <div className="mt-2.5 space-y-2 px-4 text-meta">
        {c.direccion && <p className="text-inkSoft">{direccionLegible(c.direccion)}</p>}
        {(c.diasSinTransmitir ?? 0) > 0 || c.sancion ? (
          <p className="flex flex-wrap gap-1.5">
            {(c.diasSinTransmitir ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 font-semibold text-amberTexto">
                <AlertTriangle size={12} aria-hidden /> {numero(c.diasSinTransmitir)} {c.diasSinTransmitir === 1 ? "día" : "días"} sin transmitir al MTC
              </span>
            )}
            {c.sancion && (
              <span className="inline-flex items-center gap-1 rounded-full bg-crimson-soft px-2 py-0.5 font-semibold text-crimsonTexto">
                <Gavel size={12} aria-hidden /> Sanción: {c.sancion.replace(/^S\/\.?\s*/, "S/ ")}
              </span>
            )}
          </p>
        ) : null}
        {ls.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Líneas de inspección">
            {ls.map((l) => (
              <li key={l.tipo} className="rounded-md bg-paperSoft px-1.5 py-0.5 font-medium text-inkSoft">
                Línea {l.tipo.toLowerCase()}
                {l.n > 1 ? ` (${l.n})` : ""}
              </li>
            ))}
          </ul>
        )}
        {dias.length > 0 && (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-inkSoft" aria-label="Horario">
            {dias.map((d) => (
              <li key={d.dia} className="flex items-center gap-1.5 tabular-nums">
                <Clock3 size={12} aria-hidden className="shrink-0 text-mute" />
                <span className="w-8 font-semibold text-ink">{NOMBRE_DIA[d.dia]}</span> {d.horas}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-auto space-y-1 border-t border-line bg-paperSoft/50 px-4 py-2.5 text-rotulo text-inkSoft">
        {c.telefono && (
          <p className="flex items-center gap-1.5">
            <Phone size={12} aria-hidden className="shrink-0 text-mute" />
            {c.telefono.includes("•") ? (
              <span title="Número de celular: lo tapamos por privacidad">{c.telefono}</span>
            ) : (
              <a href={`tel:${c.telefono.replace(/[^\d+]/g, "")}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                {c.telefono}
              </a>
            )}
          </p>
        )}
        {c.resolucion && (
          <p className="flex items-center gap-1.5">
            <FileCheck2 size={12} aria-hidden className="shrink-0 text-mute" />
            Autorizado: RD {c.resolucion}
            {c.fechaResolucion ? `, ${fechaCorta(c.fechaResolucion)}` : ""}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Los centros de revisión técnica autorizados por el MTC (Gobserva Car, 2026-11-22): la lista que publica el MTC (Excel sin
 * captcha, data/car/citv.json, scripts/car/citv.py), por región y con búsqueda, en casillas. Al lado, la consulta oficial
 * de la revisión técnica de una placa.
 */
export default function RevisionTecnica({ searchParams }: { searchParams?: { region?: string; q?: string; pagina?: string } }) {
  const base = baseProducto("car");
  const region = DEPARTAMENTOS.find((d) => d === normal(texto(searchParams?.region))) ?? "";
  const q = texto(searchParams?.q).slice(0, 60);
  const palabras = normal(q).split(/\s+/).filter((w) => w.length > 1);
  const filtrados = CENTROS.filter(
    (c) =>
      (!region || c.departamento === region) &&
      palabras.every((w) => normal(`${c.razonSocial} ${c.distrito ?? ""} ${c.provincia ?? ""} ${c.direccion ?? ""}`).includes(w)),
  );
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const pagina = Math.min(Math.max(1, Number(texto(searchParams?.pagina)) || 1), paginas);
  const lista = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const porRegion = new Map<string, number>();
  for (const c of CENTROS) if (c.departamento) porRegion.set(c.departamento, (porRegion.get(c.departamento) ?? 0) + 1);
  const conAviso = filtrados.filter((c) => (c.diasSinTransmitir ?? 0) > 0 || c.sancion).length;
  const ruta = rutaEn(base, "/revision-tecnica");
  const href = (n: number) => `${ruta}?${new URLSearchParams({ ...(region ? { region } : {}), ...(q ? { q } : {}), ...(n > 1 ? { pagina: String(n) } : {}) })}`;
  const consultaPlaca = CONSULTAS.find((c) => c.clave === "revision")!;
  const d = datos as { url: string; generadoAl: string | null; fuente: string };

  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Revisión técnica" }]} />
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 text-balance font-display text-seccion font-bold leading-tight tracking-[-0.015em] text-ink">
            Revisión técnica: centros autorizados
            <Ayuda titulo="¿Qué dicen los avisos?">
              <span className="block">
                <b className="font-semibold">Días sin transmitir:</b> los días en que el centro no le envió al MTC los resultados de sus inspecciones,
                como lo publica el MTC.
              </span>
              <span className="mt-1 block">
                <b className="font-semibold">Sanción:</b> el monto que el MTC le registra al centro en esa misma lista.
              </span>
              <span className="mt-1 block">
                <b className="font-semibold">Líneas:</b> la liviana es para autos y camionetas; la pesada, para buses y camiones; la mixta, para ambos; la
                menor, para motos y mototaxis.
              </span>
            </Ayuda>
          </h1>
          <p className="mt-1 text-dato text-inkSoft">
            <b className="font-semibold tabular-nums text-ink">{numero(filtrados.length)}</b> {filtrados.length === 1 ? "centro" : "centros"}
            {region ? ` en ${nombreLugar(region)}` : " en el Perú"}
            {conAviso > 0 ? `, ${numero(conAviso)} con un aviso del MTC` : ""}.
          </p>
          <form action={ruta} method="get" className="mt-4 flex flex-col gap-2 rounded-2xl border border-line bg-paper p-3 sm:flex-row">
            <label className="sr-only" htmlFor="region">
              Región
            </label>
            <select id="region" name="region" defaultValue={region} className="h-11 rounded-xl border border-line bg-paper px-3 text-dato text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25 sm:w-56">
              <option value="">Todo el Perú</option>
              {DEPARTAMENTOS.filter((x) => porRegion.has(x)).map((x) => (
                <option key={x} value={x}>
                  {nombreLugar(x)} ({porRegion.get(x)})
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="q">
              Buscar por nombre o distrito
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Nombre o distrito"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25"
            />
            <button type="submit" className={claseAccion("primario", "min-h-11")}>
              <Search size={16} aria-hidden /> Buscar
            </button>
          </form>
        </div>
        <aside className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <p className="text-cuerpo font-bold text-ink">¿Tu auto pasó la revisión?</p>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">{consultaPlaca.devuelve} La consulta del MTC pide captcha.</p>
          <a href={consultaPlaca.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario", "mt-3 min-h-11 w-full")}>
            Consultar por placa en el MTC <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </aside>
      </div>

      {lista.length ? (
        <ul id="resultados" className="mt-6 grid scroll-mt-24 grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3">
          {lista.map((c, i) => (
            <li key={`${c.razonSocial}-${c.distrito}-${i}`} className="min-w-0">
              <Casilla c={c} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-paper px-5 py-6 text-dato text-inkSoft">
          Ningún centro con esa búsqueda{region ? ` en ${nombreLugar(region)}` : ""}. Prueba con otro distrito o con todo el Perú.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <FuenteFecha nombre={d.fuente} url={d.url} al={d.generadoAl} />
        {paginas > 1 && <Paginas pagina={pagina} paginas={paginas} total={filtrados.length} tamano={POR_PAGINA} nombre={filtrados.length === 1 ? "centro" : "centros"} href={href} />}
      </div>
    </div>
  );
}
