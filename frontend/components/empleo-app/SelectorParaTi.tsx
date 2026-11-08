"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine, Sparkles, UserRoundSearch } from "lucide-react";
import { Caja, VacioCaja } from "@/components/gobserva/app/Caja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { nombreRegion, qsEmpleo, type FiltrosEmpleo } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { paramsCalce, textoRespuestaEmpleo, type PerfilEmpleo } from "@/lib/empleo-app/entrevista";
import { cn } from "@/lib/utils";
import { useCalceEmpleo, usePerfilEmpleo } from "./usePerfilEmpleo";

const LISTA = "/app/plazas";
const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

/** Los filtros de la lista con tu perfil puesto: tus carreras y puestos, tus estudios, experiencia, región y sueldo. */
export function filtrosConPerfil(f: FiltrosEmpleo, p: PerfilEmpleo): FiltrosEmpleo {
  const q = paramsCalce(p);
  return {
    q: f.q,
    cierra: f.cierra,
    senal: f.senal,
    entidad: f.entidad,
    carreras: q.get("carreras") ?? undefined,
    palabras: q.get("palabras") ?? undefined,
    region: p.region ?? undefined,
    tengo: p.tengo ?? undefined,
    sueldo: p.sueldo ?? undefined,
    exp: p.exp ?? undefined,
    para: "ti",
    orden: "calce",
  };
}

/** Los filtros sin el perfil: se quitan las carreras y puestos, y los filtros que vinieron del perfil (si siguen igual). */
export function filtrosSinPerfil(f: FiltrosEmpleo, p: PerfilEmpleo | null): FiltrosEmpleo {
  const igual = <K extends "region" | "tengo" | "sueldo" | "exp">(k: K) => (p && (p[k] ?? undefined) === f[k] ? undefined : f[k]);
  return {
    ...f,
    carreras: undefined,
    palabras: undefined,
    para: undefined,
    orden: f.orden === "calce" ? undefined : f.orden,
    region: igual("region"),
    tengo: igual("tengo") as FiltrosEmpleo["tengo"],
    sueldo: igual("sueldo"),
    exp: igual("exp"),
    page: undefined,
  };
}

/** El perfil en una frase: «Contabilidad, título profesional, hasta 2 años de experiencia, en Lima». */
function frasePerfil(p: PerfilEmpleo): string {
  const partes: string[] = [];
  if (p.carreras.length) partes.push(textoRespuestaEmpleo("carrera", p, regionDeSlug, false));
  else if (p.palabras.length) partes.push(p.palabras.slice(0, 3).join(", "));
  if (p.tengo) partes.push(textoRespuestaEmpleo("estudios", p, regionDeSlug, false).toLowerCase());
  if (p.exp != null) partes.push(textoRespuestaEmpleo("experiencia", p, regionDeSlug, false).toLowerCase());
  if (p.region) partes.push(`en ${regionDeSlug(p.region)}`);
  return partes.join(", ");
}

const OPCION =
  "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-dato font-semibold transition-colors duration-rapido";

/**
 * «Para ti» como filtro de la lista de plazas (2026-11-08, el usuario: «Para ti no tiene sentido, puede ser un botón de
 * filtro y ya»). Dos opciones arriba de la lista: «Todas» y «Para ti» (con cuántas calzan). «Para ti» pone tu perfil (la
 * búsqueda «Mi perfil» de la cuenta) como filtros en la URL y ordena por las más afines; «Todas» lo quita. Con el perfil
 * puesto dice cuál es y cómo editarlo. Sin perfil, «Para ti» lleva a armarlo.
 */
export function SelectorParaTi({ base, filtros, total }: { base: string; filtros: FiltrosEmpleo; total: number | null }) {
  const { perfil, cargando } = usePerfilEmpleo();
  const activo = !!(filtros.carreras || filtros.palabras);
  // Cuántas calzan con el perfil entero (con el filtro puesto, el total de la lista ya lo dice).
  const conteo = useCalceEmpleo(activo ? null : perfil, { size: 1 });
  const nParaTi = activo ? total : (conteo.data?.total ?? null);
  const lista = rutaEn(base, LISTA);
  const hrefTodas = `${lista}${qsEmpleo(filtrosSinPerfil(filtros, perfil))}`;
  const hrefParaTi = perfil ? `${lista}${qsEmpleo(filtrosConPerfil(filtros, perfil))}` : rutaEn(base, "/app/bienvenida");

  return (
    <div className="min-w-0">
      <div role="group" aria-label="Qué plazas ver" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ink/[0.06] p-1 [scrollbar-width:none]">
        <Link href={hrefTodas} aria-pressed={!activo} className={cn(OPCION, !activo ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink")}>
          Todas{!activo && total != null ? <span className="tabular-nums text-mute">{numero(total)}</span> : null}
        </Link>
        <Link
          href={hrefParaTi}
          aria-pressed={activo}
          className={cn(OPCION, activo ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink")}
        >
          <Sparkles size={15} aria-hidden className="text-granate" /> Para ti
          {cargando && !activo ? (
            <Loader2 size={13} aria-hidden className="animate-spin text-mute" />
          ) : nParaTi != null ? (
            <span className={cn("rounded-full px-1.5 text-rotulo tabular-nums", activo ? "bg-granate-50 text-granate" : "bg-ink/[0.06] text-mute")}>{numero(nParaTi)}</span>
          ) : null}
          {!perfil && !cargando && <span className="sr-only"> (arma tu perfil)</span>}
        </Link>
      </div>
      {activo && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
          <span className="min-w-0">
            {perfil ? (
              <>
                Con tu perfil: <b className="font-semibold text-ink">{frasePerfil(perfil)}</b>. Las más afines primero.
              </>
            ) : (
              "Con tu perfil. Las más afines primero."
            )}
          </span>
          <Link href={rutaEn(base, "/app/bienvenida")} className="inline-flex min-h-9 items-center gap-1 font-semibold text-granate underline-offset-4 hover:underline">
            <PencilLine size={13} aria-hidden /> Editar mi perfil
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * La lista con `?para=ti` pero sin el perfil en la URL (los enlaces de antes a /app/para-ti, la entrevista, el inicio):
 * al leer el perfil, la URL se reemplaza por la de «Para ti» con sus filtros. Sin perfil, invita a armarlo.
 */
export function AplicarPerfil({ base, filtros }: { base: string; filtros: FiltrosEmpleo }) {
  const { perfil, cargando, error } = usePerfilEmpleo();
  const router = useRouter();
  useEffect(() => {
    if (perfil) router.replace(`${rutaEn(base, LISTA)}${qsEmpleo(filtrosConPerfil(filtros, perfil))}`);
  }, [perfil, base, filtros, router]);
  if (cargando || perfil) {
    return (
      <div className="mt-4 grid gap-3" aria-busy="true" aria-label="Leyendo tu perfil">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-28 animate-pulse rounded-2xl bg-ink/[0.05]" />
        ))}
      </div>
    );
  }
  return (
    <Caja className="mt-4" id="perfil">
      <VacioCaja
        Icono={UserRoundSearch}
        titulo={error ? "No pudimos leer tu perfil" : "Arma tu perfil para ver las plazas para ti"}
        texto="Sube tu CV o responde unas preguntas rápidas (tu carrera, tus estudios, tu experiencia, dónde y desde qué sueldo) y aquí verás las plazas a las que puedes postular, las más afines primero."
        accion={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={rutaEn(base, "/app/bienvenida")} className={claseAccion("primario")}>
              <Sparkles size={15} aria-hidden /> Armar mi perfil
            </Link>
            <Link href={rutaEn(base, LISTA)} className={claseAccion("secundario")}>
              Ver todas las plazas
            </Link>
          </div>
        }
      />
    </Caja>
  );
}
