import Link from "next/link";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  rutaEmpresa,
  type ClienteEmpresa,
  type ContratoEmpresa,
  type FacetasContratos,
  type FacetasPostulaciones,
  type Pagina,
  type PostulacionEmpresa,
} from "@/lib/empresas";
import { P_CONTRATOS, P_POSTULACIONES } from "./SeccionesEmpresa";

/**
 * Los bloques del Inicio de una empresa que resumen sus listas (pedido del usuario, 2026-10-22: «faltan más cosas»):
 * cómo gana (por tipo de proceso), sus principales clientes, quién le gana más veces y dónde vende. Cada fila abre la
 * lista ya filtrada. Barras en CSS, cada una con su número escrito (nunca sólo la barra). Server components: esperan las
 * mismas promesas que las pestañas.
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
    <section className="min-w-0 space-y-2.5 rounded-2xl border border-line bg-paper p-4">
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
                  <span className="min-w-0 truncate text-dato text-ink">{it.titulo}</span>
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
const conParam = (ruta: string, seccion: string, extra: Record<string, string>) => {
  const q = new URLSearchParams({ seccion, ...extra });
  return `${ruta}?${q.toString()}`;
};

/** Cómo gana: cuántos procesos y cuánto por cada tipo de proceso (la contratación directa no tiene competencia). */
export async function ComoGana({ pagina, ruta }: { pagina: Promise<(Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }) | null>; ruta: string }) {
  const f = (await pagina)?.facetas;
  const fam = (f?.familias ?? []).filter((x) => x.n > 0);
  const total = fam.reduce((t, x) => t + x.n, 0);
  return (
    <Bloque
      titulo="Cómo gana"
      explica="Sus procesos ganados por tipo de proceso. En la contratación directa no compite con nadie."
      vacio="No ganó procesos con buena pro desde 2018."
      items={fam.slice(0, 6).map((x) => ({
        clave: String(x.valor),
        titulo: String(x.valor),
        valor: plural(x.n, "proceso", "procesos"),
        sub: `${pct(x.n / Math.max(1, total))} de sus procesos${x.monto ? `, ${solesCompacto(x.monto)}` : ""}`,
        parte: x.n / Math.max(1, fam[0]?.n ?? 1),
        href: conParam(ruta, "contratos", { [P_CONTRATOS.familia]: String(x.valor) }),
      }))}
      verTodo={fam.length > 6 ? { href: conParam(ruta, "contratos", {}), texto: `Ver los ${numero(fam.length)} tipos en Contratos` } : undefined}
    />
  );
}

/** Dónde vende: las regiones de las entidades que le adjudicaron, por cuántos procesos. */
export async function DondeVende({ pagina, ruta }: { pagina: Promise<(Pagina<ContratoEmpresa> & { facetas: FacetasContratos | null }) | null>; ruta: string }) {
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
        href: conParam(ruta, "contratos", { [P_CONTRATOS.departamento]: String(x.valor) }),
      }))}
      verTodo={dep.length > 6 ? { href: conParam(ruta, "contratos", {}), texto: `Ver las ${numero(dep.length)} regiones en Contratos` } : undefined}
    />
  );
}

/** Sus principales clientes: las entidades que más le pagaron (contratos sola y órdenes), con su parte del total. */
export async function ClientesPrincipales({ datos, ruta }: { datos: Promise<{ total: number; data: ClienteEmpresa[] } | null>; ruta: string }) {
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
      verTodo={lista.length > 5 ? { href: conParam(ruta, "clientes", {}), texto: `Ver sus ${numero(lista.length)} clientes` } : undefined}
    />
  );
}

/** Quién le gana: las empresas que se llevaron la buena pro donde ella también postuló, de las que más veces a las que menos. */
export async function QuienLeGana({ pagina, ruta }: { pagina: Promise<(Pagina<PostulacionEmpresa> & { facetas: FacetasPostulaciones | null }) | null>; ruta: string }) {
  const f = (await pagina)?.facetas;
  const g = f?.ganadores ?? [];
  const r = f?.resultado;
  return (
    <Bloque
      titulo="Quién le gana"
      explica={r ? `Postuló a ${numero(r.gano + r.perdio + r.sin)} procesos: ganó ${numero(r.gano)} y perdió ${numero(r.perdio)}.` : undefined}
      vacio="No perdió ningún proceso contra otra empresa con RUC."
      items={g.slice(0, 5).map((x) => ({
        clave: String(x.valor),
        titulo: String(x.etiqueta ?? x.valor),
        valor: plural(x.n, "vez", "veces"),
        parte: x.n / Math.max(1, g[0]?.n ?? 1),
        href: conParam(ruta, "postulaciones", { [P_POSTULACIONES.ganador]: String(x.valor) }),
      }))}
      verTodo={g.length ? { href: rutaEmpresa(String(g[0].valor)), texto: `Abrir la ficha de ${String(g[0].etiqueta ?? g[0].valor)}` } : undefined}
    />
  );
}
