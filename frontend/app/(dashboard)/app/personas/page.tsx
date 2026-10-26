import type { Metadata } from "next";
import Link from "next/link";
import { Ayuda, AyudaTermino, CabeceraPestana, EncabezadoPagina, Migas, Pagina, Pestanas } from "@/components/patrones";
import { ListaPlanilla, P_PLANILLA } from "@/components/personas/ListaPlanilla";
import { ListaPlazas, P_PLAZAS } from "@/components/personas/ListaPlazas";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { ListaPersonas } from "@/components/personas/ListaPersonas";
import { REGION_UBIGEO } from "@/components/mapa/region-match";
import type { FiltroSecundario } from "@/components/listado";
import { REGIONES } from "@/lib/peru-data";
import { PARAMS_SOLOS, getPersonas } from "@/lib/personas";
import { getPlanilla, getPlazas } from "@/lib/planilla";

export const metadata: Metadata = { title: "Personas contratadas" };
export const revalidate = 600;

/** Los 25 departamentos con su ubigeo (el filtro de región). */
const DEPARTAMENTOS = REGIONES.map((r) => ({ ubigeo: REGION_UBIGEO[r.id], nombre: r.nombre }))
  .filter((d): d is { ubigeo: string; nombre: string } => !!d.ubigeo)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

/**
 * /app/personas — quién recibe órdenes de servicio del Estado como persona natural (locadores, asesores, choferes…)
 * en todo el país, y lo que otros registros públicos dicen de cada una en cada entidad: candidaturas y aportes al
 * partido que gobernaba, autoridades electas, apellidos de autoridades y funcionarios, órdenes casi todos los meses,
 * pagos muy por encima de lo que la entidad paga por lo mismo, inhabilitaciones. Una fila por persona y entidad.
 * Filtros: región (?dep=, a la vista), entidad (?entidad=, desde su ficha: un chip que se quita), señal, gravedad, tipo
 * de servicio y año.
 *
 * Cada pestaña lleva su conteo (§14.3): el resumen de su alcance (`size=0`, sin filas), el mismo que dicen sus cifras.
 * La de órdenes cuenta contrataciones (lo que lista), las otras dos, personas en planilla y plazas.
 */
export default async function PersonasPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const ruta = "/app/personas";
  const dep = typeof searchParams?.dep === "string" && /^\d{2}$/.test(searchParams.dep) ? searchParams.dep : undefined;
  const entidad = typeof searchParams?.entidad === "string" && /^\d{11}$/.test(searchParams.entidad) ? searchParams.entidad : undefined;
  const con = (nombres: readonly string[]) => nombres.some((k) => typeof searchParams?.[k] === "string");
  const seccion =
    (typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined) ??
    (con(Object.values(P_PLANILLA)) ? "planilla" : con(Object.values(P_PLAZAS)) ? "plazas" : undefined);
  // La región a la vista (era la pregunta de casi todos y estaba detrás de «Filtros»): el mismo nombre en el
  // desplegable y en su chip.
  const region: FiltroSecundario = {
    param: "dep",
    etiqueta: "Región",
    corta: "Región",
    todas: "Todo el Perú",
    opciones: DEPARTAMENTOS.map((d) => ({ valor: d.ubigeo, etiqueta: d.nombre })),
  };
  // Los resúmenes ya están contados por alcance (y en caché): no frenan la página. Sin respuesta, la pestaña va sin número.
  const [ordenes, planilla, plazas] = await Promise.all([
    getPersonas({ dep, entidad, size: 0 }),
    getPlanilla({ dep, entidad, size: 0 }),
    getPlazas({ dep, entidad, size: 0 }),
  ]);
  return (
    <Pagina>
      <Migas
        items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: ruta }]}
        pestanas={{ primera: "ordenes", activa: seccion ?? "ordenes", etiquetas: { planilla: "Planilla", plazas: "Plazas CAS" } }}
      />
      <EncabezadoPagina
        titulo="Personas contratadas"
        bajada="Quién trabaja para el Estado como persona (por órdenes de servicio, en planilla o por concurso CAS) y qué dicen de cada una otros registros públicos."
        ayuda={
          <Ayuda titulo="¿De dónde sale esto?">
            <span className="block">
              Las entidades contratan personas por órdenes de servicio de hasta 8 UIT, sin concurso: asistentes, asesores,
              choferes, profesionales. El OECE (CONOSCE) publica cada orden con el nombre de la persona y lo que se le pagó.
            </span>
            <span className="mt-2 block">
              Vigía cruza a cada persona con el JNE (candidaturas y autoridades electas), la ONPE (aportes), las declaraciones
              juradas de intereses, el Tribunal de Contrataciones (inhabilitados) y el registro de visitas, y compara lo que cobra
              por mes con lo que la misma entidad paga a quienes hacen el mismo tipo de servicio.
            </span>
            <span className="mt-2 block">
              Por privacidad no se muestra el DNI ni el RUC y se tapa un apellido. A quien sólo recibe órdenes de servicio no se le busca por nombre; en la planilla, que es de servidores públicos, sí (por el apellido paterno y los nombres).{" "}
              <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Apareces aquí?</Link>
            </span>
          </Ayuda>
        }
      />
      <Pestanas
        key={seccion ?? "ordenes"}
        etiqueta="Cómo los contrata el Estado"
        activa={seccion}
        pestanas={[
          {
            clave: "ordenes",
            etiqueta: "Por órdenes de servicio",
            conteo: ordenes?.resumen?.filas ?? null,
            contenido: (
              <div className="space-y-4">
                {/* Una ⓘ por cabecera y una línea que no repite la bajada: dice lo que sólo esta pestaña tiene. */}
                <CabeceraPestana ayuda={<AyudaTermino clave="orden-servicio" />}>
                  Locadores, asesores y profesionales que cobran por orden. Una fila por persona y entidad.
                </CabeceraPestana>
                <ListaPersonas alcance={{ dep, entidad }} sp={searchParams} P={PARAMS_SOLOS} ruta={ruta} base={{ dep, entidad }} visiblesExtra={[region]} conIndicadores />
              </div>
            ),
          },
          {
            clave: "planilla",
            etiqueta: "En planilla",
            conteo: planilla?.resumen?.personas ?? null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana ayuda={<AyudaTermino clave="pte" />}>
                  El personal que cada entidad publica en su Portal de Transparencia, con lo que cobra cada mes.
                </CabeceraPestana>
                <ListaPlanilla alcance={{ dep, entidad }} sp={searchParams} ruta={ruta} base={{ dep, entidad, seccion: "planilla" }} visiblesExtra={[region]} />
              </div>
            ),
          },
          {
            clave: "plazas",
            etiqueta: "Plazas CAS",
            conteo: plazas?.resumen?.plazas ?? null,
            contenido: (
              <div className="space-y-4">
                <CabeceraPestana ayuda={<AyudaTermino clave="cas" />}>
                  Las convocatorias publicadas en SERVIR Talento Perú, con lo que piden y lo que pagan.
                </CabeceraPestana>
                <ListaPlazas alcance={{ dep, entidad }} sp={searchParams} ruta={ruta} base={{ dep, entidad, seccion: "plazas" }} visiblesExtra={[region]} />
              </div>
            ),
          },
        ]}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco: dice qué registro público coincide con esta persona, para que
        alguien lo revise. El título, la edad o la experiencia de cada persona no están en datos abiertos.
      </Aviso>
    </Pagina>
  );
}
