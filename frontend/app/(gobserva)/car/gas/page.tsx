import type { Metadata } from "next";
import { Cylinder, Fuel, ShieldCheck } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Migas } from "@/components/patrones/Migas";
import { Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { ListaLocales } from "@/components/car/ListaLocales";
import { Recorrido } from "@/components/car/Recorrido";
import { DEPENDIENTES, dondeDe, filtrar, filtrosDeUrl, filtrosLugar, paramsDe, type Local, type Params } from "@/components/car/directorio";
import { BarraFiltros, ProveedorFiltros, Resultados, type FiltroBarra } from "@/components/salud/filtros/BarraFiltros";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { CabeceraLista } from "@/components/salud/portada/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { numero } from "@/lib/gobserva-salud";
import { datosCar } from "@/lib/car-datos";

type Fuente = { nombre: string; url: string; generadoAl: string | null };
type Datos = { fuentes: Record<"talleres" | "certificadoras" | "cilindros", Fuente>; talleres: Local[]; certificadoras: Local[]; cilindros: Local[] };

const URL_CERTIFICADORAS = "https://www.gob.pe/12141-conocer-las-entidades-certificadoras-de-gnv-a-nivel-nacional";
const NOMBRE_GAS: Record<string, string> = { GNV: "Gas natural (GNV)", GLP: "Gas licuado (GLP)" };

export function generateMetadata({ searchParams }: { searchParams?: Params }): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = !!(f.region || f.q || f.tipo);
  return {
    title: f.region ? `Auto a gas (GNV y GLP): talleres y certificadoras ${dondeDe(f)}` : "Auto a gas (GNV y GLP): talleres, certificadoras y cilindros",
    description:
      "Los talleres de conversión a GNV y a GLP, las entidades certificadoras que inspeccionan cada año los autos a gas y los centros que revisan los cilindros, autorizados por el MTC.",
    alternates: { canonical: urlCanonica("car", "/gas") },
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

const SECCIONES = ["talleres", "certificadoras", "cilindros"] as const;

/** El gas de un local como pastillas («Gas natural (GNV)», «Gas licuado (GLP)»). */
function Gases({ l }: { l: Local }) {
  if (!l.tipos?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Para qué gas está autorizado">
      {l.tipos.map((t) => (
        <li key={t} className="inline-flex items-center gap-1 rounded-md bg-granate-50 px-1.5 py-0.5 font-semibold text-ink">
          <Fuel size={12} aria-hidden className="text-granate" /> {NOMBRE_GAS[t] ?? t}
        </li>
      ))}
    </ul>
  );
}

/**
 * Auto a gas (Gobserva Car, 2026-11-22): convertir un auto a GNV o GLP y mantenerlo en regla, en cuatro pasos que se
 * deslizan, y los locales autorizados por el MTC (talleres de conversión, entidades certificadoras y centros de revisión de
 * cilindros, de sus listas en Excel sin captcha: scripts/car/mtc.py) en pestañas, con la barra de filtros de Salud y el
 * tipo de gas. Lo de la inspección anual y el chip, de gob.pe (orientación 12141), leído el 22-11-2026.
 */
export default async function Gas({ searchParams }: { searchParams?: Params }) {
  // Las listas del MTC, que la fuente mtc_car vuelve a bajar cada lunes (lib/car-datos.ts).
  const D = (await datosCar("gas")) as Datos;
  const base = baseProducto("car");
  const ruta = rutaEn(base, "/gas");
  const f = filtrosDeUrl(searchParams);
  const activa = (SECCIONES as readonly string[]).includes(f.seccion ?? "") ? f.seccion! : "talleres";
  const listas = { talleres: filtrar(D.talleres, f), certificadoras: filtrar(D.certificadoras, f), cilindros: filtrar(D.cilindros, f) };
  const params = paramsDe(f);
  const url = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, ...extra }).toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const hrefDe = (clave: string) => (n: number) => url({ ...(clave !== "talleres" ? { seccion: clave } : {}), ...(n > 1 ? { pagina: String(n) } : {}) });
  const aPestana = (clave: string) => `${url(clave !== "talleres" ? { seccion: clave } : {})}#pestanas`;
  const ico = (I: typeof Fuel) => <I size={15} aria-hidden />;
  const regionesCilindros = [...new Set(D.cilindros.map((c) => c.departamento).filter(Boolean))].map((x) => nombreLugar(x)).join(" y ");
  const porTipo = (t: string) => [...D.talleres, ...D.certificadoras].filter((l) => l.tipos?.includes(t)).length;

  const filtros: FiltroBarra[] = [
    ...filtrosLugar([D.talleres, D.certificadoras, D.cilindros], f),
    {
      tipo: "uno",
      clave: "tipo",
      etiqueta: "Qué gas",
      valor: f.tipo,
      opciones: [
        { valor: "GNV", nombre: NOMBRE_GAS.GNV, n: porTipo("GNV") },
        { valor: "GLP", nombre: NOMBRE_GAS.GLP, n: porTipo("GLP") },
      ],
    },
  ];

  const pestanas: Pestana[] = [
    {
      clave: "talleres",
      etiqueta: "Talleres de conversión",
      icono: ico(Fuel),
      conteo: listas.talleres.length,
      contenido: (
        <ListaLocales
          clave="talleres"
          lista={listas.talleres}
          f={f}
          activa={activa === "talleres"}
          href={hrefDe("talleres")}
          quitarFiltros={ruta}
          sprite="surtidor"
          nombre={["taller de conversión", "talleres de conversión"]}
          intro="Los talleres que el MTC autoriza para instalar el sistema de gas en un auto. Cada uno está autorizado para GNV, para GLP o para los dos."
          fuente={D.fuentes.talleres}
          detalle={(l) => <Gases l={l} />}
        />
      ),
    },
    {
      clave: "certificadoras",
      etiqueta: "Certificadoras",
      icono: ico(ShieldCheck),
      conteo: listas.certificadoras.length,
      contenido: (
        <ListaLocales
          clave="certificadoras"
          lista={listas.certificadoras}
          f={f}
          activa={activa === "certificadoras"}
          href={hrefDe("certificadoras")}
          quitarFiltros={`${ruta}?seccion=certificadoras`}
          sprite="escudoCheck"
          nombre={["entidad certificadora", "entidades certificadoras"]}
          intro="Inspeccionan los autos a gas y te dan el certificado. Para el GNV, la inspección es anual."
          fuente={D.fuentes.certificadoras}
          detalle={(l) => <Gases l={l} />}
        />
      ),
    },
    {
      clave: "cilindros",
      etiqueta: "Revisión de cilindros",
      icono: ico(Cylinder),
      conteo: listas.cilindros.length,
      contenido: (
        <ListaLocales
          clave="cilindros"
          lista={listas.cilindros}
          f={f}
          activa={activa === "cilindros"}
          href={hrefDe("cilindros")}
          quitarFiltros={`${ruta}?seccion=cilindros`}
          sprite="cilindro"
          nombre={["centro de revisión de cilindros", "centros de revisión de cilindros"]}
          intro={`Revisan el cilindro de gas cada cierto tiempo. Hay ${numero(D.cilindros.length)} autorizados en el país, todos en ${regionesCilindros}.`}
          fuente={D.fuentes.cilindros}
        />
      ),
    },
  ];

  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Auto a gas" }]} />

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <CabeceraLista
          figura="surtidor"
          titulo="Auto a gas: GNV y GLP"
          resumen={
            <>
              <span>
                Quién puede convertir tu auto, quién lo inspecciona cada año y quién revisa el cilindro:{" "}
                <b className="font-semibold tabular-nums text-ink">{numero(D.talleres.length + D.certificadoras.length + D.cilindros.length)}</b> locales
                autorizados por el MTC.
              </span>
              <Ayuda titulo="¿GNV o GLP?">
                <span className="block">
                  <b className="font-semibold">GNV:</b> gas natural vehicular.
                </span>
                <span className="mt-1 block">
                  <b className="font-semibold">GLP:</b> gas licuado de petróleo.
                </span>
                <span className="mt-1 block">Cada uno tiene sus propios talleres y certificadoras autorizados: fíjate en el gas de cada casilla.</span>
              </Ayuda>
            </>
          }
        />
        <aside className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <p className="flex items-center gap-2 text-cuerpo font-bold text-ink">
            <ShieldCheck size={18} aria-hidden className="shrink-0 text-granate" /> Antes de convertir
          </p>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">
            Pide el número de resolución del taller y búscalo aquí: cada casilla trae la resolución con la que el MTC lo autorizó.
          </p>
        </aside>
      </div>

      <section aria-labelledby="pasos-t" className="mt-8">
        <h2 id="pasos-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Tu auto a gas, en regla
        </h2>
        <Recorrido
          etiqueta="Pasos para tener un auto a gas en regla"
          className="mt-4"
          pasos={[
            {
              titulo: "Conviértelo en un taller autorizado",
              sprite: "surtidor",
              texto: "Que esté autorizado por el MTC para el gas que vas a usar: GNV o GLP.",
              accion: { href: aPestana("talleres"), etiqueta: "Ver talleres" },
            },
            {
              titulo: "Pasa la inspección",
              sprite: "escudoCheck",
              texto: "Una entidad certificadora revisa el sistema de gas y te da el certificado. En el GNV, además, instala el chip con los datos del auto.",
              accion: { href: aPestana("certificadoras"), etiqueta: "Ver certificadoras" },
            },
            {
              titulo: "Vuelve cada año",
              sprite: "iconoCalendario",
              texto: "En el GNV la inspección es anual: el chip vale un año y, si no la pasas, se bloquea.",
              accion: { href: URL_CERTIFICADORAS, etiqueta: "Lo que dice gob.pe", externo: true },
            },
            {
              titulo: "Revisa el cilindro",
              sprite: "cilindro",
              texto: `El cilindro tiene su propia revisión periódica, en un centro autorizado. Hoy hay ${numero(D.cilindros.length)}, en ${regionesCilindros}.`,
              accion: { href: aPestana("cilindros"), etiqueta: "Ver centros de cilindros" },
            },
          ]}
        />
      </section>

      <section id="pestanas" aria-labelledby="locales-t" className="mt-10 scroll-mt-20">
        <h2 id="locales-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Los locales autorizados {dondeDe(f)}
        </h2>
        <ProveedorFiltros ruta={ruta} params={params} dependientes={DEPENDIENTES} conservar={["seccion"]}>
          <BarraFiltros className="mt-3" busqueda={{ clave: "q", valor: f.q || null, ejemplo: "Nombre, distrito o calle" }} filtros={filtros} />
          <Resultados clave={JSON.stringify(params)} className="mt-5">
            <Pestanas pestanas={pestanas} activa={activa} etiqueta="Locales autorizados para el gas vehicular" fija className="[&>div:first-child]:top-16" />
          </Resultados>
        </ProveedorFiltros>
      </section>
    </div>
  );
}
