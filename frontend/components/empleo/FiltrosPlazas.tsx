"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ArrowDownUp, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import {
  NIVEL, NIVELES_PERSONA, REGIONES_EMPLEO, filtrosPuestos, nombreRegion, plazasHasta, qsEmpleo, slugRegion, type Conteo, type FiltrosEmpleo, type NivelPersona,
} from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

/** 16 px en el celular (el navegador no hace zoom al tocar el campo), 14 en la computadora. */
const CAMPO =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 lg:text-dato";
const ETIQUETA = "mb-1 block text-meta font-semibold text-inkSoft";

const SUELDOS = [
  { v: "", e: "Cualquier sueldo" },
  { v: "2500", e: "Desde S/ 2,500" },
  { v: "4000", e: "Desde S/ 4,000" },
  { v: "6000", e: "Desde S/ 6,000" },
  { v: "10000", e: "Desde S/ 10,000" },
];
const EXPERIENCIA = [
  { v: "", e: "Cualquiera" },
  { v: "0", e: "Sin experiencia" },
  { v: "1", e: "Hasta 1 año" },
  { v: "2", e: "Hasta 2 años" },
  { v: "3", e: "Hasta 3 años" },
  { v: "5", e: "Hasta 5 años" },
];
const CIERRE = [
  { v: "", e: "Cualquier día" },
  { v: "hoy", e: "Hoy" },
  { v: "2dias", e: "En los próximos 2 días" },
  { v: "semana", e: "Esta semana" },
];
const ORDENES: { v: NonNullable<FiltrosEmpleo["orden"]>; e: string }[] = [
  { v: "calce", e: "Más afines" },
  { v: "cierre", e: "Cierran primero" },
  { v: "sueldo", e: "Mejor pagadas" },
  { v: "reciente", e: "Más recientes" },
  { v: "vacantes", e: "Más vacantes" },
];

function Campo({ etiqueta, htmlFor, children }: { etiqueta: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className={ETIQUETA}>
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

/**
 * Los filtros de /plazas. En la computadora es la columna de la izquierda, pegada al bajar: cada campo con su nombre a la
 * vista y cada cambio se aplica solo (la URL cambia y la lista se vuelve a pedir). En el celular queda a la vista sólo la
 * búsqueda y el botón «Filtros» (con cuántos hay puestos): abre los campos uno debajo del otro, a todo el ancho, y se
 * aplican juntos con «Ver plazas» (antes eran seis desplegables cortados en dos columnas que tapaban la primera pantalla).
 *
 * Sin JavaScript también funciona: es un formulario GET y «Filtros» es una casilla que abre el panel sólo con CSS
 * (`group-has-[#ver-filtros:checked]`). Cada región y cada nivel dice cuántas plazas tiene con los demás filtros puestos;
 * una región sin plazas no se puede elegir (sería una lista vacía). El orden va aparte (OrdenPlazas), sobre la lista.
 */
export function FiltrosPlazas({
  base, filtros, facetas, ruta = "/plazas",
}: {
  base: string;
  filtros: FiltrosEmpleo;
  facetas: { region: Conteo[]; nivel: Conteo[] };
  /** La lista que filtra: «/plazas» (portada) o «/app/plazas» (la app). */
  ruta?: string;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [abierto, setAbierto] = useState(false);
  // Mientras llega la lista nueva (con datos móviles puede tardar), el formulario lo dice: «Buscando…». El panel del
  // celular se cierra cuando la lista ya llegó, no antes (si no, se quedaba la lista vieja sin ningún aviso).
  const [buscando, iniciar] = useTransition();
  useEffect(() => {
    if (!buscando) setAbierto(false);
  }, [buscando]);
  const lista = rutaEn(base, ruta);
  const porRegion = new Map(facetas.region.map((f) => [f.clave, f.n]));
  const conFacetas = facetas.region.length > 0;
  const n = filtrosPuestos(filtros);
  // «Quitar los filtros» deja la búsqueda, el orden y tu perfil («Para ti» es un modo de la lista, no un filtro más).
  const sinFiltros = `${lista}${qsEmpleo({ q: filtros.q, orden: filtros.orden, carreras: filtros.carreras, palabras: filtros.palabras, para: filtros.para })}`;

  const aplicar = (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!form.current) return;
    const d = new FormData(form.current);
    const v = (k: string) => String(d.get(k) ?? "").trim() || undefined;
    const exp = v("exp");
    const f: FiltrosEmpleo = {
      q: v("q"),
      region: v("region"),
      // El nivel exacto (de «Qué estudios piden» en la portada) y la entidad no tienen campo: viajan como vinieron.
      nivel: filtros.nivel,
      tengo: v("tengo") as NivelPersona | undefined,
      entidad: filtros.entidad,
      sueldo: v("sueldo") ? Number(v("sueldo")) : undefined,
      exp: exp != null ? Number(exp) : undefined,
      cierra: v("cierra") as FiltrosEmpleo["cierra"],
      senal: filtros.senal,
      carreras: filtros.carreras,
      palabras: filtros.palabras,
      para: filtros.para,
      orden: filtros.orden ?? "cierre",
    };
    iniciar(() => router.push(`${lista}${qsEmpleo(f)}`));
  };
  // Con la columna a la vista (computadora), cada cambio se aplica solo. Con el panel abierto (celular), se eligen varios
  // y se aplican juntos: si no, cada toque recargaba la lista y cerraba el panel.
  const cambio = () => {
    if (!abierto) aplicar();
  };

  return (
    <form
      ref={form}
      id="filtros-plazas"
      onSubmit={aplicar}
      action={lista}
      method="get"
      role="search"
      aria-label="Filtrar plazas"
      aria-busy={buscando}
      className="group scroll-mt-28 rounded-2xl border border-line bg-paper p-3 sm:p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
    >
      {/* Sin JavaScript, lo que no tiene campo viaja igual: la señal (llega de la portada) y el orden. */}
      {filtros.senal && <input type="hidden" name="senal" value={filtros.senal} />}
      {filtros.nivel && <input type="hidden" name="nivel" value={filtros.nivel} />}
      {filtros.entidad && <input type="hidden" name="entidad" value={filtros.entidad} />}
      {filtros.orden && filtros.orden !== "cierre" && <input type="hidden" name="orden" value={filtros.orden} />}
      {filtros.carreras && <input type="hidden" name="carreras" value={filtros.carreras} />}
      {filtros.palabras && <input type="hidden" name="palabras" value={filtros.palabras} />}
      {filtros.para && <input type="hidden" name="para" value={filtros.para} />}

      <div className="mb-3 hidden items-center justify-between gap-2 lg:flex">
        <h2 className="font-display text-bloque font-bold leading-tight text-ink">Filtrar plazas</h2>
        {buscando && (
          <span role="status" className="inline-flex items-center gap-1.5 text-meta text-mute">
            <Loader2 size={14} aria-hidden className="animate-spin" /> Buscando…
          </span>
        )}
      </div>

      <div className="flex min-w-0 gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Puesto, entidad o lugar</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input name="q" type="search" enterKeyHint="search" autoComplete="off" defaultValue={filtros.q} placeholder="Puesto o entidad" maxLength={80} className={cn(CAMPO, "pl-9")} />
        </label>
        <button
          type="submit"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-granate text-paper transition-colors duration-rapido hover:bg-granate-deep lg:inline-flex"
        >
          <Search size={16} aria-hidden />
          <span className="sr-only">Buscar</span>
        </button>
        <label className="inline-flex h-11 shrink-0 cursor-pointer select-none items-center gap-2 rounded-xl border border-line bg-paper px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 has-[:checked]:border-granate has-[:checked]:bg-granate-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-granate lg:hidden">
          <input id="ver-filtros" type="checkbox" className="sr-only" checked={abierto} onChange={(e) => setAbierto(e.target.checked)} aria-controls="panel-filtros" />
          {buscando ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <SlidersHorizontal size={16} aria-hidden />}
          Filtros
          {n > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1.5 text-rotulo font-bold tabular-nums text-paper">
              {n}
              <span className="sr-only"> puestos</span>
            </span>
          )}
        </label>
      </div>

      <div id="panel-filtros" className="mt-3 hidden gap-3 border-t border-line pt-3 group-has-[#ver-filtros:checked]:grid lg:grid lg:border-0 lg:pt-1">
        <Campo etiqueta="Región" htmlFor="f-region">
          <select id="f-region" name="region" defaultValue={filtros.region ?? ""} onChange={cambio} className={CAMPO}>
            <option value="">Todas las regiones</option>
            {REGIONES_EMPLEO.map((r) => {
              const slug = slugRegion(r);
              const cuantas = porRegion.get(r) ?? 0;
              return (
                <option key={r} value={slug} disabled={conFacetas && cuantas === 0 && filtros.region !== slug}>
                  {nombreRegion(r)} ({numero(cuantas)})
                </option>
              );
            })}
          </select>
        </Campo>
        {/* Lo que tiene quien busca: las plazas a las que puede postular (las que piden su nivel o uno menor). */}
        <Campo etiqueta="Tus estudios" htmlFor="f-tengo">
          <select id="f-tengo" name="tengo" defaultValue={filtros.tengo ?? ""} onChange={cambio} className={CAMPO}>
            <option value="">Cualquiera</option>
            {NIVELES_PERSONA.map((nv) => (
              <option key={nv} value={nv}>
                {NIVEL[nv].largo} ({numero(plazasHasta(facetas.nivel, nv))})
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Sueldo al mes" htmlFor="f-sueldo">
          <select id="f-sueldo" name="sueldo" defaultValue={filtros.sueldo ? String(filtros.sueldo) : ""} onChange={cambio} className={CAMPO}>
            {SUELDOS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.e}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Experiencia que piden" htmlFor="f-exp">
          <select id="f-exp" name="exp" defaultValue={filtros.exp != null ? String(filtros.exp) : ""} onChange={cambio} className={CAMPO}>
            {EXPERIENCIA.map((s) => (
              <option key={s.v} value={s.v}>
                {s.e}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Cierran" htmlFor="f-cierra">
          <select id="f-cierra" name="cierra" defaultValue={filtros.cierra ?? ""} onChange={cambio} className={CAMPO}>
            {CIERRE.map((s) => (
              <option key={s.v} value={s.v}>
                {s.e}
              </option>
            ))}
          </select>
        </Campo>

        {/* El celular aplica todo junto; la computadora ya lo aplicó al cambiar cada campo. */}
        <div className="flex flex-wrap items-center gap-2 pt-1 lg:hidden">
          <button type="submit" disabled={buscando} className={claseAccion("primario", "min-h-11 flex-1 disabled:opacity-70")}>
            {buscando && <Loader2 size={16} aria-hidden className="animate-spin" />}
            {buscando ? "Buscando…" : "Ver plazas"}
          </button>
          {n > 0 && (
            <Link href={sinFiltros} className={claseAccion("fantasma", "min-h-11")}>
              Quitar los filtros
            </Link>
          )}
        </div>
        {n > 0 && (
          <Link href={sinFiltros} className="hidden min-h-11 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline lg:inline-flex">
            Quitar los filtros
          </Link>
        )}
      </div>
    </form>
  );
}

/**
 * «Ordenar» sobre la lista: cambiar el orden vuelve a la primera página con los mismos filtros. Va aparte del panel de
 * filtros para que en el celular se cambie sin abrirlo.
 */
export function OrdenPlazas({ base, filtros, ruta = "/plazas" }: { base: string; filtros: FiltrosEmpleo; ruta?: string }) {
  const router = useRouter();
  const [ordenando, iniciar] = useTransition();
  const lista = rutaEn(base, ruta);
  return (
    <label className="ml-auto inline-flex min-w-0 items-center gap-2 text-meta text-inkSoft" aria-busy={ordenando}>
      {ordenando ? <Loader2 size={15} aria-hidden className="shrink-0 animate-spin text-mute" /> : <ArrowDownUp size={15} aria-hidden className="shrink-0 text-mute" />}
      <span className="sr-only sm:not-sr-only">Ordenar:</span>
      <select
        name="orden"
        defaultValue={filtros.orden ?? "cierre"}
        onChange={(e) => {
          const orden = e.target.value as FiltrosEmpleo["orden"];
          iniciar(() => router.push(`${lista}${qsEmpleo({ ...filtros, orden, page: undefined })}`));
        }}
        className="h-11 min-w-0 rounded-xl border border-line bg-paper pl-3 pr-8 text-destacado font-medium text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
      >
        {ORDENES.filter((o) => o.v !== "calce" || filtros.carreras || filtros.palabras).map((o) => (
          <option key={o.v} value={o.v}>
            {o.e}
          </option>
        ))}
      </select>
    </label>
  );
}
