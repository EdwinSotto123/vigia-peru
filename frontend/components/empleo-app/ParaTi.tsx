"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, GraduationCap, Loader2, PencilLine, Search, Sparkles, UserRoundSearch } from "lucide-react";
import { CabeceraPagina, Caja, Pagina, VacioCaja } from "@/components/gobserva/app/Caja";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { EstrellaSeguir } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { EstadoError, Bloque } from "@/components/licitaciones-app/ui/Estados";
import { Paginacion } from "@/components/licitaciones-app/ui/Paginacion";
import { Nota } from "@/components/patrones/Estructura";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { nombreRegion, puesto } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { igualEmpleo, textoRespuestaEmpleo, textosMotivo, variantesDe, type PerfilEmpleo } from "@/lib/empleo-app/entrevista";
import { cn } from "@/lib/utils";
import { useCalceEmpleo, usePerfilEmpleo } from "./usePerfilEmpleo";

const POR_PAGINA = 20;
const ORDENES = [
  { v: "calce", e: "Más afines" },
  { v: "cierre", e: "Cierran primero" },
  { v: "sueldo", e: "Mejor pagadas" },
  { v: "reciente", e: "Más recientes" },
] as const;
type Orden = (typeof ORDENES)[number]["v"];
const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

/**
 * «Para ti» de Gobserva Empleo (2026-11-07; con carrera el 2026-11-08): las plazas abiertas que calzan con tu perfil (la
 * búsqueda «Mi perfil» que arma el onboarding): las que piden tu carrera en su formación (o, en un perfil de antes, con
 * alguna de tus palabras) y tus filtros (estudios, experiencia, región, sueldo). Primero las más afines (tu carrera y uno
 * de tus puestos en el título); se filtra por una carrera o un puesto, se ordena y se pagina; todo en la URL. Cada plaza
 * se guarda con la estrella (entra a tu tablero de postulaciones y a tu calendario).
 */
export function ParaTiEmpleo({ base }: { base: string }) {
  const { perfil, cargando, error } = usePerfilEmpleo();
  const sp = useSearchParams();
  const router = useRouter();
  const ruta = usePathname();
  const orden = (ORDENES.find((o) => o.v === sp.get("orden"))?.v ?? "calce") as Orden;
  const pag = Math.max(1, Number(sp.get("pag")) || 1);
  const palabra = perfil?.palabras.includes(sp.get("palabra") ?? "") ? sp.get("palabra") : null;
  const carrera = perfil?.carreras.find((c) => igualEmpleo(c, sp.get("carrera") ?? "")) ?? null;
  // Por carrera: sólo esa (los puestos siguen ordenando). Por puesto: las que tienen ese puesto en el título.
  const filtrado: PerfilEmpleo | null = perfil ? (carrera ? { ...perfil, carreras: [carrera] } : perfil) : null;
  const calce = useCalceEmpleo(filtrado, { size: POR_PAGINA, page: pag, orden, ...(palabra ? { puesto: palabra } : {}) });
  // Los conteos de cada carrera y de cada puesto salen de la consulta con el perfil entero.
  const todas = useCalceEmpleo(perfil, { size: 1 });
  const nCarrera = (c: string) => todas.data?.porCarrera.find((x) => igualEmpleo(x.variantes[0] ?? "", variantesDe(c)[0]))?.n;

  const href = (cambios: Record<string, string | number | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "" || (k === "pag" && v === 1) || (k === "orden" && v === "calce")) q.delete(k);
      else q.set(k, String(v));
    }
    return `${ruta}${q.size ? `?${q}` : ""}`;
  };

  if (cargando) {
    return (
      <Pagina>
        <Bloque className="h-9 w-40" />
        <Bloque className="mt-3 h-5 w-full max-w-xl" />
        <div className="mt-6 grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Bloque key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </Pagina>
    );
  }

  if (error || !perfil) {
    return (
      <Pagina>
        <CabeceraPagina titulo="Para ti" bajada="Las plazas del Estado que piden tu carrera, primero las más afines a ti." />
        <Caja id="perfil" titulo="Arma tu perfil">
          <VacioCaja
            Icono={UserRoundSearch}
            titulo={error ? "No pudimos leer tu perfil" : "Todavía no armaste tu perfil"}
            texto="Sube tu CV o responde unas preguntas rápidas (tu carrera, tus estudios, tu experiencia, dónde y desde qué sueldo) y aquí te mostramos las plazas a las que puedes postular."
            accion={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
                  <Sparkles size={15} aria-hidden /> Armar mi perfil
                </Link>
                <Link href={rutaEn(base, "/app/plazas")} className={claseAccion("secundario")}>
                  Ver todas las plazas
                </Link>
              </div>
            }
          />
        </Caja>
      </Pagina>
    );
  }

  const total = calce.data?.total ?? null;
  const paginas = total ? Math.max(1, Math.ceil(total / POR_PAGINA)) : 1;
  // El perfil en cuatro datos con su nombre (sin filtro, «cualquiera»).
  const resumen = [
    { q: "estudios", nombre: "Estudios", texto: perfil.tengo ? textoRespuestaEmpleo("estudios", perfil, regionDeSlug, false) : "cualquiera" },
    { q: "experiencia", nombre: "Experiencia", texto: textoRespuestaEmpleo("experiencia", perfil, regionDeSlug, false) },
    { q: "lugar", nombre: "Dónde", texto: textoRespuestaEmpleo("lugar", perfil, regionDeSlug, false) },
    { q: "sueldo", nombre: "Sueldo", texto: perfil.sueldo == null ? "cualquiera" : textoRespuestaEmpleo("sueldo", perfil, regionDeSlug, false).replace(/^Desde/, "desde") },
  ];
  if (perfil.carreras.length) resumen.unshift({ q: "carrera", nombre: perfil.carreras.length > 1 ? "Carreras" : "Carrera", texto: textoRespuestaEmpleo("carrera", perfil, regionDeSlug, false) });
  const deAntes = perfil.carreras.length === 0;

  return (
    <Pagina>
      <CabeceraPagina
        titulo="Para ti"
        bajada={
          <>
            Las plazas abiertas que calzan con tu perfil <b className="font-semibold text-ink">«{perfil.puesto || "Mi perfil"}»</b>
            {todas.data ? <>: hoy son <b className="font-semibold tabular-nums text-ink">{numero(todas.data.total)}</b>.</> : "."}
          </>
        }
        acciones={
          <>
            <Link href={rutaEn(base, "/app/plazas")} className={claseAccion("secundario")}>
              <Search size={15} aria-hidden /> Buscar otras plazas
            </Link>
            <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
              <PencilLine size={15} aria-hidden /> Editar mi perfil
            </Link>
          </>
        }
      />

      <Caja
        id="filtros"
        titulo="Tu perfil"
        descripcion={
          <span className="flex flex-wrap gap-x-4 gap-y-0.5">
            {resumen.map((r) => (
              <span key={r.q}>
                <span className="text-mute">{r.nombre}:</span> {r.texto}
              </span>
            ))}
          </span>
        }
        relleno={false}
        accion={
          <label className="inline-flex min-w-0 items-center gap-2 text-meta text-inkSoft">
            <ArrowDownUp size={15} aria-hidden className="shrink-0 text-mute" />
            <span className="sr-only sm:not-sr-only">Ordenar:</span>
            <select
              value={orden}
              onChange={(e) => router.replace(href({ orden: e.target.value, pag: 1 }), { scroll: false })}
              className="h-10 min-w-0 rounded-lg border border-line bg-caja pl-3 pr-8 text-dato font-medium text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
            >
              {ORDENES.map((o) => (
                <option key={o.v} value={o.v}>{o.e}</option>
              ))}
            </select>
          </label>
        }
      >
        <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-5" role="group" aria-label="Filtrar por carrera o puesto">
          <FiltroPalabra href={href({ palabra: null, carrera: null, pag: 1 })} activa={!palabra && !carrera} etiqueta="Todas" n={todas.data?.total} />
          {perfil.carreras.length > 1 &&
            perfil.carreras.map((c) => (
              <FiltroPalabra key={`c-${c}`} href={href({ carrera: c, palabra: null, pag: 1 })} activa={carrera === c} etiqueta={c} n={nCarrera(c)} icono />
            ))}
          {perfil.palabras.map((w) => (
            <FiltroPalabra key={w} href={href({ palabra: w, carrera: null, pag: 1 })} activa={palabra === w} etiqueta={w} n={todas.data?.porPalabra.find((x) => x.palabra === w)?.n} />
          ))}
        </div>
        {deAntes && (
          <div className="px-4 pb-4 sm:px-5">
            <Nota icono={<GraduationCap size={15} aria-hidden />}>
              Tu perfil es de antes y busca sólo por palabras, así que pueden colarse plazas de otra carrera.{" "}
              <Link href={rutaEn(base, "/app/bienvenida")} className="font-semibold text-ink underline underline-offset-2">Suma tu carrera</Link> (o sube tu CV) para ver sólo las plazas a las que puedes postular.
            </Nota>
          </div>
        )}
      </Caja>

      <div className="mt-4 sm:mt-6">
        {calce.error ? (
          <Caja>
            <EstadoError texto="Suele pasar un momento. Vuelve a intentarlo: tu perfil se mantiene." acciones={<button type="button" onClick={() => void calce.mutate()} className={claseAccion("secundario")}>Volver a intentar</button>} />
          </Caja>
        ) : !calce.data ? (
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Bloque key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : calce.data.data.length === 0 ? (
          <Caja>
            <VacioCaja
              Icono={UserRoundSearch}
              titulo="Hoy no hay plazas abiertas que calcen"
              texto="Salen plazas nuevas cada semana y tu alerta te avisa. Mientras, prueba con otra carrera afín o un sueldo mínimo más bajo en tu perfil."
              accion={<Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>Editar mi perfil</Link>}
            />
          </Caja>
        ) : (
          <>
            <ol className={cn("grid grid-cols-1 gap-3 transition-opacity duration-rapido", calce.isValidating && "opacity-60")} aria-label="Plazas para ti" aria-busy={calce.isValidating}>
              {calce.data.data.map((p) => (
                <li key={p.aviso} className="min-w-0">
                  <TarjetaPlaza
                    p={p}
                    base={base}
                    ruta="/app/plaza"
                    enApp
                    motivo={textosMotivo(p.motivo, perfil.carreras)}
                    accion={<EstrellaSeguir id={String(p.aviso)} codigo={null} titulo={puesto(p.titulo)} tipo="plaza" />}
                  />
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Paginacion pagina={pag} paginas={Math.min(paginas, 100)} total={total ?? 0} tamano={POR_PAGINA} href={(n) => href({ pag: n })} nombre="plazas" />
            </div>
          </>
        )}
        {calce.isValidating && calce.data && (
          <p className="sr-only" role="status">
            <Loader2 aria-hidden /> Actualizando
          </p>
        )}
      </div>
    </Pagina>
  );
}

function FiltroPalabra({ href, activa, etiqueta, n, icono }: { href: string; activa: boolean; etiqueta: string; n: number | undefined; icono?: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={activa ? "true" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido",
        activa ? "border-granate bg-granate-50 text-ink" : "border-line bg-caja text-inkSoft hover:border-granate/50 hover:text-ink",
      )}
    >
      {icono && <GraduationCap size={14} aria-hidden className="text-mute" />}
      {etiqueta}
      {n != null && <span className="tabular-nums text-mute">{numero(n)}</span>}
    </Link>
  );
}
