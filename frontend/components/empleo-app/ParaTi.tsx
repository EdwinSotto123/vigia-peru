"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, Loader2, PencilLine, Search, Sparkles, UserRoundSearch } from "lucide-react";
import { CabeceraPagina, Caja, Pagina, VacioCaja } from "@/components/gobserva/app/Caja";
import { TarjetaPlaza } from "@/components/empleo/TarjetaPlaza";
import { EstrellaSeguir } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { EstadoError, Bloque } from "@/components/licitaciones-app/ui/Estados";
import { Paginacion } from "@/components/licitaciones-app/ui/Paginacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { nombreRegion, puesto } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { PREGUNTAS_EMPLEO, textoRespuestaEmpleo, type PerfilEmpleo } from "@/lib/empleo-app/entrevista";
import { cn } from "@/lib/utils";
import { useCalceEmpleo, usePerfilEmpleo } from "./usePerfilEmpleo";

const POR_PAGINA = 20;
const ORDENES = [
  { v: "cierre", e: "Cierran primero" },
  { v: "sueldo", e: "Mejor pagadas" },
  { v: "reciente", e: "Más recientes" },
] as const;
type Orden = (typeof ORDENES)[number]["v"];
const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

/**
 * «Para ti» de Gobserva Empleo (2026-11-07): las plazas abiertas que calzan con tu perfil (la búsqueda «Mi perfil» que
 * arma el onboarding), con alguna de tus palabras y tus filtros (estudios, experiencia, región, sueldo). Se filtra por
 * una palabra, se ordena (cierre, sueldo, recientes) y se pagina; todo en la URL. Cada plaza se guarda con la estrella
 * (entra a tu tablero de postulaciones y a tu calendario).
 */
export function ParaTiEmpleo({ base }: { base: string }) {
  const { perfil, cargando, error } = usePerfilEmpleo();
  const sp = useSearchParams();
  const router = useRouter();
  const ruta = usePathname();
  const orden = (ORDENES.find((o) => o.v === sp.get("orden"))?.v ?? "cierre") as Orden;
  const pag = Math.max(1, Number(sp.get("pag")) || 1);
  const palabra = perfil?.palabras.includes(sp.get("palabra") ?? "") ? sp.get("palabra") : null;
  const filtrado: PerfilEmpleo | null = perfil ? (palabra ? { ...perfil, palabras: [palabra] } : perfil) : null;
  const calce = useCalceEmpleo(filtrado, { size: POR_PAGINA, page: pag, orden });
  // Los conteos de cada palabra salen de la consulta con TODAS las palabras (la de la primera página).
  const todas = useCalceEmpleo(perfil, { size: 1 });

  const href = (cambios: Record<string, string | number | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "" || (k === "pag" && v === 1) || (k === "orden" && v === "cierre")) q.delete(k);
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
        <CabeceraPagina titulo="Para ti" bajada="Las plazas del Estado que calzan contigo, de las que cierran primero a las últimas." />
        <Caja id="perfil" titulo="Arma tu perfil">
          <VacioCaja
            Icono={UserRoundSearch}
            titulo={error ? "No pudimos leer tu perfil" : "Todavía no armaste tu perfil"}
            texto="Son siete preguntas rápidas (qué trabajo buscas, tus estudios, tu experiencia, dónde y desde qué sueldo) y aquí te mostramos las plazas que calzan."
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
  const resumen = PREGUNTAS_EMPLEO.filter((q) => q === "estudios" || q === "experiencia" || q === "lugar" || q === "sueldo").map((q) => ({
    q,
    texto: textoRespuestaEmpleo(q, perfil, regionDeSlug, null, ""),
  }));

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
        descripcion={resumen.map((r) => r.texto).join(", ")}
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
        <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-5" role="group" aria-label="Filtrar por palabra">
          <FiltroPalabra href={href({ palabra: null, pag: 1 })} activa={!palabra} etiqueta="Todas" n={todas.data?.total} />
          {perfil.palabras.map((w) => (
            <FiltroPalabra key={w} href={href({ palabra: w, pag: 1 })} activa={palabra === w} etiqueta={w} n={todas.data?.porPalabra.find((x) => x.palabra === w)?.n} />
          ))}
        </div>
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
              texto="Cada día se publican plazas nuevas y tu alerta te avisa. Mientras, prueba con otras palabras o un sueldo mínimo más bajo en tu perfil."
              accion={<Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>Editar mi perfil</Link>}
            />
          </Caja>
        ) : (
          <>
            <ol className={cn("grid grid-cols-1 gap-3 transition-opacity duration-rapido", calce.isValidating && "opacity-60")} aria-label="Plazas para ti" aria-busy={calce.isValidating}>
              {calce.data.data.map((p) => (
                <li key={p.aviso} className="min-w-0">
                  <TarjetaPlaza p={p} base={base} ruta="/app/plaza" enApp accion={<EstrellaSeguir id={String(p.aviso)} codigo={null} titulo={puesto(p.titulo)} tipo="plaza" />} />
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

function FiltroPalabra({ href, activa, etiqueta, n }: { href: string; activa: boolean; etiqueta: string; n: number | undefined }) {
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
      {etiqueta}
      {n != null && <span className="tabular-nums text-mute">{numero(n)}</span>}
    </Link>
  );
}
