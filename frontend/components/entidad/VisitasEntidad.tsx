import { Building2, CloudOff, DoorOpen, Handshake, Landmark, ListOrdered, Users } from "lucide-react";
import { Indicadores, type Indicador } from "@/components/listado";
import { AyudaTermino, Pestanas, type Pestana } from "@/components/patrones";
import { PieFuentes } from "./PieFuentes";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { fechaConAnio, numero, porcentaje } from "@/lib/formato";
import { uno } from "@/lib/utils";
import { P_VISITAS, getVisitasEntidad, type ListaVisitas } from "@/lib/visitas";
import { ResumenVisitas } from "./visitas/ResumenVisitas";
import { ListaAreasVisita, ListaEmpresasVisita, ListaOrganizacionesVisita, ListaParientesVisita, ListaTodasVisitas } from "./visitas/ListasVisitas";

type Busqueda = Record<string, string | string[] | undefined> | undefined;

/**
 * La pestaña «Visitas» de una entidad (fase 2.3 del plan del 2026-10-27; rediseño del 2026-11-18). El dueño del producto:
 * «mucho scroll, varias tablas… no tiene sentido» (6,6 pantallas en escritorio y 10,7 en el celular en EsSalud: cinco
 * tablas apiladas, cada una con su buscador y su paginador). Ahora, una cosa a la vez:
 *
 *   1. Las cifras (franja): cuántas visitas, cuántas empresas ganaron algo después y cuántas por primera vez, familiares.
 *   2. Cómo la visitan (una tarjeta): las visitas por mes y cómo se reparten (quién, a quien decide, fuera del horario).
 *   3. Subpestañas (`?vv=`), una por lista y cada una con su número: «Ganaron algo después» (lo más importante, primero),
 *      «Quiénes la visitan», «A qué oficinas», «Familiares de funcionarios» y «Todas las visitas». Sólo se ve la elegida.
 *      Cada lista va entera, paginada en el servidor, con su búsqueda y sus filtros en la URL (visitas/ListasVisitas.tsx).
 *
 * Server component: las cifras del resumen (GET /visitas/entidad/:ruc) y cada lista con su página (…/lista).
 */
export async function VisitasEntidad({ ruc, sp }: { ruc: string; sp?: Busqueda }) {
  const d = await getVisitasEntidad(ruc);
  if (!d) {
    return (
      <VacioEnLinea variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos leer sus visitas ahora. Vuelve a intentarlo en un momento.
      </VacioEnLinea>
    );
  }
  if (!d.total || !d.resumen) {
    return (
      <VacioEnLinea variante="compacta" icono={<DoorOpen size={16} />}>
        No tenemos visitas registradas de esta entidad. El registro de la PCM no se puede consultar de forma automática: cargamos
        sus reportes publicados y el registro del Congreso.
      </VacioEnLinea>
    );
  }
  const r = d.resumen;
  const emp = d.empresas;
  const t = d.totales;
  const enlace = (vv: ListaVisitas, extra: Record<string, string> = {}) =>
    `/entidad/${ruc}?${new URLSearchParams({ seccion: "visitas", [P_VISITAS.sub]: vv, ...extra })}`;

  const cifras: Indicador[] = [
    {
      valor: numero(d.total),
      etiqueta: d.total === 1 ? "visita registrada" : "visitas registradas",
      contexto: d.desde && d.hasta ? `del ${fechaConAnio(d.desde)} al ${fechaConAnio(d.hasta)}` : undefined,
      ayuda: <AyudaTermino clave="registro-visitas" />,
      href: enlace("visitas"),
    },
    ...(emp
      ? [
          {
            valor: numero(emp.ganaron),
            etiqueta: emp.ganaron === 1 ? "empresa ganó algo después" : "empresas ganaron algo después",
            contexto: `de ${numero(emp.empresas)} cuya gente la visitó`,
            href: enlace("empresas"),
          },
          {
            valor: numero(emp.primeraVez),
            etiqueta: "le vendieron por primera vez",
            contexto: "nunca le habían vendido antes de la visita",
            icono: <Handshake size={15} strokeWidth={1.9} aria-hidden />,
            tono: emp.primeraVez > 0 ? ("media" as const) : ("neutro" as const),
            href: enlace("empresas", { [P_VISITAS.empresas.antes]: "no" }),
          },
        ]
      : [
          {
            valor: numero(r.privadas),
            etiqueta: "de empresas y organizaciones privadas",
            contexto: `${porcentaje((r.privadas / d.total) * 100)} del total`,
            href: enlace("visitas", { [P_VISITAS.visitas.tipo]: "privada" }),
          },
        ]),
    r.parientes > 0
      ? {
          valor: numero(r.parientes),
          etiqueta: r.parientes === 1 ? "visita de un familiar de un funcionario" : "visitas de familiares de funcionarios",
          contexto: "declarados en su DJI; no se dice quiénes",
          ayuda: <AyudaTermino clave="dji" />,
          href: enlace("parientes"),
        }
      : {
          valor: numero(r.visitantes),
          etiqueta: r.visitantes === 1 ? "persona la visitó" : "personas distintas la visitaron",
          contexto: `en ${numero(d.total)} visitas`,
          icono: <Users size={15} strokeWidth={1.9} aria-hidden />,
        },
  ];

  // Las listas, cada una con su número. La primera es la de lo que importa (las empresas que ganaron algo después); sin
  // ese cruce (una base sin la migración 203), quiénes la visitan. Familiares, sólo si los hay.
  const pestanas: Pestana[] = [
    ...(emp
      ? [{ clave: "empresas", etiqueta: "Ganaron algo después", conteo: emp.ganaron, icono: <Handshake size={15} aria-hidden />, contenido: <ListaEmpresasVisita ruc={ruc} sp={sp} /> }]
      : []),
    { clave: "organizaciones", etiqueta: "Quiénes la visitan", conteo: t?.organizaciones ?? null, icono: <Building2 size={15} aria-hidden />, contenido: <ListaOrganizacionesVisita ruc={ruc} sp={sp} /> },
    { clave: "areas", etiqueta: "A qué oficinas", conteo: t?.areas ?? null, icono: <Landmark size={15} aria-hidden />, contenido: <ListaAreasVisita ruc={ruc} sp={sp} /> },
    ...(r.parientes > 0
      ? [{ clave: "parientes", etiqueta: "Familiares de funcionarios", conteo: r.parientes, icono: <Users size={15} aria-hidden />, contenido: <ListaParientesVisita ruc={ruc} sp={sp} /> }]
      : []),
    { clave: "visitas", etiqueta: "Todas las visitas", conteo: d.total, icono: <ListOrdered size={15} aria-hidden />, contenido: <ListaTodasVisitas ruc={ruc} sp={sp} parientes={r.parientes > 0} /> },
  ];
  const pedida = uno(sp?.[P_VISITAS.sub]);
  const activa = pestanas.some((p) => p.clave === pedida) ? pedida! : pestanas[0].clave;

  return (
    <div className="space-y-5">
      <Indicadores items={cifras} />
      <ResumenVisitas d={d} />
      <Pestanas param={P_VISITAS.sub} variante="segunda" etiqueta="Listas de sus visitas" activa={activa} pestanas={pestanas} />
      <PieFuentes fuente="El registro de visitas de cada entidad" enlaces={d.fuentes ?? []} />
    </div>
  );
}
