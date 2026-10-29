import Link from "next/link";
import { Ayuda, AyudaTermino, EstadoVacio, FuenteDato, Nota } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { conTildes } from "@/lib/tildes";
import { mes } from "@/lib/planilla";
import { getOrganigrama, nombreOficina, type NodoOrganigrama } from "@/lib/organigrama";
import { avisoVisitas } from "@/lib/fuentes";
import { OrganigramaMapa } from "./OrganigramaMapa";
import { TablaOficinas, type OficinaFila } from "./TablaOficinas";

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

export async function OrganizacionEntidad({ ruc, ruta, entidad }: { ruc: string; ruta: string; entidad: string }) {
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
  const tarjeta = (titulo: string, ayuda: React.ReactNode, ofis: NodoOrganigrama[], vacio: string) => (
    <div className="tarjeta rounded-2xl border border-line bg-paper p-4">
      <p className="flex items-center gap-1 text-rotulo font-semibold uppercase tracking-wide text-mute">{titulo}{ayuda}</p>
      <ul className="mt-2 divide-y divide-line/70">
        {ofis.length === 0 && <li className="text-meta text-mute">{vacio}</li>}
        {/* recorte: las tres de más nivel y gente; todas están en el mapa y en la lista de abajo («y N oficinas más») */}
        {ofis.slice(0, 3).map((x) => {
          const href = enPlanilla(x);
          const cuerpo = (
            <>
              <span className="block text-meta font-semibold text-ink group-hover:text-granate">{nombreOficina(x)}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">
                <Dato tipo="personas" nombre="La encabeza">
                  {x.jefes[0] ? `${x.jefes[0].nombre}${x.jefes[0].cargo ? `, ${tituloNatural(conTildes(x.jefes[0].cargo))}` : ""}` : "Sin jefatura en sus datos"}
                </Dato>
                {x.enDatos && <Dato tipo="personas" nombre="Personas">{plural(x.personas, "persona", "personas")}</Dato>}
                {!x.enDatos && <Dato tipo="tipo" nombre="Fuente">Sólo en la ley</Dato>}
                {x.conSenales > 0 && <Dato tipo="tipo" nombre="Con señales">{`${numero(x.conSenales)} con señales`}</Dato>}
              </span>
            </>
          );
          return (
            <li key={x.id} className="py-2 first:pt-0 last:pb-0">
              {href ? <Link href={href} prefetch={false} className="group block">{cuerpo}</Link> : <div>{cuerpo}</div>}
            </li>
          );
        })}
        {ofis.length > 3 && <li className="pt-2 text-rotulo text-mute">{`y ${plural(ofis.length - 3, "oficina más", "oficinas más")} en el mapa y en la lista`}</li>}
      </ul>
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

  return (
    <div className="space-y-6">
      <Indicadores items={indicadores} />
      <section aria-labelledby="org-claves" className="space-y-3">
        <h3 id="org-claves" className="font-display text-bloque font-bold text-ink">Quién decide, compra y paga</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {tarjeta("La titular", <AyudaTermino clave="titular" />, titular ? [titular] : [], "Su tipo de entidad no está en la estructura que fija la ley")}
          {tarjeta("Aprueba las contrataciones (AGA)", <AyudaTermino clave="aga" />, aga ? [aga] : [], "La ley de su tipo de entidad no la nombra")}
          {claves.map((c) => (
            <div key={c.funcion} className="contents">{tarjeta(c.que, null, c.ofis, "")}</div>
          ))}
        </div>
      </section>
      <section aria-labelledby="org-mapa" className="space-y-3">
        <div className="flex items-center gap-1">
          <h3 id="org-mapa" className="font-display text-bloque font-bold text-ink">Cómo se organiza</h3>
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
        </div>
        <OrganigramaMapa org={o} ruta={ruta} entidad={entidad} />
      </section>
      {unidades.length > 0 && (
        <section aria-labelledby="org-gobierno" className="space-y-2">
          <div className="flex items-center gap-1">
            <h3 id="org-gobierno" className="font-display text-bloque font-bold text-ink">El gobierno entero</h3>
            <Ayuda titulo="¿Qué son estas unidades?">
              {o.plantilla?.id === "TPL-MIN"
                ? "Los organismos públicos adscritos al ministerio: tienen su propio RUC, su propia organización y su propia planilla, pero responden a su sector."
                : "Las unidades del gobierno regional con su propio RUC (salud, educación, hospitales, UGEL, programas): cada una tiene su planilla y su organización. En el mapa cuelgan de la gerencia a la que la LOGR le asigna su tema, inferido."}
            </Ayuda>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unidades.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/entidad/${u.ruc}?seccion=organizacion`}
                  prefetch={false}
                  className="tarjeta group flex min-h-[56px] flex-col justify-center rounded-xl border border-line bg-paper px-3.5 py-2.5 transition-colors duration-rapido hover:border-granate/40"
                >
                  <span className="text-meta font-semibold text-ink group-hover:text-granate">{nombreOficina(u)}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-rotulo text-inkSoft">
                    <Dato tipo="ruc" nombre="RUC" mono>{u.ruc}</Dato>
                    <Dato tipo="personas" nombre="Personas">{u.personas ? plural(u.personas, "persona", "personas") : "Sin planilla cargada"}</Dato>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="org-todas" className="space-y-2">
        <h3 id="org-todas" className="font-display text-bloque font-bold text-ink">Todas sus oficinas</h3>
        <TablaOficinas oficinas={oficinas} />
        <Nota>
          {`De quién depende cada oficina lo dicen su ROF, la ley o su planilla; ${r.inferidas ? `${plural(r.inferidas, "dependencia se infiere", "dependencias se infieren")} por el nombre o la función, o no tienen dato, y van con línea punteada` : "ninguna se infiere"}. `}
          {r.siglas ? `De las ${numero(r.siglas)} siglas de su planilla, ${numero(r.siglasExpandidas)} se leyeron con los cargos de sus funcionarios, la ley o los nombres que usan otras entidades. ` : ""}
          {r.visitas ? `Las visitas se cuentan por el área visitada (${numero(r.visitas - r.visitasSinOficina)} de ${numero(r.visitas)} calzan con una oficina). ${avisoVisitas(o.visitasHasta) ?? ""} ` : ""}
          Del personal, un apellido tapado.
        </Nota>
        <FuenteDato
          fuente={`Portal de Transparencia Estándar (personal${o.mes ? `, ${mes(o.mes)}` : ""}), DJI de la Contraloría${o.plantilla ? `, ${o.plantilla.ley?.texto ?? "la ley"}` : ""}${rof ? " y su ROF" : ""}`}
          enlaces={[
            o.enlaces.planilla ? { texto: "Su personal en el Portal de Transparencia", href: o.enlaces.planilla } : null,
            o.enlaces.dji ? { texto: "Sus declaraciones juradas (Contraloría)", href: o.enlaces.dji } : null,
            o.plantilla?.ley?.url ? { texto: o.plantilla.ley.texto, href: o.plantilla.ley.url } : null,
            rof?.url ? { texto: "Su ROF o designación en El Peruano", href: rof.url } : null,
          ]}
        />
      </section>
    </div>
  );
}
