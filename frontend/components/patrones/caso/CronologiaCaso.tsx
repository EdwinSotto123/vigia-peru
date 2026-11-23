"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building, CalendarRange, LogOut, Receipt, ShoppingCart, Split, TriangleAlert, UserPlus } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import { fechaConAnio, numero, oracion, solesCompacto } from "@/lib/formato";
import type { HitoCaso, NodoCaso, TipoHito } from "@/lib/casoPatron";
import { nombreLegibleEmpresa } from "@/lib/nombreEmpresa";
import { cn } from "@/lib/utils";

/**
 * Qué pasó, hecho por hecho (la ficha de un caso de patrón): cada hito con su fecha, quiénes, cuánto y su fuente, agrupado
 * por año. Se lee como una historia (de lo más viejo a lo más nuevo, se puede dar vuelta), se filtra por clase de hecho
 * (las empresas y sus socios, las órdenes, lo que llama la atención) y va de a diez por página: nada de scroll sin fin.
 */
const TAM = 10;
type Clase = "empresas" | "ordenes" | "senales";
const CLASE: Record<TipoHito, Clase> = {
  fundacion: "empresas", socio: "empresas", salida: "empresas",
  primera: "ordenes", ultima: "ordenes", anio: "ordenes", otro: "ordenes",
  dia: "senales", repartido: "senales", sobre_tope: "senales",
};
const NOMBRE_CLASE: Record<Clase, string> = { empresas: "Las empresas y sus socios", ordenes: "Las órdenes", senales: "Lo que llama la atención" };
const ICONO: Record<TipoHito, typeof Building> = {
  fundacion: Building, socio: UserPlus, salida: LogOut, primera: ShoppingCart, ultima: ShoppingCart, anio: CalendarRange,
  dia: Receipt, repartido: Split, sobre_tope: TriangleAlert, otro: ArrowRight,
};
/**
 * El texto de un hecho como se lee (2026-11-23, «muro de texto»): cada empresa por su nombre corto («E & M Muñoz
 * Construcserg S.A.C.», no «E & M Muñoz Construcciones y Servicios Generales S.A.C. - e & M Muñoz Construcserg S.A.C.»),
 * y el objeto entre «» como oración, sin MAYÚSCULAS, y cortado en una palabra entera (el servidor lo recorta en 140
 * caracteres, a veces a media palabra: «…"MEJORAMIENTO DEL »).
 */
function legible(t: string, cortos: [string, string][]): string {
  let x = t;
  for (const [largo, corto] of cortos) if (largo !== corto) x = x.split(largo).join(corto);
  return x.replace(/«([^»]*)»/g, (_, obj: string) => {
    let o = oracion(obj.replace(/\s+/g, " ").trim());
    // El servidor lo recorta en 90 o 140 caracteres (lib/casoPatron.ts): con ese largo justo, quedó cortado.
    // Sin palabras sueltas al final («…para la obra "Mejoramiento de la…»): se quitan antes del «…».
    if (obj.length === 90 || obj.length >= 135) {
      o = o.replace(/\s+\S*$/, "");
      for (let k = 0; k < 3; k++) o = o.replace(/\s+(?:de|la|las|el|los|del|para|en|y|e|a|al|con|por|que|su|sus)$/i, "");
      o = o.replace(/[\s,;:("“-]+$/, "") + "…";
    }
    // El nombre de la obra entre comillas también empieza con mayúscula («la obra "Mejoramiento…"»).
    o = o.replace(/"(\p{Ll})/u, (_m, l: string) => `"${l.toLocaleUpperCase("es")}`);
    // Comillas sin cerrar de un objeto recortado («… la obra "Mejoramiento del…»): se cierran.
    if ((o.match(/"/g) ?? []).length % 2 === 1) o += '"';
    return `«${o}»`;
  });
}

const CHIP =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-meta transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate disabled:opacity-45";

export function CronologiaCaso({ hitos, nodos }: { hitos: HitoCaso[]; nodos: NodoCaso[] }) {
  const [clase, setClase] = useState<Clase | "">("");
  const [reciente, setReciente] = useState(false);
  const [pagina, setPagina] = useState(1);
  const nombre = useMemo(() => new Map(nodos.map((n) => [n.id, n.nombre])), [nodos]);
  // El nombre entero de cada empresa y el que se lee (los más largos primero: uno puede contener a otro).
  const cortos = useMemo<[string, string][]>(
    () =>
      nodos
        .filter((n) => !!n.nombre && /( - |\bS\.?A\.?C\.?|\bS\.?R\.?L\.?|\bE\.?I\.?R\.?L\.?|sociedad)/i.test(n.nombre))
        .map((n): [string, string] => [n.nombre, nombreLegibleEmpresa(n.nombre).texto])
        .sort((a, b) => b[0].length - a[0].length),
    [nodos],
  );
  // «Lo que llama la atención» es todo hecho con gravedad (la primera orden con la persona en el puesto, un día con
  // órdenes a varios), sea de la clase que sea; las otras dos, por clase de hecho.
  const es = (h: HitoCaso, c: Clase) => (c === "senales" ? !!h.severidad : CLASE[h.tipo] === c);
  const cuenta = (c: Clase) => hitos.filter((h) => es(h, c)).length;
  const vistos = useMemo(() => {
    const xs = clase ? hitos.filter((h) => es(h, clase)) : hitos;
    return reciente ? [...xs].reverse() : xs;
  }, [hitos, clase, reciente]);
  const paginas = Math.max(1, Math.ceil(vistos.length / TAM));
  const pag = Math.min(pagina, paginas);
  const enPagina = vistos.slice((pag - 1) * TAM, pag * TAM);
  const cambiar = (f: () => void) => {
    f();
    setPagina(1);
  };

  return (
    <div className="space-y-3" data-paginado>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Clase de hecho" className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" aria-pressed={!clase} onClick={() => cambiar(() => setClase(""))} className={cn(CHIP, !clase ? "border-granate/30 bg-granate-50 font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:text-ink")}>
            Todo <span className="tabular-nums">{numero(hitos.length)}</span>
          </button>
          {(Object.keys(NOMBRE_CLASE) as Clase[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={clase === c}
              disabled={!cuenta(c)}
              onClick={() => cambiar(() => setClase(clase === c ? "" : c))}
              className={cn(CHIP, clase === c ? "border-granate/30 bg-granate-50 font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:text-ink")}
            >
              {NOMBRE_CLASE[c]} <span className="tabular-nums">{numero(cuenta(c))}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={reciente}
          onClick={() => cambiar(() => setReciente((v) => !v))}
          className={cn(CHIP, "ml-auto border-line bg-paper text-inkSoft hover:text-ink", reciente && "border-granate font-semibold text-ink")}
        >
          {reciente ? "Lo más reciente primero" : "Del comienzo al final"}
        </button>
      </div>

      {/* En su tarjeta: suelta, la línea de tiempo flotaba sobre el fondo de la página. */}
      <div className="tarjeta rounded-2xl border border-line bg-paper px-3 py-3 sm:px-4">
      <ol className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-paperEdge" aria-label="Hechos del caso">
        {enPagina.map((h, i) => {
          const anio = h.fecha.slice(0, 4);
          const nuevoAnio = i === 0 || enPagina[i - 1].fecha.slice(0, 4) !== anio;
          const Icono = ICONO[h.tipo];
          const titulo = legible(h.titulo, cortos);
          const detalle = h.detalle ? legible(h.detalle, cortos) : null;
          // Quiénes, sólo los que el título no nombra ya: antes la línea de abajo repetía las mismas dos empresas enteras.
          const quienes = (h.nodos ?? [])
            .map((id) => nombre.get(id))
            .filter((x): x is string => !!x && x.length > 0)
            .map((x) => legible(x, cortos))
            .filter((x) => !titulo.includes(x));
          return (
            <li key={`${h.fecha}-${h.tipo}-${i}`} className="relative">
              {nuevoAnio && (
                <p className="relative z-[1] mb-1 ml-[3px] mt-2 inline-flex rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-rotulo font-bold tabular-nums text-ink first:mt-0">{anio}</p>
              )}
              <div className="relative flex gap-3 py-1.5 pl-0.5">
                <span
                  className={cn(
                    "relative z-[1] mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                    h.severidad === "alta" ? "border-crimson/40 bg-crimson-soft text-crimsonTexto" : h.severidad === "media" ? "border-amber/40 bg-amber-soft text-amberTexto" : "border-line bg-paper text-inkSoft",
                  )}
                  aria-hidden
                >
                  <Icono size={14} />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {/* La fecha, la gravedad, el monto y la fuente en una línea; el hecho debajo; quiénes y el enlace al pie. */}
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-rotulo text-mute">
                    <span className="font-mono tabular-nums text-inkSoft">{h.tipo === "anio" ? `Todo ${anio}` : fechaConAnio(h.fecha)}</span>
                    {h.severidad && <Severidad bandera={h.severidad} formato="punto" />}
                    {h.monto ? <span className="rounded-md bg-paperDeep px-1.5 font-mono font-semibold tabular-nums text-ink">{solesCompacto(h.monto)}</span> : null}
                    <span>{h.fuente}</span>
                  </p>
                  <p className="text-dato font-semibold leading-snug text-ink text-pretty">{titulo}</p>
                  {detalle && <p className="text-meta leading-snug text-inkSoft text-pretty">{detalle}</p>}
                  {((quienes.length > 0 && h.tipo !== "anio") || h.href) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
                      {quienes.length > 0 && h.tipo !== "anio" && <span>{quienes.join(", ")}</span>}
                      {h.href && (
                        <Link href={h.href} prefetch={false} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                          Ver las órdenes
                        </Link>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      </div>
      {vistos.length > TAM && (
        <Paginacion actual={pag} paginas={paginas} total={vistos.length} tam={TAM} navegacion="interna" cargando={false} nombre="hechos" onChange={setPagina} subir />
      )}
    </div>
  );
}
