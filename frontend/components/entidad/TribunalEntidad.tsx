/**
 * Los procesos de la entidad ante el Tribunal de Contrataciones (API GET /entidades/:ruc/tribunal; migraciones 402-403):
 * cuántas apelaciones resolvió, cuántas fueron fundadas o terminaron en la nulidad del procedimiento (su comité se
 * equivocó o el proceso tenía un vicio) y las más recientes, cada una con su resolución y su contrato. Sólo las ya leídas
 * y unidas a un contrato: las resoluciones se bajan cada hora y la cobertura crece. Server component; sin datos, nada.
 *
 * 2026-11-23 (el usuario: «secciones que son solo texto»): antes eran tres párrafos seguidos y diez resoluciones como
 * fichas de cuatro renglones (Resultado, Fecha, Por qué, El proceso), unas 3,000 px de texto. Ahora cada parte dibuja la
 * forma de su dato: lo que resolvió con su cifra grande y sus barras, la entidad frente al resto del país en dos barras
 * con su veredicto, los procesos corregidos dos veces y las empresas con un sancionador abierto como tarjetas con su
 * monto, y las resoluciones como filas con su resultado en pastilla (el porqué se abre en la fila; cuatro a la vista).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Gavel, Repeat, ShieldAlert } from "lucide-react";
import { FuenteDato, Seccion } from "@/components/patrones";
import { API_BASE } from "@/lib/api-client";
import { fechaConAnio, numero, oracion, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";

interface Reciente {
  titulo: string;
  fecha: string | null;
  resultado: string | null;
  motivo: string | null;
  enlace: string;
  ocid: string | null;
  codigo: string | null;
}
interface TribunalDeEntidad {
  apelaciones: number;
  fundadas: number;
  nulidades: number;
  recientes: Reciente[];
  /** Frente al resto del país (migración 422): procesos apelables corregidos, la tasa del resto, cuántas veces más, la
   * probabilidad de azar y si destaca (falsos descubrimientos al 10 % sobre todas las entidades). */
  comparacion?: { procesos: number; corregidos: number; tasa: number; tasaResto: number; veces: number | null; pValor: number; destacada: boolean } | null;
  /** Lo que adjudicó a empresas con un sancionador del Tribunal abierto (migración 424). */
  conSancionadorAbierto?: { procesos: number; empresas: number; monto: number | null; principales: { ruc: string; nombre: string | null; procesos: number; monto: number | null }[] } | null;
  /** Procesos que el Tribunal corrigió y, cuando la entidad volvió a decidir, corrigió otra vez (migración 434). */
  corregidosOtraVez?: { procesos: number; recientes: { ocid: string; codigo: string | null; rondas: number; correcciones: number; ultima: string }[] } | null;
}

/** Cada resultado en su pastilla: rojo si el Tribunal corrigió a la entidad, verde si le dio la razón, gris si no resolvió el fondo. */
const RESULTADO: Record<string, { texto: string; tono: "mal" | "bien" | "neutro" }> = {
  fundado: { texto: "Fundada", tono: "mal" },
  fundado_en_parte: { texto: "Fundada en parte", tono: "mal" },
  nulidad_de_oficio: { texto: "Nulidad", tono: "mal" },
  infundado: { texto: "Infundada", tono: "bien" },
  improcedente: { texto: "Improcedente", tono: "neutro" },
  desistimiento: { texto: "Desistimiento", tono: "neutro" },
  otro: { texto: "Resuelta", tono: "neutro" },
};
const TONO_PASTILLA = {
  mal: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  bien: "border-moss/30 bg-moss/10 text-mossTexto",
  neutro: "border-line bg-paperSoft text-inkSoft",
} as const;

/** Las resoluciones a la vista; las demás, plegadas debajo. */
const A_LA_VISTA = 4;

async function leer(ruc: string): Promise<TribunalDeEntidad | null> {
  try {
    const r = await fetch(`${API_BASE}/entidades/${ruc}/tribunal`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as TribunalDeEntidad) : null;
  } catch {
    return null;
  }
}

/** «Pct» con coma decimal: 0,8 %, 12 %. */
const pct = (x: number) => { const p = 100 * x; return `${p < 10 ? p.toFixed(1).replace(".", ",") : String(Math.round(p))} %`; };

/** Una barra de «parte de un todo», con su cifra a la derecha y una línea que dice qué es. */
function BarraParte({ etiqueta, parte, de, explica, tono }: { etiqueta: string; parte: number; de: number; explica: string; tono: "crimson" | "amber" }) {
  const p = de > 0 ? Math.min(1, parte / de) : 0;
  return (
    <li>
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-dato font-semibold text-ink">{etiqueta}</span>
        <span className="shrink-0 text-meta tabular-nums text-inkSoft">
          <b className="font-display text-bloque font-bold text-ink">{numero(parte)}</b> de {numero(de)}
        </span>
      </p>
      <span aria-hidden className={cn("mt-1.5 block h-2 overflow-hidden rounded-full", tono === "crimson" ? "bg-crimson/15" : "bg-amber/20")}>
        <span className={cn("gs-barra-crece block h-full rounded-full", tono === "crimson" ? "bg-crimson" : "bg-amber")} style={{ width: `${Math.max(parte > 0 ? 4 : 0, Math.round(p * 100))}%` }} />
      </span>
      <span className="mt-1 block text-meta text-mute">{explica}</span>
    </li>
  );
}

/** Lo que resolvió: la cifra grande y, debajo, cuántas fueron fundadas y cuántas anularon el procedimiento. */
function LoResuelto({ d }: { d: TribunalDeEntidad }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-paper p-4">
      <p className="flex items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate-50 text-granate ring-1 ring-granate/25">
          <Gavel size={18} />
        </span>
        <span>
          <span className="block font-display text-cifra font-bold leading-none tabular-nums text-ink">{numero(d.apelaciones)}</span>
          <span className="mt-1 block text-meta text-inkSoft">{d.apelaciones === 1 ? "apelación resuelta y leída" : "apelaciones resueltas y leídas"}</span>
        </span>
      </p>
      <ul className="mt-4 space-y-3">
        <BarraParte etiqueta="Fundadas" parte={d.fundadas} de={d.apelaciones} explica="El comité se equivocó al calificar o al otorgar" tono="crimson" />
        <BarraParte etiqueta="Nulidades" parte={d.nulidades} de={d.apelaciones} explica="El Tribunal anuló el procedimiento" tono="amber" />
      </ul>
    </div>
  );
}

/**
 * Sus procesos corregidos por el Tribunal frente al resto del país, en dos barras. Sólo se afirma un exceso si pasa el
 * control de falsos descubrimientos (destacada); si no, se dan las cifras sin juicio. Con pocos procesos apelables, nada.
 */
function FrenteAlPais({ c }: { c?: TribunalDeEntidad["comparacion"] }) {
  if (!c || c.procesos < 10) return null;
  const tope = Math.max(c.tasa, c.tasaResto) || 1;
  const filas = [
    { nombre: "Esta entidad", tasa: c.tasa, detalle: `${numero(c.corregidos)} de ${numero(c.procesos)}`, fuerte: true },
    { nombre: "Resto del país", tasa: c.tasaResto, detalle: null, fuerte: false },
  ];
  return (
    <div className="min-w-0 rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-bloque font-bold text-ink">Frente al resto del país</h4>
        {c.destacada ? (
          <span className="pill border-crimson/30 bg-crimson-soft font-semibold text-crimsonTexto">
            {c.veces != null ? `${c.veces.toFixed(1).replace(".", ",")} veces más` : "Más que el resto"}
          </span>
        ) : (
          <span className="pill border-line bg-paperSoft font-semibold text-inkSoft">Puede ser azar</span>
        )}
      </div>
      <ul className="mt-3 space-y-3" aria-label="Procesos corregidos por el Tribunal">
        {filas.map((f) => (
          <li key={f.nombre}>
            <p className="flex items-baseline justify-between gap-3">
              <span className={cn("text-dato", f.fuerte ? "font-semibold text-ink" : "text-inkSoft")}>{f.nombre}</span>
              <span className="shrink-0 text-meta tabular-nums text-inkSoft">
                <b className={cn("font-display text-bloque font-bold", f.fuerte ? "text-ink" : "text-inkSoft")}>{pct(f.tasa)}</b>
                {f.detalle ? <span className="ml-1.5">{f.detalle}</span> : null}
              </span>
            </p>
            <span aria-hidden className="mt-1.5 block h-2 overflow-hidden rounded-full bg-paperDeep">
              <span
                className={cn("gs-barra-crece block h-full rounded-full", f.fuerte ? (c.destacada ? "bg-crimson" : "bg-granate") : "bg-mute/60")}
                style={{ width: `${Math.max(3, Math.round((100 * f.tasa) / tope))}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-meta leading-relaxed text-inkSoft">
        Procesos corregidos de sus licitaciones, concursos y adjudicaciones simplificadas desde 2024.{" "}
        {c.destacada ? "No se explica por azar: sus comités se equivocan, o sus procesos tienen vicios, más que en otras entidades." : "La diferencia no basta para descartar el azar."}{" "}
        <span className="text-mute">Todavía se leen resoluciones: la cifra puede cambiar.</span>
      </p>
    </div>
  );
}

/** Una tarjeta de alerta: su ícono, la cifra grande, una frase y lo suyo debajo. */
function TarjetaAlerta({
  icono,
  tono,
  cifra,
  sobre,
  frase,
  children,
}: {
  icono: ReactNode;
  tono: "crimson" | "amber";
  cifra: string;
  sobre: string;
  frase: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-paper p-4">
      <p className="flex items-center gap-3">
        <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", tono === "crimson" ? "bg-crimson-soft text-crimsonTexto" : "bg-amber-soft text-amberTexto")}>
          {icono}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-seccion font-bold leading-none tabular-nums text-ink">{cifra}</span>
          <span className="mt-1 block text-meta text-inkSoft">{sobre}</span>
        </span>
      </p>
      <p className="mt-3 text-meta leading-relaxed text-inkSoft">{frase}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Los procesos en que el comité repitió el error después de una orden del Tribunal (o no la cumplió). */
function CorregidosOtraVez({ c }: { c?: TribunalDeEntidad["corregidosOtraVez"] }) {
  if (!c?.procesos) return null;
  return (
    <TarjetaAlerta
      icono={<Repeat size={18} />}
      tono="crimson"
      cifra={plural(c.procesos, "proceso", "procesos")}
      sobre="corregidos otra vez"
      frase={
        <>
          El Tribunal corrigió al comité y, cuando la entidad volvió a decidir, lo corrigió otra vez: el error se repitió o la orden no se cumplió.
          {c.procesos > c.recientes.length ? ` Van los ${numero(c.recientes.length)} más recientes.` : ""}
        </>
      }
    >
      <ul className="flex flex-wrap gap-2">
        {c.recientes.map((x) => (
          <li key={x.ocid}>
            <Link
              href={`/app/contratos/${encodeURIComponent(x.ocid)}`}
              prefetch={false}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-paperSoft px-2.5 text-meta transition-colors duration-rapido hover:border-granate/50"
            >
              <span className="font-mono font-semibold text-ink">{x.codigo ?? x.ocid}</span>
              <span className="rounded-full bg-crimson-soft px-1.5 text-rotulo font-semibold tabular-nums text-crimsonTexto">{plural(x.rondas, "ronda", "rondas")}</span>
              <span className="text-mute">{fechaConAnio(x.ultima)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </TarjetaAlerta>
  );
}

/**
 * Las empresas a las que la entidad adjudicó mientras tenían abierto un procedimiento sancionador que ordenó el Tribunal
 * (por documentación falsa o información inexacta en otra oferta), cada una con su monto en barra. No está prohibido; la
 * entidad pudo revisar con más cuidado los documentos de su oferta.
 */
function ConSancionadorAbierto({ s }: { s?: TribunalDeEntidad["conSancionadorAbierto"] }) {
  if (!s?.procesos) return null;
  const tope = Math.max(1, ...s.principales.map((x) => x.monto ?? 0));
  return (
    <TarjetaAlerta
      icono={<ShieldAlert size={18} />}
      tono="amber"
      cifra={s.monto ? solesCompacto(s.monto) : plural(s.procesos, "proceso", "procesos")}
      sobre={`${s.monto ? `en ${plural(s.procesos, "proceso", "procesos")} ` : ""}a ${plural(s.empresas, "empresa", "empresas")} con un sancionador abierto`}
      frase="El Tribunal había ordenado investigarlas por lo que presentaron en otra oferta. No está prohibido contratarlas, pero la entidad pudo revisar con más cuidado sus documentos."
    >
      <ul className="divide-y divide-line rounded-lg border border-line">
        {s.principales.map((x) => (
          <li key={x.ruc} className="px-3 py-2">
            <p className="flex items-baseline justify-between gap-3 text-dato">
              <Link href={`/empresa/${x.ruc}?seccion=antecedentes`} prefetch={false} className="min-w-0 truncate font-semibold text-ink underline decoration-line underline-offset-[3px] hover:text-granate hover:decoration-granate">
                {x.nombre ? tituloNatural(x.nombre) : x.ruc}
              </Link>
              <span className="shrink-0 font-mono text-meta tabular-nums text-ink">{x.monto ? solesCompacto(x.monto) : "Sin monto"}</span>
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber/15">
                <span className="gs-barra-crece block h-full rounded-full bg-amber" style={{ width: `${Math.max(4, Math.round((100 * (x.monto ?? 0)) / tope))}%` }} />
              </span>
              <span className="shrink-0 text-rotulo text-mute">{plural(x.procesos, "proceso", "procesos")}</span>
            </p>
          </li>
        ))}
      </ul>
    </TarjetaAlerta>
  );
}

/** Una resolución en una fila: su resultado en pastilla, el número, la fecha y su proceso; el porqué se abre en la fila. */
function FilaResolucion({ x }: { x: Reciente }) {
  const r = RESULTADO[x.resultado ?? "otro"] ?? RESULTADO.otro;
  const numeroRes = x.titulo.replace(/^Resoluci[oó]n\s+(N\.?\s*°?\s*)?/i, "");
  return (
    <li className="grid gap-x-4 gap-y-1.5 px-3.5 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:px-4">
      <div className="flex items-center gap-2 sm:block">
        <span className={cn("pill font-semibold", TONO_PASTILLA[r.tono])}>{r.texto}</span>
        {x.fecha ? <span className="text-meta tabular-nums text-mute sm:mt-1.5 sm:block">{fechaConAnio(x.fecha)}</span> : null}
      </div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <a href={x.enlace} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-line underline-offset-[3px] hover:text-granate hover:decoration-granate">
            <span className="text-dato">Resolución {numeroRes}</span>
            <ExternalLink size={12} aria-hidden className="shrink-0" />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
          {x.ocid ? (
            <Link href={`/app/contratos/${encodeURIComponent(x.ocid)}`} prefetch={false} className="text-meta text-inkSoft hover:text-granate">
              Proceso <span className="font-mono font-semibold text-granate">{x.codigo ?? x.ocid}</span>
            </Link>
          ) : null}
        </p>
        {x.motivo ? (
          <details className="group/porque mt-1">
            <summary className="flex cursor-pointer list-none items-start gap-1.5 text-meta leading-relaxed text-inkSoft [&::-webkit-details-marker]:hidden">
              <span className="line-clamp-2 min-w-0 flex-1 group-open/porque:line-clamp-none">{oracion(x.motivo)}</span>
              <ChevronDown size={15} aria-hidden className="mt-0.5 shrink-0 text-mute transition-transform duration-rapido group-open/porque:rotate-180" />
              <span className="sr-only">Leer el porqué entero</span>
            </summary>
          </details>
        ) : null}
      </div>
    </li>
  );
}

export async function TribunalEntidad({ ruc }: { ruc: string }) {
  const d = await leer(ruc);
  if (!d || (!d.apelaciones && !d.conSancionadorAbierto?.procesos && !d.corregidosOtraVez?.procesos)) return null;
  const conComparacion = !!d.comparacion && d.comparacion.procesos >= 10;
  const alertas = !!d.corregidosOtraVez?.procesos || !!d.conSancionadorAbierto?.procesos;
  const vista = d.recientes.slice(0, A_LA_VISTA);
  const resto = d.recientes.slice(A_LA_VISTA);
  const masEnPatrones = /^20\d{9}$/.test(ruc) && d.apelaciones > d.recientes.length;
  return (
    <Seccion
      id="tribunal-entidad"
      className="mt-5"
      titulo="Ante el Tribunal de Contrataciones"
      descripcion="Cuando un postor apela, el Tribunal dice si el comité de la entidad se equivocó."
      acciones={
        masEnPatrones ? (
          <Link href={`/app/patrones?seccion=tribunal&ruc=${ruc}`} prefetch={false} className="inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-2 hover:underline">
            Ver las {numero(d.apelaciones)} y buscar en ellas
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {d.apelaciones || conComparacion ? (
          <div className={cn("grid grid-cols-1 gap-3", d.apelaciones && conComparacion && "lg:grid-cols-2")}>
            {d.apelaciones ? <LoResuelto d={d} /> : null}
            <FrenteAlPais c={d.comparacion} />
          </div>
        ) : null}
        {alertas ? (
          <div className={cn("grid grid-cols-1 items-start gap-3", d.corregidosOtraVez?.procesos && d.conSancionadorAbierto?.procesos && "lg:grid-cols-2")}>
            <CorregidosOtraVez c={d.corregidosOtraVez} />
            <ConSancionadorAbierto s={d.conSancionadorAbierto} />
          </div>
        ) : null}
        {vista.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            <h4 className="flex items-baseline justify-between gap-3 border-b border-line bg-paperSoft px-3.5 py-2.5 sm:px-4">
              <span className="font-display text-bloque font-bold text-ink">Sus resoluciones más recientes</span>
              <span className="shrink-0 text-meta tabular-nums text-mute">{plural(d.recientes.length, "resolución", "resoluciones")}</span>
            </h4>
            <ul className="divide-y divide-line">
              {vista.map((x) => (
                <FilaResolucion key={x.enlace} x={x} />
              ))}
            </ul>
            {resto.length ? (
              <details className="group/mas border-t border-line">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 text-dato font-semibold text-ink hover:text-granate [&::-webkit-details-marker]:hidden">
                  <span className="group-open/mas:hidden">Ver {resto.length === 1 ? "la otra" : `las otras ${numero(resto.length)}`}</span>
                  <span className="hidden group-open/mas:inline">Ver menos</span>
                  <ChevronDown size={16} aria-hidden className="transition-transform duration-rapido group-open/mas:rotate-180" />
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {resto.map((x) => (
                    <FilaResolucion key={x.enlace} x={x} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
        <FuenteDato fuente="Resoluciones del Tribunal de Contrataciones en gob.pe, leídas por Vigía" />
      </div>
    </Seccion>
  );
}
