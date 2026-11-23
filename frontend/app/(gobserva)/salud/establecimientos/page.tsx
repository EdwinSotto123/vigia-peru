import type { Metadata } from "next";
import { REJILLA_TARJETAS, TarjetaEstablecimiento } from "@/components/salud/lista/TarjetaEstablecimiento";
import Link from "next/link";
import { Info, MapPinned, RotateCw } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { Ayuda } from "@/components/patrones/Ayuda";
import { FuenteFecha } from "@/components/salud/comun";
import { BarraFiltros, ProveedorFiltros, Resultados, type FiltroBarra } from "@/components/salud/filtros/BarraFiltros";
import { URL_RENIPRESS_CONSULTA, URL_SANCIONES } from "@/components/salud/fuentes/urls";
import { FilaEstablecimiento, PLACA_LISTA } from "@/components/salud/lista/FilaEstablecimiento";
import { DEPARTAMENTOS, ORDENES, filtrosDeUrl, filtrosMapa, nombreLugar, nombresRepetidos, paramsApi, qsLista, type FiltrosLista } from "@/components/salud/lista/filtros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { CATEGORIAS_ORDEN, TIPOS_IPRESS, claveTipo, getEstablecimientos, getResumenSalud, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import type { FiltroSeguro } from "@/lib/salud-seguros";

export const dynamic = "force-dynamic";

// 10 por página (2026-11-21: con 25, la lista era un scroll sin fin, sobre todo en el celular).
const POR_PAGINA = 10;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/** Lo que es cada categoría (NTS N.° 021-MINSA/DGSP-V.03), en palabras: va bajo cada opción del filtro. */
const NOMBRE_CATEGORIA: Record<string, string> = {
  "I-1": "Puesto de salud",
  "I-2": "Puesto o consultorio con médico",
  "I-3": "Centro de salud sin internamiento",
  "I-4": "Centro de salud con internamiento",
  "II-1": "Hospital general",
  "II-2": "Hospital general con más especialidades",
  "II-E": "Atención especializada",
  "III-1": "Hospital de alta complejidad",
  "III-2": "Instituto especializado",
  "III-E": "Especializado de alta complejidad",
  SIN: "Servicios de apoyo y otros sin categorizar",
};

/** Cómo se nombra cada seguro en el título de la lista. */
const SEGURO_TITULO: Record<FiltroSeguro, string> = {
  sis: "del MINSA y los gobiernos regionales",
  essalud: "de EsSalud",
  sanidad: "de las Sanidades",
  privado: "privados",
};

/** «Establecimientos de salud de EsSalud en Arequipa que atienden las 24 horas». */
function tituloLista(f: FiltrosLista): string {
  const partes = ["Establecimientos de salud"];
  if (f.seguro) partes.push(SEGURO_TITULO[f.seguro]);
  else if (f.sector) partes.push(f.sector === "publico" ? "públicos" : f.sector === "privado" ? "privados" : "de otro sector");
  if (f.distrito) partes.push(`en ${nombreLugar(f.distrito)}`);
  else if (f.provincia) partes.push(`en ${nombreLugar(f.provincia)}`);
  else if (f.departamento) partes.push(`en ${nombreLugar(f.departamento)}`);
  if (f.h24) partes.push("que atienden las 24 horas");
  if (f.sanciones === "con") partes.push("con sanción firme");
  if (f.estado === "inactivos") partes.push("inactivos");
  return partes.join(" ");
}

export function generateMetadata({ searchParams }: Props): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = Object.values(f).some((v) => v != null);
  return {
    title: tituloLista(f),
    description:
      "Todos los establecimientos de salud del Perú registrados en RENIPRESS (SUSALUD): su categoría, su sector, su estado y si tienen sanciones firmes o denuncias, con su fuente y su fecha. Filtra por departamento, categoría y tipo.",
    alternates: { canonical: urlCanonica("salud", "/establecimientos") },
    // Una combinación de filtros no es una página para el buscador: la lista entera sí.
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

/**
 * /establecimientos de Gobserva Salud: todas las IPRESS de RENIPRESS. 2026-11-22 (el usuario: «hay que ordenar mejor;
 * textos muy grandes; filtros sin forma»): una franja con el título y lo que suma la lista, la barra de filtros con las
 * preguntas de la gente («Dónde», «Qué es», «Del Estado o privado», «Con sanción firme») que se aplican sin recargar y
 * atenúan la lista mientras llega la nueva, y la fuente una vez, al pie. GET /salud/establecimientos (10 min en caché).
 */
export default async function Establecimientos({ searchParams }: Props) {
  const base = baseProducto("salud");
  const f = filtrosDeUrl(searchParams);
  const [primera, r] = await Promise.all([getEstablecimientos(paramsApi(f, POR_PAGINA)), getResumenSalud()]);
  // Un enlace a una página que ya no existe (?pagina=2701): se muestra la última, no «ningún establecimiento».
  const ultima = primera ? Math.max(1, Math.ceil(primera.total / POR_PAGINA)) : 1;
  const d =
    primera && primera.total > 0 && primera.filas.length === 0 && (f.pagina ?? 1) > ultima
      ? (await getEstablecimientos(paramsApi({ ...f, pagina: ultima }, POR_PAGINA))) ?? primera
      : primera;
  const lista = rutaEn(base, "/establecimientos");
  const paginas = d ? Math.min(10000, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const pagina = Math.min(f.pagina ?? 1, paginas);
  const fuentes = r?.fuentes;
  const fac = d?.facetas;
  const repetidos = nombresRepetidos(d?.filas ?? []);
  const n = (xs: { clave: string; n: number }[] | undefined, clave: string) => xs?.find((x) => x.clave === clave)?.n ?? null;

  // Lo que la URL lleva hoy (sin la página): la barra arma la dirección nueva a partir de esto.
  const params = Object.fromEntries(new URLSearchParams(qsLista({ ...f, pagina: undefined }).slice(1)));
  const filtros: FiltroBarra[] = [
    {
      tipo: "uno",
      clave: "departamento",
      etiqueta: "Dónde",
      buscar: true,
      valor: f.departamento,
      opciones: DEPARTAMENTOS.map((dep) => ({ valor: dep, nombre: nombreLugar(dep), n: n(fac?.departamento, dep) })),
    },
    // La provincia sigue a la vista después de elegirla (antes desaparecía), y el distrito (2026-11-22: «debería haber
    // región, distrito»).
    ...(f.departamento && fac && (fac.provincia.length > 1 || f.provincia)
      ? [{
          tipo: "uno" as const,
          clave: "provincia",
          etiqueta: "Provincia",
          buscar: fac.provincia.length > 8,
          valor: f.provincia,
          opciones: fac.provincia.map((p) => ({ valor: p.clave, nombre: nombreLugar(p.clave), n: p.n })),
        }]
      : []),
    ...(f.departamento && fac && ((fac.distrito?.length ?? 0) > 1 || f.distrito)
      ? [{
          tipo: "uno" as const,
          clave: "distrito",
          etiqueta: "Distrito",
          buscar: (fac.distrito?.length ?? 0) > 8,
          valor: f.distrito,
          opciones: (fac.distrito ?? []).map((p) => ({ valor: p.clave, nombre: nombreLugar(p.clave), n: p.n })),
        }]
      : []),
    {
      tipo: "uno",
      clave: "tipo",
      etiqueta: "Qué es",
      valor: f.tipo,
      opciones: TIPOS_IPRESS.map((t) => ({ valor: t.clave, nombre: t.nombre, detalle: t.detalle, n: fac?.tipo.find((x) => claveTipo(x.clave) === t.clave)?.n ?? null })),
    },
    // Con qué seguro atiende (2026-11-22, «útil para una persona de a pie que quiera atenderse»): lo que la gente
    // pregunta, en vez de «Del Estado o privado». Ese filtro sigue para los enlaces viejos que lo traen.
    {
      tipo: "uno",
      clave: "seguro",
      etiqueta: "Con qué seguro",
      valor: f.seguro,
      opciones: [
        { valor: "sis", nombre: "SIS", detalle: "MINSA y gobiernos regionales. Sin seguro, también pagando la cita", n: n(fac?.seguro, "sis") },
        { valor: "essalud", nombre: "EsSalud", detalle: "Para sus asegurados, en el centro que les asignó", n: n(fac?.seguro, "essalud") },
        { valor: "privado", nombre: "Privado o EPS", detalle: "Pagando o con tu seguro: pregunta si tiene convenio", n: n(fac?.seguro, "privado") },
        { valor: "sanidad", nombre: "Sanidades", detalle: "Fuerzas Armadas y Policía, para su personal y familiares", n: n(fac?.seguro, "sanidad") },
      ],
    },
    ...(f.sector
      ? [{
          tipo: "uno" as const,
          clave: "sector",
          etiqueta: "Del Estado o privado",
          valor: f.sector,
          opciones: [
            { valor: "publico", nombre: "Del Estado", detalle: "MINSA, gobiernos regionales, EsSalud, Sanidades", n: n(fac?.sector, "publico") },
            { valor: "privado", nombre: "Privado", n: n(fac?.sector, "privado") },
            { valor: "otro", nombre: "Otro", detalle: "Mixtos y otros", n: n(fac?.sector, "otro") },
          ],
        }]
      : []),
    { tipo: "si", clave: "h24", etiqueta: "Atiende 24 horas", valorSi: "si", activo: !!f.h24 },
    { tipo: "si", clave: "sanciones", etiqueta: "Con sanción firme", valorSi: "con", activo: f.sanciones === "con", tono: "alerta" },
    { tipo: "si", clave: "quirurgico", etiqueta: "Con centro quirúrgico", valorSi: "si", activo: !!f.quirurgico },
    ...(f.internamiento ? [{ tipo: "si" as const, clave: "internamiento", etiqueta: "Con internamiento", valorSi: "si", activo: true }] : []),
    {
      tipo: "varios",
      clave: "categoria",
      etiqueta: "Categoría",
      valor: f.categoria,
      opciones: [...CATEGORIAS_ORDEN, "SIN"].map((c) => ({ valor: c, nombre: c === "SIN" ? "Sin categoría" : c, detalle: NOMBRE_CATEGORIA[c], n: n(fac?.categoria, c) })),
    },
    {
      tipo: "uno",
      clave: "estado",
      etiqueta: "Estado en RENIPRESS",
      vacio: "Activos",
      valor: f.estado,
      opciones: [
        { valor: "todos", nombre: "Activos e inactivos" },
        { valor: "inactivos", nombre: "Sólo inactivos", detalle: "Cierre temporal o definitivo, baja" },
      ],
    },
  ];
  const mapa = `${rutaEn(base, "/mapa")}${qsLista(filtrosMapa(f))}`;

  return (
    <div className="container-page pb-10 pt-4 sm:pb-14 sm:pt-5">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/inicio") }, { etiqueta: "Establecimientos" }]} />
      <ProveedorFiltros ruta={lista} params={params} dependientes={{ departamento: ["provincia", "distrito", "provinciaDe"], provincia: ["distrito"] }}>
        <CabeceraLista
          className="mt-2"
          titulo={tituloLista(f)}
          resumen={
            d && (
              <>
                <span>
                  <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "establecimiento" : "establecimientos"}
                  {d.conSanciones > 0 && (
                    <span className="text-crimsonTexto">
                      , <b className="font-semibold tabular-nums">{numero(d.conSanciones)}</b> con sanción firme
                    </span>
                  )}
                </span>
                <Ayuda titulo="¿De dónde sale esta lista?" etiqueta="De dónde sale esta lista">
                  <span className="block">Del registro de establecimientos de SUSALUD (RENIPRESS) y de su Registro de Sanciones, con su fecha al pie.</span>
                  <span className="mt-1 block">Lo que dice RENIPRESS lo declaró cada establecimiento. La sanción es de la institución, no de sus médicos.</span>
                </Ayuda>
              </>
            )
          }
          acciones={
            <Link href={mapa} className="gs-hunde inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/60 hover:text-granate sm:min-h-10">
              <MapPinned size={16} aria-hidden className="text-granate" />
              <span className="sm:hidden">Mapa</span>
              <span className="hidden sm:inline">Ver en el mapa</span>
            </Link>
          }
        />

        <BarraFiltros
          className="mt-4"
          busqueda={{ clave: "q", valor: f.q, ejemplo: "Nombre, código o distrito" }}
          filtros={filtros}
          orden={{ clave: "orden", porDefecto: "relevancia", valor: f.orden, opciones: ORDENES.map((o) => ({ valor: o.clave, nombre: o.nombre })) }}
        />

        {f.quirurgico && fuentes && (
          <p role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-paperSoft px-3.5 py-2.5 text-meta leading-relaxed text-inkSoft">
            <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            <span>
              El centro quirúrgico sale del detalle de cada establecimiento en RENIPRESS, ya leído en {numero(fuentes.detalle.leidas)} de {numero(fuentes.detalle.total)}.
            </span>
          </p>
        )}

        <Resultados clave={qsLista(f)} className="mt-4">
          {!d ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoError
                texto="No pudimos leer la lista ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
                acciones={
                  <a href={`${lista}${qsLista(f)}`} className={claseAccion("secundario", "min-h-11")}>
                    <RotateCw size={15} aria-hidden /> Volver a intentar
                  </a>
                }
              />
            </div>
          ) : d.filas.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoVacio
                titulo="Ningún establecimiento con estos filtros"
                texto="Quita un filtro o busca con menos palabras (el distrito en vez del nombre exacto). Si buscas a un médico, su habilitación se verifica en el Colegio Médico."
                acciones={
                  <>
                    <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                      Ver todos
                    </Link>
                    <Link href={rutaEn(base, "/medico")} className={claseAccion("secundario", "min-h-11")}>
                      Verificar a un médico
                    </Link>
                  </>
                }
              />
            </div>
          ) : (
            <>
              {/* Casillas, no filas (2026-11-22: «que sea tipo marketplace»). */}
              <ul className={REJILLA_TARJETAS} aria-label="Establecimientos">
                {d.filas.map((x) => (
                  <li key={x.codigo} className="min-w-0">
                    <TarjetaEstablecimiento x={x} base={base} conDireccion={repetidos.has(x.codigo)} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} al={fuentes?.renipressAl} />
                <FuenteFecha nombre="Registro de Sanciones (SUSALUD)" url={URL_SANCIONES} al={fuentes?.sancionesAl} />
              </p>
              {paginas > 1 && (
                <Paginas
                  className="mt-5"
                  pagina={pagina}
                  paginas={paginas}
                  total={d.total}
                  tamano={POR_PAGINA}
                  nombre={d.total === 1 ? "establecimiento" : "establecimientos"}
                  href={(k) => `${lista}${qsLista({ ...f, pagina: k })}`}
                />
              )}
            </>
          )}
        </Resultados>
      </ProveedorFiltros>
    </div>
  );
}
