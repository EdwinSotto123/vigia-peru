import Link from "next/link";
import { Ayuda, AyudaTermino, EstadoVacio, FuenteDato, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { conTildes } from "@/lib/tildes";
import { FUNCION_OFICINA, NIVEL_OFICINA, mes } from "@/lib/planilla";
import { ARISTA, getOrganigrama, nombreOficina, type NodoOrganigrama } from "@/lib/organigrama";
import { avisoVisitas } from "@/lib/fuentes";
import { OrganigramaMapa } from "./OrganigramaMapa";

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

  const columnas: Columna[] = [
    { clave: "oficina", titulo: "Oficina", ancho: "minmax(0,1.4fr)" },
    { clave: "jefe", titulo: "Quién la encabeza", corto: "Jefatura", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo" },
    { clave: "depende", titulo: "Depende de", ancho: "minmax(0,1fr)", desde: "lg", apilar: "con-rotulo" },
    { clave: "personas", titulo: "Personas", ancho: "6.5rem", alinear: "der" },
    { clave: "senales", titulo: "Con señales", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const porId = new Map(o.nodos.map((n) => [n.id, n]));
  // Las unidades con su propio RUC van aparte (el gobierno entero): su gente es de su propia planilla.
  const unidades = reales.filter((n) => n.ruc).sort((a, b) => b.personas - a.personas);
  const filas: FilaFiltrable[] = reales.filter((n) => n.enDatos && !n.ruc).map((x) => {
    const padre = x.padre ? porId.get(x.padre) : undefined;
    return {
      id: x.id,
      href: enPlanilla(x),
      buscable: `${nombreOficina(x)} ${x.sigla ?? ""} ${x.jefes.map((j) => j.cargo ?? "").join(" ")}`,
      valores: { funcion: x.funcion, nivel: String(x.nivel), arista: x.arista?.tipo ?? "raiz" },
      claves: { personas: x.personas, planilla: x.planilla, senales: x.conSenales, nombre: nombreOficina(x) },
      celdas: {
        oficina: (
          <CeldaPrincipal
            titulo={nombreOficina(x)}
            meta={[
              x.sigla && <Dato key="s" tipo="codigo" nombre="Sigla en la planilla" mono>{x.sigla}</Dato>,
              <Dato key="f" tipo="tipo" nombre="Función">{FUNCION_OFICINA[x.funcion]}</Dato>,
              <Dato key="n" tipo="dependencia" nombre="Nivel">{NIVEL_OFICINA[x.nivel] ?? "Otra área"}</Dato>,
            ]}
          />
        ),
        jefe: x.jefes.length ? (
          <span className="block min-w-0 text-meta">
            <span className="block truncate font-semibold text-ink">{x.jefes[0].nombre}</span>
            <span className="block truncate text-inkSoft">
              {x.jefes[0].cargo ? tituloNatural(conTildes(x.jefes[0].cargo)) : "Jefatura"}
              {x.jefes[0].fuente === "dji" ? ", según su DJI" : ""}
            </span>
          </span>
        ) : (
          <span className="text-meta text-mute">Sin jefatura en sus datos</span>
        ),
        depende: padre ? (
          <span className="block min-w-0 text-meta">
            <span className="block truncate text-ink">{nombreOficina(padre)}</span>
            {x.arista && <span className={x.arista.tipo === "funcion" || x.arista.tipo === "nivel" ? "text-mute" : "text-inkSoft"}>{ARISTA[x.arista.tipo].corto}</span>}
          </span>
        ) : (
          <span className="text-meta text-mute">De la entidad</span>
        ),
        personas: <CeldaNumero sub={x.cas ? `${numero(x.cas)} CAS` : undefined}>{numero(x.personas)}</CeldaNumero>,
        senales: x.conSenales ? (
          <span className="inline-flex items-center justify-end gap-1.5 text-meta tabular-nums text-ink">
            {numero(x.conSenales)}
            {x.altas > 0 && <Severidad bandera="alta" />}
          </span>
        ) : (
          <span className="text-meta text-mute">Ninguna</span>
        ),
      },
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
        <TablaFiltrable
          columnas={columnas}
          filas={filas}
          etiqueta="Oficinas de la entidad (toca una para ver a su gente)"
          tam={20}
          nombre="oficinas"
          buscar={{ placeholder: "Buscar una oficina, una sigla o un cargo…", etiqueta: "Buscar entre las oficinas" }}
          filtros={[
            {
              clave: "funcion", etiqueta: "Función", corta: "Función",
              opciones: (Object.keys(FUNCION_OFICINA) as NodoOrganigrama["funcion"][])
                .filter((f) => reales.some((x) => x.enDatos && x.funcion === f))
                .map((f) => ({ valor: f, etiqueta: FUNCION_OFICINA[f] })),
            },
            {
              clave: "nivel", etiqueta: "Nivel", corta: "Nivel",
              opciones: [1, 2, 3, 4].filter((n) => reales.some((x) => x.enDatos && x.nivel === n)).map((n) => ({ valor: String(n), etiqueta: NIVEL_OFICINA[n] })),
            },
            {
              clave: "arista", etiqueta: "De quién depende, según", corta: "Dependencia",
              opciones: (["rof", "ley", "planilla", "funcion", "nivel"] as const)
                .filter((t) => reales.some((x) => x.enDatos && x.arista?.tipo === t))
                .map((t) => ({ valor: t, etiqueta: ARISTA[t].corto })),
            },
          ]}
          ordenes={[
            { valor: "personas", etiqueta: "Más personas", clave: "personas", dir: "desc" },
            { valor: "planilla", etiqueta: "Más sueldos", clave: "planilla", dir: "desc" },
            { valor: "senales", etiqueta: "Más personas con señales", clave: "senales", dir: "desc" },
            { valor: "nombre", etiqueta: "Por nombre", clave: "nombre", dir: "asc" },
          ]}
        />
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
