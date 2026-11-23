import type { Metadata } from "next";
import { AlertTriangle, Clock3, Gavel } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Migas } from "@/components/patrones/Migas";
import { CONSULTAS } from "@/components/car/consultas";
import { CasillaLocal, REJILLA_LOCALES } from "@/components/car/CasillaLocal";
import { EnlaceOficial, POR_PAGINA } from "@/components/car/ListaLocales";
import { DEPENDIENTES, dondeDe, filtrar, filtrosDeUrl, filtrosLugar, paginar, paramsDe, type Local, type Params } from "@/components/car/directorio";
import { BarraFiltros, ProveedorFiltros, Resultados, type FiltroBarra } from "@/components/salud/filtros/BarraFiltros";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { CabeceraLista } from "@/components/salud/portada/Piezas";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import Link from "next/link";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { numero } from "@/lib/gobserva-salud";
import { datosCar } from "@/lib/car-datos";

export function generateMetadata({ searchParams }: { searchParams?: Params }): Metadata {
  const f = filtrosDeUrl(searchParams);
  return {
    title: f.region ? `Revisión técnica: centros autorizados ${dondeDe(f)}` : "Revisión técnica: centros autorizados",
    description: "Los centros de inspección técnica vehicular (CITV) autorizados por el MTC, con su horario, sus líneas, su resolución y si tienen días sin transmitir o una sanción.",
    alternates: { canonical: urlCanonica("car", "/revision-tecnica") },
    robots: f.region || f.q ? { index: false, follow: true } : undefined,
  };
}

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

type CentroLocal = Centro & Local;
const DIAS = ["LU", "MA", "MI", "JU", "VI", "SA", "DO"];
const NOMBRE_DIA: Record<string, string> = { LU: "Lun", MA: "Mar", MI: "Mié", JU: "Jue", VI: "Vie", SA: "Sáb", DO: "Dom" };
const conAviso = (c: Centro) => (c.diasSinTransmitir ?? 0) > 0 || !!c.sancion;

/** «LU: 08:00-17:00 | SA: 08:00-13:00 | VI: …» → los días en orden, con su horario («Lun 08:00–17:00»). */
function horario(h: string | null): { dia: string; horas: string }[] {
  if (!h) return [];
  const out = [...h.matchAll(/\b(LU|MA|MI|JU|VI|SA|DO)\s*:\s*([0-9:]+\s*-\s*[0-9:]+)/g)].map((m) => ({ dia: m[1], horas: m[2].replace(/\s*-\s*/, "–") }));
  return out.sort((a, b) => DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia));
}

/** «MIXTO (1),MENOR (1)» → los tipos de línea, con cuántas de cada uno. La clave es la del MTC («MIXTO»). */
function lineas(t: string | null): { clave: string; tipo: string; n: number }[] {
  if (!t) return [];
  return [...t.matchAll(/([A-ZÁÉÍÓÚÑ ]+)\s*\((\d+)\)/g)].map((m) => {
    const clave = m[1].trim();
    const tipo = clave.toLowerCase();
    return { clave, tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/o$/, "a"), n: Number(m[2]) };
  });
}

/** Lo propio de un CITV dentro de su casilla: los avisos del MTC, las líneas y el horario. */
function Detalle({ c }: { c: Centro }) {
  const dias = horario(c.horario);
  const ls = lineas(c.tipoLineas);
  return (
    <>
      {conAviso(c) && (
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
      )}
      {ls.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Líneas de inspección">
          {ls.map((l) => (
            <li key={l.clave} className="rounded-md bg-granate-50 px-1.5 py-0.5 font-semibold text-ink">
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
    </>
  );
}

const TIPOS_LINEA = ["MIXTO", "COMBINADO", "MENOR", "LIVIANO", "PESADO"];

/**
 * Los centros de revisión técnica autorizados por el MTC (Gobserva Car, 2026-11-22): la lista que publica el MTC (Excel sin
 * captcha; la fuente mtc_car la vuelve a bajar cada lunes: lib/car-datos.ts) en casillas, con la barra de filtros de Salud (región, provincia,
 * distrito, tipo de línea, con aviso). Al lado, la consulta oficial de la revisión técnica de una placa.
 */
export default async function RevisionTecnica({ searchParams }: { searchParams?: Params }) {
  const d = (await datosCar("citv")) as { url: string; generadoAl: string | null; fuente: string; centros: Centro[] };
  const CENTROS: CentroLocal[] = d.centros.map((c) => ({ ...c, nombre: c.razonSocial }));
  const base = baseProducto("car");
  const ruta = rutaEn(base, "/revision-tecnica");
  const f = filtrosDeUrl(searchParams);
  const sp = (k: string) => {
    const v = searchParams?.[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim().toUpperCase();
  };
  const linea = TIPOS_LINEA.includes(sp("linea")) ? sp("linea") : null;
  const aviso = sp("aviso") === "SI";
  const enLugar = filtrar(CENTROS, f).filter((c) => !aviso || conAviso(c));
  const filtrados = enLugar.filter((c) => !linea || lineas(c.tipoLineas).some((l) => l.clave === linea));
  const { items, pagina, paginas } = paginar(filtrados, f.pagina, POR_PAGINA);
  const params = { ...paramsDe(f), ...(linea ? { linea: linea.toLowerCase() } : {}), ...(aviso ? { aviso: "si" } : {}) };
  const href = (n: number) => {
    const qs = new URLSearchParams({ ...params, ...(n > 1 ? { pagina: String(n) } : {}) }).toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const avisos = filtrados.filter(conAviso).length;
  // Cuántos hay de cada línea con los demás filtros puestos.
  const porLinea = (t: string) => enLugar.filter((c) => lineas(c.tipoLineas).some((l) => l.clave === t)).length;
  const consultaPlaca = CONSULTAS.find((c) => c.clave === "revision")!;

  const filtros: FiltroBarra[] = [
    ...filtrosLugar([CENTROS], f),
    {
      tipo: "uno",
      clave: "linea",
      etiqueta: "Línea",
      valor: linea?.toLowerCase() ?? null,
      opciones: TIPOS_LINEA.map((t) => ({
        valor: t.toLowerCase(),
        nombre: `Línea ${t.toLowerCase().replace(/o$/, "a")}`,
        detalle: t === "MENOR" ? "Motos y mototaxis" : t === "LIVIANO" ? "Autos y camionetas" : t === "PESADO" ? "Buses y camiones" : undefined,
        n: porLinea(t),
      })),
    },
    { tipo: "si", clave: "aviso", etiqueta: "Con aviso del MTC", valorSi: "si", activo: aviso, tono: "alerta" },
  ];

  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Revisión técnica" }]} />
      <ProveedorFiltros ruta={ruta} params={params} dependientes={DEPENDIENTES}>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <CabeceraLista
            figura="chequeo"
            titulo={f.region ? `Revisión técnica ${dondeDe(f)}` : "Revisión técnica: centros autorizados"}
            resumen={
              <>
                <span>
                  <b className="font-semibold tabular-nums text-ink">{numero(filtrados.length)}</b> {filtrados.length === 1 ? "centro autorizado" : "centros autorizados"}{" "}
                  {dondeDe(f)}
                  {avisos > 0 && (
                    <>
                      , <b className="font-semibold tabular-nums text-amberTexto">{numero(avisos)}</b> con un aviso del MTC
                    </>
                  )}
                  .
                </span>
                <Ayuda titulo="¿Qué dicen los avisos y las líneas?">
                  <span className="block">
                    <b className="font-semibold">Días sin transmitir:</b> los días en que el centro no le envió al MTC los resultados de sus inspecciones,
                    como lo publica el MTC.
                  </span>
                  <span className="mt-1 block">
                    <b className="font-semibold">Sanción:</b> el monto que el MTC le registra al centro en esa misma lista.
                  </span>
                  <span className="mt-1 block">
                    <b className="font-semibold">Líneas:</b> la liviana es para autos y camionetas; la pesada, para buses y camiones; la menor, para motos y
                    mototaxis. La mixta y la combinada atienden más de un tipo: pregunta en el centro.
                  </span>
                </Ayuda>
              </>
            }
          />
          <aside className="min-w-0 rounded-2xl border border-line bg-paper p-4">
            <p className="text-cuerpo font-bold text-ink">¿Tu auto pasó la revisión?</p>
            <p className="mt-1 text-meta leading-relaxed text-inkSoft">{consultaPlaca.devuelve} La consulta del MTC pide captcha.</p>
            <EnlaceOficial href={consultaPlaca.url} className="mt-3 w-full">
              Consultar por placa en el MTC
            </EnlaceOficial>
          </aside>
        </div>

        <BarraFiltros className="mt-5" busqueda={{ clave: "q", valor: f.q || null, ejemplo: "Nombre, distrito o calle" }} filtros={filtros} />

        <Resultados clave={JSON.stringify(params)} className="mt-5">
          {items.length ? (
            <ul id="resultados" className={`scroll-mt-24 ${REJILLA_LOCALES}`}>
              {items.map((c, i) => (
                <li key={`${c.razonSocial}-${c.distrito}-${i}`} className="min-w-0">
                  <CasillaLocal l={c} sprite="auto">
                    <Detalle c={c} />
                  </CasillaLocal>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-paper">
              <EstadoVacio
                titulo={`Ningún centro ${dondeDe(f)} con esos filtros`}
                texto="Prueba con otro distrito, con la provincia o con toda la región."
                acciones={
                  <Link href={ruta} className={claseAccion("secundario", "min-h-11")}>
                    Ver todo el Perú
                  </Link>
                }
              />
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {filtrados.length > 0 && (
              <Paginas pagina={pagina} paginas={paginas} total={filtrados.length} tamano={POR_PAGINA} nombre={filtrados.length === 1 ? "centro" : "centros"} href={href} />
            )}
            <FuenteFecha nombre={d.fuente} url={d.url} al={d.generadoAl} />
          </div>
        </Resultados>
      </ProveedorFiltros>
    </div>
  );
}
