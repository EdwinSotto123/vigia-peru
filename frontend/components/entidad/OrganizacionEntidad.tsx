import Link from "next/link";
import { EstadoVacio, FuenteDato, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { FUNCION_OFICINA, NIVEL_OFICINA, getOrganizacion, mes, type OficinaEntidad } from "@/lib/planilla";

/**
 * La pestaña «Organización» de una entidad (fase 3 del plan del 2026-10-27): sus oficinas según la planilla del último mes
 * publicado, con quién las encabeza, cuánta gente tienen, cuánto suman sus sueldos y cuántas personas con señales. Primero
 * las que pesan en una compra (quién decide, quién compra, quién paga, quién arma el presupuesto); después todas, con su
 * buscador y sus filtros. La planilla no dice de quién depende cada oficina: se agrupan por nivel y por función, sin
 * inventar un árbol. Cada oficina abre la planilla filtrada por ella. Server component.
 */
const CLAVE: OficinaEntidad["funcion"][] = ["alta_direccion", "compras", "finanzas", "presupuesto"];
const QUE_HACE: Partial<Record<OficinaEntidad["funcion"], string>> = {
  alta_direccion: "Quién decide",
  compras: "Quién compra",
  finanzas: "Quién paga",
  presupuesto: "Quién arma el presupuesto",
};

export async function OrganizacionEntidad({ ruc, ruta }: { ruc: string; ruta: string }) {
  const o = await getOrganizacion(ruc);
  if (!o) {
    return <EstadoVacio compacto titulo="No pudimos leer su organización">Prueba de nuevo en unos minutos.</EstadoVacio>;
  }
  if (!o.oficinas.length) {
    return (
      <EstadoVacio compacto titulo="Su planilla no dice en qué oficina trabaja cada persona">
        La entidad publica su personal en el Portal de Transparencia sin la dependencia de cada uno: no hay oficinas que mostrar.
      </EstadoVacio>
    );
  }
  const enPlanilla = (oficina: string) => `${ruta}?seccion=planilla&lofi=${encodeURIComponent(oficina)}`;
  const claves = CLAVE.map((f) => ({ f, ofis: o.oficinas.filter((x) => x.funcion === f).sort((a, b) => a.nivel - b.nivel || b.personas - a.personas) }))
    .filter((x) => x.ofis.length > 0);
  const indicadores: Indicador[] = [
    { valor: numero(o.resumen.oficinas), etiqueta: o.resumen.oficinas === 1 ? "oficina" : "oficinas", contexto: o.mes ? `en su planilla de ${mes(o.mes)}` : "en su planilla" },
    { valor: numero(o.resumen.personas), etiqueta: "personas", contexto: "con su oficina escrita" },
    { valor: numero(o.resumen.jefaturas), etiqueta: o.resumen.jefaturas === 1 ? "jefatura" : "jefaturas", contexto: "jefes, directores, gerentes y coordinadores" },
    { valor: solesCompacto(o.resumen.planilla), etiqueta: "al mes en sueldos", contexto: "sin los montos con un posible error de carga" },
  ];
  const columnas: Columna[] = [
    { clave: "oficina", titulo: "Oficina", ancho: "minmax(0,1.4fr)" },
    { clave: "jefe", titulo: "Quién la encabeza", corto: "Jefatura", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo" },
    { clave: "personas", titulo: "Personas", ancho: "6.5rem", alinear: "der" },
    { clave: "planilla", titulo: "Sueldos al mes", corto: "Sueldos", ancho: "7.5rem", alinear: "der", desde: "lg" },
    { clave: "senales", titulo: "Con señales", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = o.oficinas.map((x) => ({
    id: x.oficina,
    href: enPlanilla(x.oficina),
    buscable: `${x.oficina} ${x.jefes.map((j) => j.cargo ?? "").join(" ")}`,
    valores: { funcion: x.funcion, nivel: String(x.nivel) },
    claves: { personas: x.personas, planilla: x.planilla, senales: x.conSenales, nombre: x.oficina },
    celdas: {
      oficina: (
        <CeldaPrincipal
          titulo={tituloNatural(x.oficina)}
          meta={[
            <Dato key="f" tipo="tipo" nombre="Función">{FUNCION_OFICINA[x.funcion]}</Dato>,
            <Dato key="n" tipo="dependencia" nombre="Nivel">{NIVEL_OFICINA[x.nivel] ?? "Otra área"}</Dato>,
          ]}
        />
      ),
      jefe: x.jefes.length ? (
        <span className="block min-w-0 text-meta">
          <span className="block truncate font-semibold text-ink">{x.jefes[0].nombre}</span>
          <span className="block truncate text-inkSoft">{x.jefes[0].cargo ? tituloNatural(x.jefes[0].cargo) : "Jefatura"}</span>
        </span>
      ) : (
        <span className="text-meta text-mute">Sin jefatura en la planilla</span>
      ),
      personas: <CeldaNumero sub={x.cas ? `${numero(x.cas)} CAS` : undefined}>{numero(x.personas)}</CeldaNumero>,
      planilla: <CeldaNumero>{solesCompacto(x.planilla)}</CeldaNumero>,
      senales: x.conSenales ? (
        <span className="inline-flex items-center justify-end gap-1.5 text-meta tabular-nums text-ink">
          {numero(x.conSenales)}
          {x.altas > 0 && <Severidad bandera="alta" />}
        </span>
      ) : (
        <span className="text-meta text-mute">Ninguna</span>
      ),
    },
  }));
  return (
    <div className="space-y-6">
      <Indicadores items={indicadores} />
      {claves.length > 0 && (
        <section aria-labelledby="org-claves" className="space-y-3">
          <h3 id="org-claves" className="font-display text-bloque font-bold text-ink">Quién decide, compra y paga</h3>
          <p className="max-w-prose text-meta text-inkSoft">
            Las oficinas que pesan en una contratación, por su nombre: la alta dirección, la de compras y logística, la de
            administración y finanzas, y la de presupuesto. Toca una para ver a su gente en la planilla.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {claves.map(({ f, ofis }) => (
              <div key={f} className="tarjeta rounded-2xl border border-line bg-paper p-4">
                <p className="text-rotulo font-semibold uppercase tracking-wide text-mute">{QUE_HACE[f]}</p>
                <p className="mt-0.5 font-display text-dato font-bold text-ink">{FUNCION_OFICINA[f]}</p>
                <ul className="mt-2 divide-y divide-line/70">
                  {/* recorte: las cuatro de más nivel y personas; las demás, en la lista de abajo con su filtro */}
                  {ofis.slice(0, 4).map((x) => (
                    <li key={x.oficina} className="py-2 first:pt-0 last:pb-0">
                      <Link href={enPlanilla(x.oficina)} className="group block">
                        <span className="block text-meta font-semibold text-ink group-hover:text-granate">{tituloNatural(x.oficina)}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">
                          {x.jefes[0] ? (
                            <Dato tipo="personas" nombre="La encabeza">{`${x.jefes[0].nombre}${x.jefes[0].cargo ? `, ${tituloNatural(x.jefes[0].cargo)}` : ""}`}</Dato>
                          ) : (
                            <Dato tipo="personas" nombre="La encabeza">Sin jefatura en la planilla</Dato>
                          )}
                          <Dato tipo="personas" nombre="Personas">{plural(x.personas, "persona", "personas")}</Dato>
                          {x.conSenales > 0 && <Dato tipo="tipo" nombre="Con señales">{`${numero(x.conSenales)} con señales`}</Dato>}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {ofis.length > 4 && <li className="pt-2 text-rotulo text-mute">{`y ${plural(ofis.length - 4, "oficina más", "oficinas más")} en la lista de abajo`}</li>}
                </ul>
              </div>
            ))}
          </div>
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
          buscar={{ placeholder: "Buscar una oficina o un cargo…", etiqueta: "Buscar entre las oficinas" }}
          filtros={[
            {
              clave: "funcion", etiqueta: "Función", corta: "Función",
              opciones: (Object.keys(FUNCION_OFICINA) as OficinaEntidad["funcion"][])
                .filter((f) => o.oficinas.some((x) => x.funcion === f))
                .map((f) => ({ valor: f, etiqueta: FUNCION_OFICINA[f] })),
            },
            {
              clave: "nivel", etiqueta: "Nivel", corta: "Nivel",
              opciones: [1, 2, 3, 4].filter((n) => o.oficinas.some((x) => x.nivel === n)).map((n) => ({ valor: String(n), etiqueta: NIVEL_OFICINA[n] })),
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
          La planilla dice en qué oficina trabaja cada persona, pero no de quién depende cada oficina: por eso se agrupan por su
          nivel y su función según su nombre, sin dibujar un árbol que no está en los datos. Del personal, un apellido tapado.
        </Nota>
        <FuenteDato fuente={`Portal de Transparencia Estándar, personal de la entidad${o.mes ? ` (${mes(o.mes)})` : ""}`} />
      </section>
    </div>
  );
}
