import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, Building2, Calculator, ChevronDown, Crown, ListTree, ShoppingCart, Stamp, UserRound, Workflow } from "lucide-react";
import { Ayuda, AyudaTermino, EstadoVacio, Nota, Pestanas, Seccion, type Pestana } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { conTildes } from "@/lib/tildes";
import { mes } from "@/lib/planilla";
import { getOrganigrama, nombreOficina, type NodoOrganigrama } from "@/lib/organigrama";
import { avisoVisitas } from "@/lib/fuentes";
import { OrganigramaMapa } from "./OrganigramaMapa";
import { TablaOficinas, type OficinaFila } from "./TablaOficinas";
import { PieFuentes } from "./PieFuentes";

/**
 * La pestaña «Organización» de una entidad (Organización 2.0, fase 1 del plan del 2026-10-27): sus oficinas según su
 * planilla, las jefaturas que declaran sus funcionarios en la DJI, la estructura que fija la ley para su tipo de entidad
 * y su ROF si está leído, con las siglas de la planilla leídas y de quién depende cada oficina y por qué. Primero las que
 * pesan en una compra (la titular, la que aprueba las contrataciones, quién compra, quién paga, quién arma el
 * presupuesto); después el mapa mental (o la tabla plegable, en el celular) y la lista completa con su buscador. Antes la
 * pestaña sólo agrupaba las oficinas de la planilla por su nombre, sin árbol, y una planilla de puras siglas («GRPPAT»,
 * «ORADM») quedaba en «otras áreas» y la gobernación «sin jefatura». Server component.
 */
const CLAVE: { funcion: NodoOrganigrama["funcion"]; que: string }[] = [
  { funcion: "compras", que: "Quién compra" },
  { funcion: "finanzas", que: "Quién paga" },
  { funcion: "presupuesto", que: "Quién arma el presupuesto" },
];

/** El ícono de cada papel en una compra. */
const ICONO_FUNCION: Partial<Record<NodoOrganigrama["funcion"], ReactNode>> = {
  compras: <ShoppingCart size={17} />,
  finanzas: <Banknote size={17} />,
  presupuesto: <Calculator size={17} />,
};
/** Las unidades con RUC propio a la vista; las demás, plegadas (en un gobierno regional son treinta y tantas). */
const UNIDADES_A_LA_VISTA = 9;

export async function OrganizacionEntidad({ ruc, ruta, entidad, vista }: { ruc: string; ruta: string; entidad: string; vista?: string }) {
  const o = await getOrganigrama(ruc);
  if (!o) {
    return <EstadoVacio compacto titulo="No pudimos leer su organización">Prueba de nuevo en unos minutos.</EstadoVacio>;
  }
  const reales = o.nodos.filter((n) => !n.grupo);
  if (!reales.some((n) => n.enDatos)) {
    return (
      <EstadoVacio compacto titulo="Sus datos no dicen cómo se organiza">
        Su planilla no trae la oficina de cada persona y sus funcionarios no declaran cargos de jefatura en la DJI.
        {o.plantilla ? " La ley pide para ella la estructura de abajo." : ""}
      </EstadoVacio>
    );
  }
  const enPlanilla = (n: NodoOrganigrama) => (n.dependencias[0] ? `${ruta}?seccion=planilla&lofi=${encodeURIComponent(n.dependencias[0])}` : undefined);
  const titular = reales.find((n) => n.rol === "titular");
  const aga = reales.find((n) => n.rol === "aga");
  const claves = CLAVE.map((c) => ({ ...c, ofis: reales.filter((n) => n.funcion === c.funcion && n.enDatos).sort((a, b) => a.nivel - b.nivel || b.personas - a.personas) }))
    .filter((c) => c.ofis.length > 0);
  const r = o.resumen;
  const indicadores: Indicador[] = [
    { valor: numero(r.oficinas), etiqueta: r.oficinas === 1 ? "oficina" : "oficinas", contexto: "en su planilla, la DJI de sus jefaturas o su ROF" },
    { valor: numero(r.personas), etiqueta: "personas", contexto: o.mes ? `con su oficina escrita, planilla de ${mes(o.mes)}` : "con su oficina escrita" },
    { valor: numero(r.jefaturas), etiqueta: r.jefaturas === 1 ? "jefatura" : "jefaturas", contexto: "de la planilla y de las declaraciones juradas" },
    ...(r.siglas
      ? [{ valor: `${numero(r.siglasExpandidas)} de ${numero(r.siglas)}`, etiqueta: "siglas leídas", contexto: "la planilla escribe muchas oficinas sólo con su sigla" }]
      : [{ valor: solesCompacto(r.planilla), etiqueta: "al mes en sueldos", contexto: "sin los montos con un posible error de carga" }]),
  ];
  // Cada papel en una compra, con su ícono: antes un rótulo en mayúsculas encima de la lista («LA TITULAR»), sin forma.
  const tarjeta = (clave: string, titulo: string, icono: ReactNode, ayuda: ReactNode, ofis: NodoOrganigrama[], vacio: string) => (
    <div key={clave} className="flex flex-col rounded-2xl border border-line bg-paper">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-granate-50 text-granate ring-1 ring-granate/25">
          {icono}
        </span>
        <h4 className="min-w-0 flex-1 font-display text-bloque font-bold leading-tight text-ink">{titulo}</h4>
        {ayuda}
      </div>
      <ul className="flex-1 divide-y divide-line/70">
        {ofis.length === 0 && <li className="px-4 py-3 text-meta text-mute">{vacio}</li>}
        {/* recorte: las tres de más nivel y gente; todas están en el mapa y en la lista («y N oficinas más») */}
        {ofis.slice(0, 3).map((x) => {
          const href = enPlanilla(x);
          const jefe = x.jefes[0];
          const cuerpo = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-dato font-semibold leading-snug text-ink group-hover:text-granate">{nombreOficina(x)}</span>
                <span className="mt-0.5 flex items-start gap-1.5 text-meta leading-snug text-inkSoft">
                  <UserRound size={13} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                  <span className="min-w-0">{jefe ? `${jefe.nombre}${jefe.cargo ? `, ${tituloNatural(conTildes(jefe.cargo))}` : ""}` : "Sin jefatura en sus datos"}</span>
                </span>
                {x.conSenales > 0 && (
                  <span className="mt-1.5 inline-flex">
                    <span className="pill border-crimson/30 bg-crimson-soft font-semibold text-crimsonTexto">{plural(x.conSenales, "con señales", "con señales")}</span>
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                {x.enDatos ? (
                  <>
                    <span className="block font-display text-bloque font-bold leading-none tabular-nums text-ink">{numero(x.personas)}</span>
                    <span className="mt-0.5 block text-rotulo text-mute">{x.personas === 1 ? "persona" : "personas"}</span>
                  </>
                ) : (
                  <span className="pill border-line bg-paperSoft text-inkSoft">Sólo en la ley</span>
                )}
              </span>
            </>
          );
          return (
            <li key={x.id}>
              {href ? (
                <Link href={href} prefetch={false} className="group flex items-start gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft">
                  {cuerpo}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">{cuerpo}</div>
              )}
            </li>
          );
        })}
      </ul>
      {ofis.length > 3 && <p className="border-t border-line px-4 py-2.5 text-meta text-mute">{`y ${plural(ofis.length - 3, "oficina más", "oficinas más")} en el mapa y en la lista`}</p>}
    </div>
  );

  const porId = new Map(o.nodos.map((n) => [n.id, n]));
  // Las unidades con su propio RUC van aparte (el gobierno entero): su gente es de su propia planilla.
  const unidades = reales.filter((n) => n.ruc).sort((a, b) => b.personas - a.personas);
  // «Todas sus oficinas» se arma en el navegador (TablaOficinas): aquí, sólo lo que la tabla muestra, busca y ordena.
  const oficinas: OficinaFila[] = reales.filter((n) => n.enDatos && !n.ruc).map((x) => {
    const padre = x.padre ? porId.get(x.padre) : undefined;
    const j = x.jefes[0];
    return {
      id: x.id,
      nombre: nombreOficina(x),
      sigla: x.sigla,
      funcion: x.funcion,
      nivel: x.nivel,
      jefe: j ? { nombre: j.nombre, cargo: j.cargo ? tituloNatural(conTildes(j.cargo)) : null, dji: j.fuente === "dji" } : null,
      padre: padre ? nombreOficina(padre) : null,
      arista: x.arista?.tipo ?? null,
      personas: x.personas,
      cas: x.cas,
      conSenales: x.conSenales,
      altas: x.altas,
      planilla: x.planilla,
      href: enPlanilla(x) ?? null,
      cargos: x.jefes.map((jj) => jj.cargo ?? "").join(" "),
    };
  });
  const rof = reales.flatMap((n) => n.evidencias).find((e) => e.tipo === "rof" && e.url);

  const tope = Math.max(1, ...unidades.map((u) => u.personas));
  const unidad = (u: NodoOrganigrama) => (
    <li key={u.id}>
      <Link
        href={`/entidad/${u.ruc}?seccion=organizacion`}
        prefetch={false}
        className="gs-mira group flex h-full items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 transition-colors duration-rapido hover:border-granate/40"
      >
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paperDeep text-inkSoft">
          <Building2 size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-dato font-semibold leading-snug text-ink group-hover:text-granate">{nombreOficina(u)}</span>
          {u.personas ? (
            <span className="mt-1.5 flex items-center gap-2">
              <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep">
                <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(3, Math.round((100 * u.personas) / tope))}%` }} />
              </span>
              <span className="shrink-0 text-meta tabular-nums text-inkSoft">
                <b className="font-semibold text-ink">{numero(u.personas)}</b> {u.personas === 1 ? "persona" : "personas"}
              </span>
            </span>
          ) : (
            <span className="mt-1 block text-meta text-mute">Sin planilla cargada</span>
          )}
        </span>
      </Link>
    </li>
  );
  const visibles = unidades.slice(0, UNIDADES_A_LA_VISTA);
  const otras = unidades.slice(UNIDADES_A_LA_VISTA);
  const ministerio = o.plantilla?.id === "TPL-MIN";

  // Cuatro vistas en subpestañas (2026-11-23, el usuario: «secciones que son solo texto sin fondo o forma»): antes iban
  // apiladas, cada título suelto sobre el fondo, y la pestaña medía 9,400 px en el celular.
  const vistas: Pestana[] = [
    {
      clave: "decide",
      etiqueta: "Quién decide",
      icono: <Stamp size={15} aria-hidden />,
      contenido: (
        <div className="space-y-3">
          {/* Quién manda arriba (una oficina cada una) y, debajo, quién compra, paga y arma el presupuesto. */}
          <div className="grid gap-3 md:grid-cols-2">
            {tarjeta("titular", "La titular", <Crown size={17} />, <AyudaTermino clave="titular" />, titular ? [titular] : [], "Su tipo de entidad no está en la estructura que fija la ley")}
            {tarjeta("aga", "Aprueba las contrataciones", <Stamp size={17} />, <AyudaTermino clave="aga" />, aga ? [aga] : [], "La ley de su tipo de entidad no la nombra")}
          </div>
          {claves.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {claves.map((c) => tarjeta(c.funcion, c.que, ICONO_FUNCION[c.funcion] ?? <Building2 size={17} />, null, c.ofis, ""))}
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "mapa",
      etiqueta: "Mapa",
      icono: <Workflow size={15} aria-hidden />,
      contenido: (
        <Seccion
          titulo="Cómo se organiza"
          ayuda={
            <Ayuda titulo="¿De dónde sale este mapa?">
              <span className="block">
                Cada oficina sale de su planilla del Portal de Transparencia, de los cargos de jefatura que declaran sus funcionarios
                en la DJI de la Contraloría, de la estructura que la ley pide para su tipo de entidad y, si está leído, de su ROF.
              </span>
              <span className="mt-2 block">
                De quién depende cada una se dice con su prueba: su ROF, la ley o la propia planilla (línea continua). Si ningún dato
                lo dice, se infiere por su nombre o su función, o se deja aparte (línea punteada).
              </span>
            </Ayuda>
          }
        >
          <OrganigramaMapa org={o} ruta={ruta} entidad={entidad} />
        </Seccion>
      ),
    },
    {
      clave: "oficinas",
      etiqueta: "Todas sus oficinas",
      icono: <ListTree size={15} aria-hidden />,
      conteo: oficinas.length,
      contenido: (
        <Seccion titulo="Todas sus oficinas" descripcion="Toca una para ver a su gente en la planilla.">
          <TablaOficinas oficinas={oficinas} />
        </Seccion>
      ),
    },
    ...(unidades.length > 0
      ? [
          {
            clave: "gobierno",
            etiqueta: ministerio ? "Sus organismos" : "El gobierno entero",
            icono: <Building2 size={15} aria-hidden />,
            conteo: unidades.length,
            contenido: (
              <Seccion
                titulo={ministerio ? "Sus organismos adscritos" : "El gobierno entero"}
                descripcion="Las unidades con su propio RUC, de la que tiene más gente a la que menos."
                ayuda={
                  <Ayuda titulo="¿Qué son estas unidades?">
                    {ministerio
                      ? "Los organismos públicos adscritos al ministerio: tienen su propio RUC, su propia organización y su propia planilla, pero responden a su sector."
                      : "Las unidades del gobierno regional con su propio RUC (salud, educación, hospitales, UGEL, programas): cada una tiene su planilla y su organización. En el mapa cuelgan de la gerencia a la que la LOGR le asigna su tema, inferido."}
                  </Ayuda>
                }
              >
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visibles.map(unidad)}</ul>
                {otras.length > 0 && (
                  <details className="group/unidades mt-2">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-dato font-semibold text-ink hover:border-granate/50 hover:text-granate [&::-webkit-details-marker]:hidden">
                      <span className="group-open/unidades:hidden">Ver {otras.length === 1 ? "la otra" : `las otras ${numero(otras.length)}`}</span>
                      <span className="hidden group-open/unidades:inline">Ver menos</span>
                      <ChevronDown size={16} aria-hidden className="transition-transform duration-rapido group-open/unidades:rotate-180" />
                    </summary>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{otras.map(unidad)}</ul>
                  </details>
                )}
              </Seccion>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <Indicadores items={indicadores} franja />
      <Pestanas param="ov" variante="segunda" etiqueta="Vistas de su organización" activa={vista} pestanas={vistas} />
      <Nota>
        {`De quién depende cada oficina lo dicen su ROF, la ley o su planilla; ${r.inferidas ? `${plural(r.inferidas, "dependencia se infiere", "dependencias se infieren")} por el nombre o la función, o no tienen dato, y van con línea punteada` : "ninguna se infiere"}. `}
        {r.siglas ? `De las ${numero(r.siglas)} siglas de su planilla, ${numero(r.siglasExpandidas)} se leyeron con los cargos de sus funcionarios, la ley o los nombres que usan otras entidades. ` : ""}
        {r.visitas ? `Las visitas se cuentan por el área visitada (${numero(r.visitas - r.visitasSinOficina)} de ${numero(r.visitas)} calzan con una oficina). ${avisoVisitas(o.visitasHasta) ?? ""} ` : ""}
        Del personal, un apellido tapado.
      </Nota>
      <PieFuentes
        fuente={`Portal de Transparencia Estándar (personal${o.mes ? `, ${mes(o.mes)}` : ""}), DJI de la Contraloría${o.plantilla ? `, ${o.plantilla.ley?.texto ?? "la ley"}` : ""}${rof ? " y su ROF" : ""}`}
        enlaces={[
          o.enlaces.planilla ? { texto: "Su personal en el Portal de Transparencia", href: o.enlaces.planilla } : null,
          o.enlaces.dji ? { texto: "Sus declaraciones juradas (Contraloría)", href: o.enlaces.dji } : null,
          o.plantilla?.ley?.url ? { texto: o.plantilla.ley.texto, href: o.plantilla.ley.url } : null,
          rof?.url ? { texto: "Su ROF o designación en El Peruano", href: rof.url } : null,
        ]}
      />
    </div>
  );
}
