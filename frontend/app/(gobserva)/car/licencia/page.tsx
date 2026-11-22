import type { Metadata } from "next";
import { GraduationCap, IdCard, Stethoscope, ClipboardList } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { Pestanas, type Pestana } from "@/components/patrones/Pestanas";
import { EnlaceOficial, ListaLocales } from "@/components/car/ListaLocales";
import { Recorrido } from "@/components/car/Recorrido";
import { DEPENDIENTES, dondeDe, filtrar, filtrosDeUrl, filtrosLugar, paramsDe, type Local, type Params } from "@/components/car/directorio";
import { BarraFiltros, ProveedorFiltros, Resultados } from "@/components/salud/filtros/BarraFiltros";
import { CabeceraLista } from "@/components/salud/portada/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { numero } from "@/lib/gobserva-salud";
import datos from "@/data/car/licencia.json";

type Fuente = { nombre: string; url: string; generadoAl: string | null };
const D = datos as { fuentes: Record<"medicos" | "evaluacion" | "escuelas", Fuente>; medicos: Local[]; evaluacion: Local[]; escuelas: Local[] };

const URL_SIMULADOR = "https://sierdgtt.mtc.gob.pe/";
const URL_TRAMITE = "https://www.gob.pe/23030-obtener-primera-licencia-de-conducir-a-1";
const URL_ESCUELA = "https://www.gob.pe/195-llevar-curso-de-conductores-para-obtener-licencia-de-conducir-brevete";
const URL_RECORD = "https://licencias.mtc.gob.pe/";

export function generateMetadata({ searchParams }: { searchParams?: Params }): Metadata {
  const f = filtrosDeUrl(searchParams);
  const filtrado = !!(f.region || f.q);
  return {
    title: f.region ? `Licencia de conducir: centros médicos, de evaluación y escuelas ${dondeDe(f)}` : "Licencia de conducir: centros médicos, de evaluación y escuelas",
    description:
      "Dónde pasar el examen médico, rendir los exámenes de reglas y de manejo y llevar el curso de una escuela de conductores: los locales autorizados por el MTC, por región y distrito.",
    alternates: { canonical: urlCanonica("car", "/licencia") },
    robots: filtrado ? { index: false, follow: true } : undefined,
  };
}

const SECCIONES = ["medicos", "evaluacion", "escuelas"] as const;

/**
 * Licencia de conducir (Gobserva Car, 2026-11-22, «continúa y mejora»): la primera licencia A-I en cuatro pasos que se
 * deslizan, y los locales autorizados por el MTC (centros médicos, centros de evaluación y escuelas de conductores, de
 * sus listas en Excel sin captcha: scripts/car/mtc.py) en pestañas, con la misma barra de filtros de Salud (región,
 * provincia, distrito). Los requisitos vienen de gob.pe (trámite 23030 y servicio 195), leídos el 22-11-2026.
 */
export default function Licencia({ searchParams }: { searchParams?: Params }) {
  const base = baseProducto("car");
  const ruta = rutaEn(base, "/licencia");
  const f = filtrosDeUrl(searchParams);
  const activa = (SECCIONES as readonly string[]).includes(f.seccion ?? "") ? f.seccion! : "medicos";
  const listas = { medicos: filtrar(D.medicos, f), evaluacion: filtrar(D.evaluacion, f), escuelas: filtrar(D.escuelas, f) };
  const total = D.medicos.length + D.evaluacion.length + D.escuelas.length;
  const params = paramsDe(f);
  const url = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, ...extra }).toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const hrefDe = (clave: string) => (n: number) => url({ ...(clave !== "medicos" ? { seccion: clave } : {}), ...(n > 1 ? { pagina: String(n) } : {}) });
  const aPestana = (clave: string) => `${url(clave !== "medicos" ? { seccion: clave } : {})}#pestanas`;
  const ico = (I: typeof GraduationCap) => <I size={15} aria-hidden />;

  const pestanas: Pestana[] = [
    {
      clave: "medicos",
      etiqueta: "Centros médicos",
      icono: ico(Stethoscope),
      conteo: listas.medicos.length,
      contenido: (
        <ListaLocales
          clave="medicos"
          lista={listas.medicos}
          f={f}
          activa={activa === "medicos"}
          href={hrefDe("medicos")}
          quitarFiltros={ruta}
          sprite="lugarConsultorio"
          nombre={["centro médico", "centros médicos"]}
          intro="Donde se pasa el examen médico que pide la licencia. Sólo vale en un centro autorizado por el MTC."
          fuente={D.fuentes.medicos}
        />
      ),
    },
    {
      clave: "evaluacion",
      etiqueta: "Centros de evaluación",
      icono: ico(ClipboardList),
      conteo: listas.evaluacion.length,
      contenido: (
        <ListaLocales
          clave="evaluacion"
          lista={listas.evaluacion}
          f={f}
          activa={activa === "evaluacion"}
          href={hrefDe("evaluacion")}
          quitarFiltros={`${ruta}?seccion=evaluacion`}
          sprite="chequeo"
          nombre={["centro de evaluación", "centros de evaluación"]}
          intro="Donde se rinden el examen de reglas de tránsito y el examen de manejo. Casi todos son de la dirección regional de transportes o de una municipalidad."
          fuente={D.fuentes.evaluacion}
        />
      ),
    },
    {
      clave: "escuelas",
      etiqueta: "Escuelas de conductores",
      icono: ico(GraduationCap),
      conteo: listas.escuelas.length,
      contenido: (
        <ListaLocales
          clave="escuelas"
          lista={listas.escuelas}
          f={f}
          activa={activa === "escuelas"}
          href={hrefDe("escuelas")}
          quitarFiltros={`${ruta}?seccion=escuelas`}
          sprite="volante"
          nombre={["escuela de conductores", "escuelas de conductores"]}
          intro="El curso es opcional para la A-I y obligatorio para las licencias profesionales. La escuela tiene que estar en la región de la dirección de tu DNI; el precio lo pone cada escuela."
          fuente={D.fuentes.escuelas}
        />
      ),
    },
  ];

  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Licencia de conducir" }]} />

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <CabeceraLista
          figura="volante"
          titulo="Licencia de conducir"
          resumen={
            <span>
              Dónde pasar el examen médico, rendir los exámenes y llevar el curso: <b className="font-semibold tabular-nums text-ink">{numero(total)}</b> locales
              autorizados por el MTC, en todo el Perú.
            </span>
          }
        />
        <aside className="min-w-0 rounded-2xl border border-line bg-paper p-4">
          <p className="flex items-center gap-2 text-cuerpo font-bold text-ink">
            <IdCard size={18} aria-hidden className="shrink-0 text-granate" /> ¿Ya tienes licencia?
          </p>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">
            Tu récord de conductor, con tus infracciones y tus puntos, está en el sistema de licencias del MTC. Pide tu DNI: aquí no lo pedimos.
          </p>
          <EnlaceOficial href={URL_RECORD} className="mt-3 w-full">
            Ver mi récord en el MTC
          </EnlaceOficial>
        </aside>
      </div>

      <section aria-labelledby="pasos-t" className="mt-8">
        <h2 id="pasos-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Tu primera licencia (A-I), paso a paso
        </h2>
        <p className="mt-1 max-w-[70ch] text-dato text-inkSoft">La A-I es la de los autos particulares. Para manejar cualquier vehículo de cuatro ruedas o más, es la primera que hay que tener.</p>
        <Recorrido
          etiqueta="Pasos para sacar la licencia A-I"
          className="mt-4"
          pasos={[
            {
              titulo: "Pasa el examen médico",
              sprite: "lugarConsultorio",
              texto: "En un centro médico autorizado por el MTC. Elige uno cerca en la lista de abajo.",
              accion: { href: aPestana("medicos"), etiqueta: "Ver centros médicos" },
            },
            {
              titulo: "Rinde el examen de reglas",
              sprite: "documento",
              texto: "Las reglas de tránsito, en un centro de evaluación. El MTC tiene un simulador gratis para practicar.",
              accion: { href: URL_SIMULADOR, etiqueta: "Practicar en el simulador", externo: true },
            },
            {
              titulo: "Rinde el examen de manejo",
              sprite: "volante",
              texto: "El examen práctico, también en un centro de evaluación autorizado.",
              accion: { href: aPestana("evaluacion"), etiqueta: "Ver centros de evaluación" },
            },
            {
              titulo: "Recibe tu licencia",
              sprite: "carnet",
              texto: "La tramitas en la dirección regional de transportes; en Lima, en el centro de emisión validado por el MTC. La primera A-I dura 10 años.",
              accion: { href: URL_TRAMITE, etiqueta: "El trámite en gob.pe", externo: true },
            },
          ]}
        />
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-paperSoft px-3.5 py-2.5 text-meta leading-relaxed text-inkSoft">
          <GraduationCap size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
          <span>
            <b className="font-semibold text-ink">¿Y la escuela de conductores?</b> Es opcional para la A-I. Si la llevas, su certificado puede reemplazar el
            examen de reglas.{" "}
            <a href={URL_ESCUELA} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
              Lo que dice gob.pe
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </span>
        </p>
      </section>

      <section id="pestanas" aria-labelledby="locales-t" className="mt-10 scroll-mt-20">
        <h2 id="locales-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Los locales autorizados {dondeDe(f)}
        </h2>
        <ProveedorFiltros ruta={ruta} params={params} dependientes={DEPENDIENTES} conservar={["seccion"]}>
          <BarraFiltros className="mt-3" busqueda={{ clave: "q", valor: f.q || null, ejemplo: "Nombre, distrito o calle" }} filtros={filtrosLugar([D.medicos, D.evaluacion, D.escuelas], f)} />
          <Resultados clave={JSON.stringify(params)} className="mt-5">
            <Pestanas pestanas={pestanas} activa={activa} etiqueta="Locales autorizados para la licencia" fija className="[&>div:first-child]:top-16" />
          </Resultados>
        </ProveedorFiltros>
      </section>
    </div>
  );
}
