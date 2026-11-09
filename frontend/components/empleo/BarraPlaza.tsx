"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, BadgeCheck, CircleDashed, Clock, Lock, Sparkles, XCircle, type LucideIcon } from "lucide-react";
import { SeguirConEtapa } from "@/components/licitaciones-app/seguimiento/BotonSeguir";
import { Insignia } from "@/components/licitaciones-app/ui/Insignia";
import { diasParaCierre, fechaDia, textoCierre } from "@/lib/empleo";
import { cn } from "@/lib/utils";
import { useBasesPlaza } from "./datosPlaza";
import { Pastilla } from "./FichaPlaza";
import { cuandoEs, useCumplo, useFechaPostular, type PlazaParaCumplir, type TonoFecha } from "./usePlaza";
import { BotonVerBases } from "./VisorBases";

const CLASE_BOTON =
  "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20";

const CHIP = {
  no: "bg-crimson-soft text-crimsonTexto",
  confirma: "bg-amber-soft text-amberTexto",
  cumples: "bg-moss/15 text-mossTexto",
  urgente: "bg-crimson-soft text-crimsonTexto",
  aviso: "bg-amber-soft text-amberTexto",
  neutro: "bg-ink/[0.06] text-inkSoft",
  pasado: "bg-ink/[0.04] text-mute",
};

/**
 * La barra fija de la ficha de una plaza: lo que decide si postulas, siempre a la vista. Cuánto cumples (lleva a
 * «¿Cumples?»), cuándo se postula (lleva a «Cómo postular») y las acciones: postular, ver las bases, guardar y copiar.
 * Al bajar, cuando el título se va, aparece aquí en corto.
 */
export function BarraPlaza({
  plaza, titulo, entidad, fechaFin, cerrada, postular, servir,
}: {
  plaza: PlazaParaCumplir;
  titulo: string;
  entidad: string;
  fechaFin: string | null;
  cerrada: boolean;
  /** La convocatoria en la web de la entidad (de SERVIR); sin ella, SERVIR. */
  postular: string | null;
  servir: string;
}) {
  const [corto, setCorto] = useState(false);
  useEffect(() => {
    const el = document.getElementById("titulo-plaza");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCorto(!e.isIntersecting && e.boundingClientRect.top < 64), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {corto && (
          <div className="hidden min-w-0 max-w-[26rem] shrink md:block">
            <p className="truncate text-dato font-semibold leading-snug text-ink" title={titulo}>{titulo}</p>
            <p className="truncate text-meta leading-snug text-inkSoft" title={entidad}>{entidad}</p>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ChipCumplo plaza={plaza} />
          {/* Con el título en la barra, la fecha queda en la cabecera y en «Cómo postular» hasta que haya espacio. */}
          <span className={corto ? "contents md:hidden 2xl:contents" : "contents"}>
            <ChipFecha aviso={plaza.aviso} fechaFin={fechaFin} cerrada={cerrada} />
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!cerrada && (
          <a
            href={postular ?? servir}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-granate px-3.5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
          >
            <span className="xl:hidden">{postular ? "Postular" : "SERVIR"}</span>
            <span className="hidden xl:inline">{postular ? "Postular en la entidad" : "Verla en SERVIR"}</span>
            <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        )}
        <span className="hidden sm:contents">
          <BotonVerBases aviso={plaza.aviso} className={CLASE_BOTON} />
          <SeguirConEtapa id={String(plaza.aviso)} codigo={null} titulo={titulo} tipo="plaza" />
        </span>
      </div>
    </div>
  );
}

/** Las acciones que en el celular no caben en la barra: bajo el título, y no se pegan. */
export function AccionesPlaza({ aviso, titulo }: { aviso: number; titulo: string }) {
  return (
    <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 sm:hidden">
      <BotonVerBases aviso={aviso} className={CLASE_BOTON} />
      <SeguirConEtapa id={String(aviso)} codigo={null} titulo={titulo} tipo="plaza" />
    </div>
  );
}

function Chip({ href, clase, Icono, largo, corto, pulso }: { href: string; clase: string; Icono: LucideIcon; largo: string; corto?: string; pulso?: boolean }) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 text-meta font-semibold transition-opacity duration-rapido hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
        clase,
      )}
    >
      <Icono size={14} aria-hidden className={cn("shrink-0", pulso && "animate-pulse")} />
      {corto ? (
        <>
          <span className="truncate xl:hidden">{corto}</span>
          <span className="hidden truncate xl:inline">{largo}</span>
        </>
      ) : (
        <span className="truncate">{largo}</span>
      )}
    </a>
  );
}

/** Cuánto cumples, en corto: «No cumples 6 requisitos», «Te falta confirmar 2», «Cumples todo lo que pide». */
function ChipCumplo({ plaza }: { plaza: PlazaParaCumplir }) {
  const { perfil, listo, juicios, v } = useCumplo(plaza);
  if (!listo) return <Chip href="#cumples" clase={CHIP.neutro} Icono={Sparkles} largo="Revisando los requisitos…" corto="Revisando…" pulso />;
  if (!juicios.length) return <Chip href="#bases" clase={CHIP.neutro} Icono={CircleDashed} largo="Los requisitos están en las bases" corto="Ver requisitos" />;
  if (!perfil) return <Chip href="#cumples" clase={CHIP.neutro} Icono={CircleDashed} largo="¿Cumples? Revisa los requisitos" corto="¿Cumples?" />;
  if (v.estado === "no")
    return <Chip href="#cumples" clase={CHIP.no} Icono={XCircle} largo={`No cumples ${v.no === 1 ? "1 requisito" : `${v.no} requisitos`}`} corto={`No cumples ${v.no}`} />;
  if (v.estado === "confirma")
    return <Chip href="#cumples" clase={CHIP.confirma} Icono={CircleDashed} largo={`Te falta confirmar ${v.confirma === 1 ? "1 requisito" : `${v.confirma} requisitos`}`} corto={`Confirma ${v.confirma}`} />;
  return <Chip href="#cumples" clase={CHIP.cumples} Icono={BadgeCheck} largo="Cumples todo lo que pide" corto="Cumples" />;
}

/** Cuándo se postula, con la fecha de las bases si las leímos: «Abre en 11 días», «Cierra mañana», «Ya cerró». */
function ChipFecha({ aviso, fechaFin, cerrada }: { aviso: number; fechaFin: string | null; cerrada: boolean }) {
  const f = useFechaPostular(aviso, fechaFin);
  if (cerrada) return <Chip href="#postular" clase={CHIP.pasado} Icono={Lock} largo="Ya cerró" />;
  if (!f.hoy || !f.hasta) return null;
  const c = f.abre && f.desde ? cuandoEs(f.desde, f.hoy, "abre") : cuandoEs(f.hasta, f.hoy, "cierra");
  const cuando = fechaDia(f.abre && f.desde ? f.desde : f.hasta);
  return <Chip href="#postular" clase={CHIP[c.tono]} Icono={Clock} largo={`${c.texto} (${cuando})`} corto={c.texto} />;
}

/** La cifra «Cierra la postulación» de la cabecera, con la fecha de las bases cuando no es la de SERVIR. */
export function CifraCierre({ aviso, fechaFin, cerrada }: { aviso: number; fechaFin: string | null; cerrada: boolean }) {
  const f = useFechaPostular(aviso, fechaFin);
  const abre = !cerrada && f.abre && !!f.desde;
  const fecha = cerrada ? fechaFin : abre ? f.desde : f.hasta;
  const c: { texto: string; tono: TonoFecha } | null =
    f.hoy && fecha && !cerrada ? cuandoEs(fecha, f.hoy, abre ? "abre" : "cierra") : null;
  const dias = diasParaCierre(fechaFin);
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="text-meta font-semibold text-inkSoft">{abre ? "Se postula" : "Cierra la postulación"}</dt>
      <dd className={cn("mt-2 font-display text-bloque font-bold leading-tight tabular-nums sm:text-seccion", cerrada ? "text-inkSoft" : "text-ink")}>
        {fecha ? fechaDia(fecha) : "Sin fecha"}
      </dd>
      <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {cerrada ? (
          <span className="text-meta text-mute">Ya no recibe postulaciones</span>
        ) : (
          <Insignia tono={c?.tono === "urgente" ? "urgente" : c?.tono === "aviso" ? "aviso" : "neutro"} Icono={Clock}>
            {c?.texto ?? textoCierre(dias)}
          </Insignia>
        )}
        {!cerrada && f.deBases && <span className="text-rotulo text-mute">{f.difiere && fechaFin ? `Según las bases; SERVIR dice ${fechaDia(fechaFin)}` : "Según las bases"}</span>}
      </dd>
    </div>
  );
}

/** Al lado de «¿Cumples?»: cuántos no cumples (rojo), cuántos confirmar (ámbar) o un visto. */
export function CuentaCumplo({ plaza }: { plaza: PlazaParaCumplir }) {
  const { perfil, listo, juicios, v } = useCumplo(plaza);
  if (!listo || !perfil || !juicios.length) return null;
  if (v.estado === "no") return <Pastilla tono="no" etiqueta="que no cumples">{v.no}</Pastilla>;
  if (v.estado === "confirma") return <Pastilla tono="confirma" etiqueta="por confirmar">{v.confirma}</Pastilla>;
  return (
    <Pastilla tono="cumples" etiqueta="cumples todo">
      <BadgeCheck size={12} aria-hidden />
    </Pastilla>
  );
}

/** Al lado de «Bases»: cuántos documentos encontramos. */
export function CuentaBases({ aviso }: { aviso: number }) {
  const { data } = useBasesPlaza(aviso);
  const n = data?.estado === "encontradas" ? data.documentos.length : 0;
  return n ? <Pastilla etiqueta={n === 1 ? "documento" : "documentos"}>{n}</Pastilla> : null;
}
