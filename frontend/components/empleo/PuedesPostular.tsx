"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Award, BadgeCheck, BookOpen, Briefcase, CheckCircle2, CircleDashed, GraduationCap, ListChecks, MapPin, PencilLine, ScrollText, Sparkles,
  UserRoundSearch, Wallet, XCircle, type LucideIcon,
} from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { usePerfilEmpleo } from "@/components/empleo-app/usePerfilEmpleo";
import { RUTA_PARA_TI, nombreRegion } from "@/lib/empleo";
import { juzgar, requisitosDeServir, veredicto, type EstadoRequisito, type Juicio, type TipoRequisito } from "@/lib/empleo-app/cumplo";
import type { PerfilEmpleo } from "@/lib/empleo-app/entrevista";
import { soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { useBasesPlaza, useResumenPlaza } from "./datosPlaza";

export interface PlazaParaCumplir {
  aviso: number;
  formacion: string | null;
  experiencia: string | null;
  especializacion: string | null;
  conocimiento: string | null;
  expGeneral: number | null;
  /** La región de la plaza como la URL («la-libertad»). */
  region: string | null;
  remuneracion: number | null;
}

const GRUPOS: { tipo: TipoRequisito; titulo: string; Icono: LucideIcon }[] = [
  { tipo: "formacion", titulo: "Estudios", Icono: GraduationCap },
  { tipo: "experiencia", titulo: "Experiencia", Icono: Briefcase },
  { tipo: "curso", titulo: "Cursos y especialización", Icono: Award },
  { tipo: "conocimiento", titulo: "Conocimientos", Icono: BookOpen },
  { tipo: "otro", titulo: "Además", Icono: ListChecks },
  { tipo: "bases", titulo: "Además, según las bases", Icono: ScrollText },
];

const regionDeSlug = (slug: string) => nombreRegion(slug.replace(/-/g, " ").toUpperCase());

/** Lo marcado en esta plaza («lo tengo»), en este navegador. */
function useMarcados(aviso: number) {
  const clave = `gobserva-empleo:cumplo:${aviso}`;
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(clave) ?? "[]");
      if (Array.isArray(v)) setMarcados(new Set(v.filter((x) => typeof x === "string")));
    } catch {
      /* sin almacenamiento, se marca igual sin recordar */
    }
  }, [clave]);
  const alternar = (k: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      try {
        window.localStorage.setItem(clave, JSON.stringify([...n]));
      } catch {
        /* igual */
      }
      return n;
    });
  return { marcados, alternar };
}

/**
 * «¿Puedes postular?» (2026-11-08, el usuario: «sin saber si cumples o no»): lo primero de la ficha. Cada requisito
 * (los de «Lo esencial», o los del aviso si la IA no los leyó) contra tu perfil: lo que tu perfil prueba, lo que lo
 * descarta y lo que sólo tú sabes (se marca). Arriba el veredicto en una frase con por qué, la región y el sueldo
 * contra lo que buscas; abajo lo que suele dejar fuera a la gente y las competencias de la entrevista.
 */
export function PuedesPostular({ base, plaza, cerrada }: { base: string; plaza: PlazaParaCumplir; cerrada: boolean }) {
  const { perfil, cargando } = usePerfilEmpleo();
  const resumen = useResumenPlaza(plaza.aviso);
  const bases = useBasesPlaza(plaza.aviso);
  const { marcados, alternar } = useMarcados(plaza.aviso);
  const listo = !cargando && !resumen.isLoading;
  // Los del aviso (ordenados por la IA, o tal cual) y, cuando llegan, lo que las bases piden además.
  const extra = bases.data?.estado === "encontradas" ? (bases.data.lectura?.requisitos_extra ?? []) : [];
  const requisitos = useMemo(
    () => [
      ...(resumen.data?.requisitos?.length ? resumen.data.requisitos : requisitosDeServir(plaza)),
      ...extra.map((que) => ({ que, tipo: "bases" as const })),
    ],
    [resumen.data, plaza, extra.join("|")],
  );
  const juicios = useMemo(() => juzgar(requisitos, perfil, { expGeneral: plaza.expGeneral }), [requisitos, perfil, plaza.expGeneral]);
  const v = veredicto(juicios, marcados);
  const editar = rutaEn(base, "/app/bienvenida");

  return (
    <Caja
      id="cumples"
      titulo="¿Puedes postular?"
      accion={
        perfil ? (
          <Link href={editar} className="inline-flex min-h-9 items-center gap-1.5 text-meta font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            <PencilLine size={13} aria-hidden /> Editar mi perfil
          </Link>
        ) : undefined
      }
    >
      {!listo ? (
        <div aria-busy="true" aria-label="Revisando los requisitos">
          <p className="flex items-center gap-2 text-meta text-inkSoft">
            <Sparkles size={14} aria-hidden className="animate-pulse text-granate" /> Revisando los requisitos contra tu perfil…
          </p>
          <span aria-hidden className="mt-3 block h-24 animate-pulse rounded-xl bg-ink/[0.05]" />
          <div aria-hidden className="mt-3 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="block h-10 animate-pulse rounded-lg bg-ink/[0.04]" />
            ))}
          </div>
        </div>
      ) : juicios.length === 0 ? (
        <p className="text-dato leading-relaxed text-inkSoft">El aviso no trae requisitos para revisar: están en las bases de la convocatoria. Ábrelas abajo, en «Las bases».</p>
      ) : (
        <div className="space-y-5">
          <Veredicto v={v} juicios={juicios} perfil={perfil} plaza={plaza} cerrada={cerrada} editar={editar} paraTi={rutaEn(base, RUTA_PARA_TI)} />
          <div className="space-y-4">
            {GRUPOS.map((g) => {
              const filas = juicios.filter((j) => j.tipo === g.tipo);
              if (!filas.length) return null;
              return (
                <div key={g.tipo}>
                  <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
                    <g.Icono size={16} aria-hidden className="text-mute" /> {g.titulo}
                  </h3>
                  <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                    {filas.map((j) => (
                      <Fila key={j.clave} j={j} marcado={marcados.has(j.clave)} alternar={() => alternar(j.clave)} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {!!resumen.data?.ojo.length && (
            <div className="rounded-xl border border-amber/30 bg-amber-soft/40 p-4">
              <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
                <AlertTriangle size={16} aria-hidden className="text-amberTexto" /> Lo que suele dejar fuera a la gente
              </h3>
              <ul className="mt-2 space-y-1.5">
                {resumen.data.ojo.map((o) => (
                  <li key={o} className="text-dato leading-relaxed text-inkSoft">{o}</li>
                ))}
              </ul>
            </div>
          )}
          {!!resumen.data?.competencias.length && (
            <div>
              <h3 className="text-cuerpo font-semibold text-ink">En la entrevista evalúan</h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {resumen.data.competencias.map((c) => (
                  <li key={c} className="rounded-full border border-line bg-paper px-3 py-1 text-meta text-inkSoft">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {resumen.data && <p className="text-rotulo text-mute">Los requisitos los ordena una IA a partir del aviso de SERVIR: lo que vale es lo que dicen las bases.</p>}
        </div>
      )}
    </Caja>
  );
}

const TONO: Record<EstadoRequisito, { caja: string; texto: string; Icono: LucideIcon }> = {
  cumples: { caja: "border-moss/30 bg-moss/10", texto: "text-mossTexto", Icono: BadgeCheck },
  confirma: { caja: "border-amber/35 bg-amber-soft/45", texto: "text-amberTexto", Icono: CircleDashed },
  no: { caja: "border-crimson/30 bg-crimson-soft/60", texto: "text-crimsonTexto", Icono: XCircle },
};

function Veredicto({
  v, juicios, perfil, plaza, cerrada, editar, paraTi,
}: {
  v: ReturnType<typeof veredicto>;
  juicios: Juicio[];
  perfil: PerfilEmpleo | null;
  plaza: PlazaParaCumplir;
  cerrada: boolean;
  editar: string;
  paraTi: string;
}) {
  const t = TONO[v.estado];
  const total = juicios.length;
  const malos = juicios.filter((j) => j.estado === "no" && j.porque).map((j) => j.porque as string);
  const titulo = !perfil
    ? "Revisa los requisitos uno por uno"
    : v.estado === "no"
      ? `No cumples ${v.no === 1 ? "1 requisito" : `${v.no} requisitos`}`
      : v.estado === "confirma"
        ? "Cumples lo que dice tu perfil"
        : "Cumples todo lo que pide";
  const encaje: { ok: boolean; texto: string; Icono: LucideIcon }[] = [];
  if (perfil?.region && plaza.region)
    encaje.push(
      perfil.region === plaza.region
        ? { ok: true, texto: `En ${regionDeSlug(plaza.region)}, donde buscas`, Icono: MapPin }
        : { ok: false, texto: `En ${regionDeSlug(plaza.region)}; buscas en ${regionDeSlug(perfil.region)}`, Icono: MapPin },
    );
  if (perfil?.sueldo != null && plaza.remuneracion)
    encaje.push(
      plaza.remuneracion >= perfil.sueldo
        ? { ok: true, texto: `Paga lo que buscas (desde ${soles(perfil.sueldo)})`, Icono: Wallet }
        : { ok: false, texto: `Paga menos de lo que buscas (desde ${soles(perfil.sueldo)})`, Icono: Wallet },
    );

  return (
    <div className={cn("rounded-xl border p-4 sm:p-5", t.caja)}>
      <div className="flex items-start gap-3">
        <t.Icono size={26} aria-hidden className={cn("mt-0.5 shrink-0", t.texto)} />
        <div className="min-w-0 flex-1">
          <p className="text-pretty font-display text-bloque font-bold leading-snug text-ink" aria-live="polite">{titulo}</p>
          {!perfil ? (
            <p className="mt-1 text-pretty text-dato leading-relaxed text-inkSoft">
              Marca lo que ya tienes. Con tu perfil (tu carrera, tus estudios y tus años de experiencia) te decimos al toque qué cumples y qué no.
            </p>
          ) : v.estado === "no" ? (
            <ul className="mt-1.5 space-y-1">
              {malos.map((m) => (
                <li key={m} className="flex items-start gap-2 text-dato leading-snug text-ink">
                  <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-crimsonTexto" />
                  <span className="min-w-0">{m}.</span>
                </li>
              ))}
            </ul>
          ) : v.estado === "confirma" ? (
            <p className="mt-1 text-pretty text-dato leading-relaxed text-inkSoft">
              {v.confirma === 1 ? "Te falta confirmar 1 cosa que sólo tú sabes" : `Te faltan confirmar ${v.confirma} cosas que sólo tú sabes`}: márcalas abajo si las tienes.
            </p>
          ) : (
            <p className="mt-1 text-pretty text-dato leading-relaxed text-inkSoft">
              {cerrada ? "Pero esta plaza ya cerró." : "Ahora prepara tus documentos y postula a tiempo: los pasos están abajo."}
            </p>
          )}
          {encaje.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {encaje.map((e) => (
                <li
                  key={e.texto}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium",
                    e.ok ? "bg-caja/80 text-inkSoft" : "bg-amber-soft text-amberTexto",
                  )}
                >
                  <e.Icono size={13} aria-hidden className="shrink-0" /> <span className="min-w-0">{e.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cuánto cumples: verde lo que cumples, ámbar lo que falta confirmar, rojo lo que no. */}
      <div className="mt-4">
        <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-caja/70">
          {v.cumples > 0 && <span className="h-full rounded-full bg-moss" style={{ width: `${(v.cumples / total) * 100}%` }} />}
          {v.confirma > 0 && <span className="h-full rounded-full bg-amber" style={{ width: `${(v.confirma / total) * 100}%` }} />}
          {v.no > 0 && <span className="h-full rounded-full bg-crimson" style={{ width: `${(v.no / total) * 100}%` }} />}
        </span>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <span>
            <b className="font-semibold tabular-nums text-ink">{v.cumples}</b> de {total} cumples
          </span>
          {v.confirma > 0 && (
            <span>
              <b className="font-semibold tabular-nums text-ink">{v.confirma}</b> por confirmar
            </span>
          )}
          {v.no > 0 && (
            <span>
              <b className="font-semibold tabular-nums text-ink">{v.no}</b> no cumples
            </span>
          )}
        </p>
      </div>

      {(!perfil || v.estado === "no") && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!perfil ? (
            <Link href={editar} className={claseAccion("primario")}>
              <UserRoundSearch size={15} aria-hidden /> Armar mi perfil
            </Link>
          ) : (
            <>
              <Link href={paraTi} className={claseAccion("primario")}>
                Ver plazas que calzan contigo <ArrowRight size={15} aria-hidden />
              </Link>
              <Link href={editar} className={claseAccion("secundario")}>
                <PencilLine size={15} aria-hidden /> Mi perfil está desactualizado
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Fila({ j, marcado, alternar }: { j: Juicio; marcado: boolean; alternar: () => void }) {
  if (j.estado === "confirma") {
    return (
      <li>
        <button
          type="button"
          role="checkbox"
          aria-checked={marcado}
          onClick={alternar}
          className="grid min-h-12 w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
        >
          {marcado ? (
            <CheckCircle2 size={20} aria-hidden className="text-mossTexto" />
          ) : (
            <span aria-hidden className="mt-px block h-5 w-5 rounded-md border-2 border-amberTexto/70 bg-caja" />
          )}
          <span className="min-w-0">
            <span className={cn("block text-dato leading-snug", marcado ? "text-inkSoft" : "text-ink")}>{j.que}</span>
            {j.porque && <span className="mt-1 block text-meta leading-snug text-amberTexto">{j.porque}.</span>}
          </span>
          <span className={cn("mt-px shrink-0 rounded-full px-2 py-0.5 text-rotulo font-semibold", marcado ? "bg-moss/15 text-mossTexto" : "bg-amber-soft text-amberTexto")}>
            {marcado ? "Lo tienes" : "¿Lo tienes?"}
          </span>
        </button>
      </li>
    );
  }
  const t = TONO[j.estado];
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-3 px-3.5 py-3">
      {j.estado === "cumples" ? <CheckCircle2 size={20} aria-hidden className="text-mossTexto" /> : <XCircle size={20} aria-hidden className="text-crimsonTexto" />}
      <span className="min-w-0">
        <span className="sr-only">{j.estado === "cumples" ? "Cumples: " : "No cumples: "}</span>
        <span className="block text-dato leading-snug text-ink">{j.que}</span>
        {j.porque && <span className={cn("mt-1 block text-meta font-medium leading-snug", t.texto)}>{j.porque}.</span>}
      </span>
    </li>
  );
}
