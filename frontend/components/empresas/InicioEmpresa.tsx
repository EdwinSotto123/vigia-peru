import Link from "next/link";
import { AyudaTermino, DatosClave, FuenteDato, type DatoClave } from "@/components/patrones";
import { fecha, listaY, numero, oracion, plural, solesCompacto } from "@/lib/formato";
import { CONSULTA_RUC_SUNAT, fichaRnp } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import {
  rutaEmpresa,
  type ClienteEmpresa,
  type ContratoEmpresa,
  type FacetasContratos,
  type FacetasPostulaciones,
  type FichaEmpresa,
  type Pagina,
  type PostulacionEmpresa,
} from "@/lib/empresas";
import { P_CONTRATOS, P_POSTULACIONES } from "./SeccionesEmpresa";

/**
 * Los bloques del Inicio de una empresa que resumen sus listas (pedido del usuario, 2026-10-22: «faltan más cosas»):
 * cómo gana (por tipo de proceso), sus principales clientes, quién le gana más veces y dónde vende; y sus datos (SUNAT y
 * RNP), la columna lateral de la ficha. Cada fila abre la lista ya filtrada. Barras en CSS, cada una con su número
 * escrito (nunca sólo la barra). Server components: esperan las mismas promesas que las pestañas.
 */

interface Item {
  clave: string;
  titulo: string;
  valor: string;
  sub?: string;
  /** De 0 a 1: el largo de la barra. */
  parte: number;
  href?: string;
}

function Bloque({ titulo, explica, items, verTodo, vacio }: { titulo: string; explica?: string; items: Item[]; verTodo?: { href: string; texto: string }; vacio: string }) {
  return (
    // Mide lo que mide su lista: en la rejilla de dos columnas ya no se estira al alto del vecino (dejaba 150-200 px vacíos).
    <section className="tarjeta min-w-0 space-y-2.5 rounded-2xl border border-line bg-paper p-4">
      <div className="space-y-0.5">
        <h3 className="font-display text-bloque font-bold text-ink">{titulo}</h3>
        {explica && <p className="text-meta text-mute">{explica}</p>}
      </div>
      {items.length ? (
        <ol className="space-y-2">
          {items.map((it) => {
            const cuerpo = (
              <>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-dato text-ink" title={it.titulo}>{it.titulo}</span>
                  <span className="shrink-0 font-mono text-meta tabular-nums text-ink">{it.valor}</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                  <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, Math.round(it.parte * 100))}%` }} />
                </span>
                {it.sub && <span className="mt-0.5 block text-rotulo text-mute">{it.sub}</span>}
              </>
            );
            return (
              <li key={it.clave}>
                {it.href ? (
                  <Link href={it.href} className="block rounded-lg px-1 py-0.5 -mx-1 transition-colors duration-rapido hover:bg-paperSoft">
                    {cuerpo}
                  </Link>
                ) : (
                  cuerpo
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-meta text-mute">{vacio}</p>
      )}
      {verTodo && (
        <Link href={verTodo.href} className="inline-block text-meta font-semibold text-granate underline-offset-2 hover:underline">
          {verTodo.texto}
        </Link>
      )}
    </section>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Cómo gana: cuántos procesos y cuánto por cada tipo de proceso (la contratación directa no tiene competencia). */
export async function ComoGana({ pagina, ruc }: { pagina: Promise<(Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }) | null>; ruc: string }) {
  const f = (await pagina)?.facetas;
  const fam = (f?.familias ?? []).filter((x) => x.n > 0);
  const total = fam.reduce((t, x) => t + x.n, 0);
  return (
    <Bloque
      titulo="Cómo gana"
      explica="Por tipo de proceso. En la contratación directa no compite con nadie."
      vacio="No ganó procesos con buena pro desde 2018."
      items={fam.slice(0, 6).map((x) => ({
        clave: String(x.valor),
        titulo: String(x.valor),
        valor: plural(x.n, "proceso", "procesos"),
        sub: `${pct(x.n / Math.max(1, total))} de sus procesos${x.monto ? `, ${solesCompacto(x.monto)}` : ""}`,
        parte: x.n / Math.max(1, fam[0]?.n ?? 1),
        href: rutaEmpresa(ruc, "contratos", { [P_CONTRATOS.familia]: String(x.valor) }),
      }))}
      verTodo={fam.length > 6 ? { href: rutaEmpresa(ruc, "contratos"), texto: `Ver los ${numero(fam.length)} tipos en Contratos` } : undefined}
    />
  );
}

/** Dónde vende: las regiones de las entidades que le adjudicaron, por cuántos procesos. */
export async function DondeVende({ pagina, ruc }: { pagina: Promise<(Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }) | null>; ruc: string }) {
  const f = (await pagina)?.facetas;
  const dep = [...(f?.departamentos ?? [])].sort((a, b) => b.n - a.n);
  const total = dep.reduce((t, x) => t + x.n, 0);
  return (
    <Bloque
      titulo="Dónde gana"
      explica="La región de las entidades que le adjudicaron, por cuántos procesos."
      vacio="Sin procesos ganados con región."
      items={dep.slice(0, 6).map((x) => ({
        clave: String(x.valor),
        titulo: tituloNatural(String(x.valor)),
        valor: plural(x.n, "proceso", "procesos"),
        sub: pct(x.n / Math.max(1, total)),
        parte: x.n / Math.max(1, dep[0]?.n ?? 1),
        href: rutaEmpresa(ruc, "contratos", { [P_CONTRATOS.departamento]: String(x.valor) }),
      }))}
      verTodo={dep.length > 6 ? { href: rutaEmpresa(ruc, "contratos"), texto: `Ver las ${numero(dep.length)} regiones en Contratos` } : undefined}
    />
  );
}

/** Sus principales clientes: las entidades que más le pagaron (contratos sola y órdenes), con su parte del total. */
export async function ClientesPrincipales({ datos, ruc }: { datos: Promise<{ total: number; data: ClienteEmpresa[] } | null>; ruc: string }) {
  const d = await datos;
  const lista = (d?.data ?? []).map((c) => ({ ...c, pagado: c.adjudicado + c.ordenado })).sort((a, b) => b.pagado - a.pagado);
  const total = lista.reduce((t, c) => t + c.pagado, 0);
  return (
    <Bloque
      titulo="Sus principales clientes"
      explica="Las entidades que más le pagaron por contratos y órdenes."
      vacio="Ninguna entidad le adjudicó ni le compró."
      items={lista.slice(0, 5).map((c) => ({
        clave: c.entidadRuc,
        titulo: c.entidad ? tituloNatural(c.entidad) : c.entidadRuc,
        valor: solesCompacto(c.pagado),
        sub: `${pct(c.pagado / Math.max(1, total))} de lo que recibió${c.visitas ? `; ${plural(c.visitas, "visita", "visitas")} de su gente` : ""}`,
        parte: c.pagado / Math.max(1, lista[0]?.pagado ?? 1),
        href: `/entidad/${c.entidadRuc}`,
      }))}
      verTodo={lista.length > 5 ? { href: rutaEmpresa(ruc, "clientes"), texto: `Ver sus ${numero(lista.length)} clientes` } : undefined}
    />
  );
}

/** Quién le gana: las empresas que se llevaron la buena pro donde ella también postuló, de las que más veces a las que menos. */
export async function QuienLeGana({ pagina, ruc }: { pagina: Promise<(Pagina<PostulacionEmpresa> & { facetas: FacetasPostulaciones | null }) | null>; ruc: string }) {
  const f = (await pagina)?.facetas;
  const g = f?.ganadores ?? [];
  const r = f?.resultado;
  const postulo = r ? r.gano + r.perdio + r.sin : 0;
  return (
    <Bloque
      titulo="Quién le gana"
      explica={r ? `Postuló a ${numero(postulo)} procesos: ganó ${numero(r.gano)} y perdió ${numero(r.perdio)}.` : undefined}
      vacio="No perdió ningún proceso contra otra empresa con RUC."
      items={g.slice(0, 5).map((x) => ({
        clave: String(x.valor),
        // El nombre como se escribe (la API lo da en mayúsculas); sin nombre, su RUC (sólo empresas: RUC 20).
        titulo: x.etiqueta ? tituloNatural(String(x.etiqueta)) : String(x.valor),
        valor: plural(x.n, "vez", "veces"),
        parte: x.n / Math.max(1, g[0]?.n ?? 1),
        href: rutaEmpresa(ruc, "postulaciones", { [P_POSTULACIONES.ganador]: String(x.valor) }),
      }))}
      // Su lista de postulaciones entera (antes abría la ficha del primer competidor, que no es lo que dice el bloque).
      verTodo={postulo > 0 || g.length ? { href: rutaEmpresa(ruc, "postulaciones"), texto: postulo > 0 ? `Ver sus ${numero(postulo)} postulaciones` : "Ver sus postulaciones" } : undefined}
    />
  );
}

/** Un valor de «Sus datos» que lleva a su lista (su gente, sus visitas): la cifra es navegable, no texto muerto. */
function EnlaceDato({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="font-medium text-granate underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

/**
 * Sus datos, la columna lateral del Inicio (§14.2: datos de proceso, enlaces): quién es en la SUNAT y quién está detrás
 * según el RNP, en UNA tarjeta con dos subtítulos y sus filas sin marco. Antes eran dos tarjetas con su caja adentro y
 * rótulos en mayúsculas, ~380 px en el centro de la primera pantalla. El RUC no se repite: está en la cabecera. En una
 * pantalla mediana los dos bloques van lado a lado; en la columna lateral, uno bajo el otro.
 */
export function SusDatos({ e }: { e: FichaEmpresa["empresa"] }) {
  const haySunat = !!(e.estadoSunat || e.fechaAlta || e.domicilio || e.actividad);
  // Papeles, no personas: quien es socio y representante cuenta dos veces aquí. La pestaña cuenta personas distintas
  // (`personas`, que falta en respuestas viejas de la API): con ese dato, las personas primero y sus papeles al lado.
  const papeles = e.socios + e.representantes + e.directivos;
  const dePapeles = listaY(
    [
      e.socios ? plural(e.socios, "socio", "socios") : null,
      e.representantes ? plural(e.representantes, "representante", "representantes") : null,
      e.directivos ? plural(e.directivos, "directivo", "directivos") : null,
    ].filter((x): x is string => !!x),
  );
  const suGente = e.personas
    ? `${plural(e.personas, "persona", "personas")}${e.personas < papeles ? ` con ${numero(papeles)} papeles` : ""}: ${dePapeles}`
    : dePapeles;
  const sunat: DatoClave[] = haySunat
    ? [
        { etiqueta: "Estado", valor: e.estadoSunat ? oracion(e.estadoSunat) : null },
        { etiqueta: "Inscrita", valor: e.fechaAlta ? fecha(e.fechaAlta) : null },
        { etiqueta: "Domicilio fiscal", valor: e.domicilio ? tituloNatural(e.domicilio) : null },
        { etiqueta: "Actividad", valor: e.actividad ? oracion(e.actividad) : null },
      ]
    : [{ etiqueta: "Ficha RUC", valor: "Todavía no cargada para esta empresa" }];
  const rnp: DatoClave[] = [
    {
      etiqueta: "Su gente",
      valor: papeles ? <EnlaceDato href={rutaEmpresa(e.ruc, "socios")}>{suGente}</EnlaceDato> : "Sin registro en el RNP",
    },
    {
      etiqueta: "Empresas vinculadas",
      valor: e.vinculadas ? (
        <EnlaceDato href={rutaEmpresa(e.ruc, "socios")}>{`${plural(e.vinculadas, "empresa comparte", "empresas comparten")} socio, representante o directivo`}</EnlaceDato>
      ) : "Ninguna",
    },
    {
      etiqueta: "Visitas de su gente",
      valor: e.visitas ? (
        <EnlaceDato href={rutaEmpresa(e.ruc, "visitas")}>{`${plural(e.visitas, "visita", "visitas")}, ${numero(e.visitasClientes)} a entidades que le pagaron`}</EnlaceDato>
      ) : "Ninguna registrada",
    },
  ];
  return (
    <div className="tarjeta grid gap-x-6 gap-y-5 rounded-2xl border border-line bg-paper p-4 sm:p-5 lg:grid-cols-2 xl:grid-cols-1">
      <section aria-labelledby="datos-sunat" className="min-w-0 space-y-1">
        <h3 id="datos-sunat" className="font-display text-cuerpo font-bold text-ink">En la SUNAT</h3>
        <DatosClave items={sunat} />
        {/* La consulta RUC de la SUNAT no tiene un enlace por empresa: se busca con el RUC de la cabecera. */}
        <FuenteDato fuente="Consulta RUC de la SUNAT" href={CONSULTA_RUC_SUNAT} className="pt-1" />
      </section>
      <section aria-labelledby="datos-rnp" className="min-w-0 space-y-1">
        <div className="flex items-center gap-1">
          <h3 id="datos-rnp" className="font-display text-cuerpo font-bold text-ink">En el RNP</h3>
          <AyudaTermino clave="rnp" />
        </div>
        <DatosClave items={rnp} />
        {/* Su ficha en el Registro Nacional de Proveedores del OECE, con sus socios, representantes y directivos. */}
        <FuenteDato fuente="Su ficha en el Registro Nacional de Proveedores (OECE)" href={fichaRnp(e.ruc)} className="pt-1" />
      </section>
    </div>
  );
}
