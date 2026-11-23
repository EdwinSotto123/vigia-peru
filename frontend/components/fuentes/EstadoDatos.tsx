import { AlertTriangle, Camera, CheckCircle2, ChevronDown, CirclePause, Clock, ExternalLink, Hand } from "lucide-react";
import type { ReactNode } from "react";
import { API_BASE } from "@/lib/api-client";
import { Ayuda } from "@/components/patrones";
import { fechaCorta, numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * «Cómo están hoy» (fase 5 del plan del 2026-10-27): hasta qué fecha llega cada fuente, cuándo fue su última carga buena y
 * si está al día, atrasada, con error o se carga a mano (GET /estado/datos). Para que quien lee una cifra sepa hasta
 * cuándo llega. Server component; sin respuesta de la API, no se muestra (el resto de la página es estático).
 *
 * Rehecha el 2026-11-23 (el usuario: «secciones que son solo texto»): era una tabla de 30 filas de párrafos con el estado
 * en una pastilla al fondo a la derecha. Ahora va en su tarjeta con el título adentro: arriba cuántas están al día, a mano o
 * con un problema, con su barra; después las que tienen un problema, con el porqué a la vista; y las demás en un mosaico
 * donde cada fuente se reconoce por su ícono de estado y por la fecha hasta la que llega, en grande.
 */
interface FuenteEstado {
  clave: string;
  nombre: string;
  que: string;
  cadencia: string;
  hasta: string | null;
  ultimaCarga: string | null;
  estado: "al_dia" | "atrasada" | "error" | "manual" | "fuente_vieja";
  /** Lo que el estado solo no dice: la fuente no responde, su captura está detenida, no publica o es una foto. */
  situacion?: "rota" | "parada" | "sin_novedad" | "foto" | null;
  /** Por qué, en una frase para quien lee. */
  nota?: string | null;
  /** El registro oficial. */
  enlace?: string | null;
}

/** Los tres grupos del resumen: al día, a mano (o una foto) y con un problema. */
type Grupo = "bien" | "mano" | "problema";
interface Apariencia {
  texto: string;
  icono: ReactNode;
  /** La pastilla del estado. */
  clase: string;
  /** El círculo del ícono, a la izquierda de cada fuente. */
  placa: string;
  grupo: Grupo;
}

/** La situación manda sobre el estado: una fuente que no responde no está «atrasada», está rota. */
const SITUACION: Record<NonNullable<FuenteEstado["situacion"]>, Apariencia> = {
  rota: { texto: "La fuente no responde", icono: <AlertTriangle size={15} aria-hidden />, clase: "border-crimsonTexto/40 text-crimsonTexto", placa: "bg-crimson-soft text-crimsonTexto", grupo: "problema" },
  parada: { texto: "Captura detenida", icono: <CirclePause size={15} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto", placa: "bg-amber-soft text-amberTexto", grupo: "problema" },
  sin_novedad: { texto: "La fuente no publica nada nuevo", icono: <Clock size={15} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto", placa: "bg-amber-soft text-amberTexto", grupo: "problema" },
  foto: { texto: "Foto de una fecha", icono: <Camera size={15} aria-hidden />, clase: "border-line text-inkSoft", placa: "bg-paperDeep text-inkSoft", grupo: "mano" },
};

const ESTADO: Record<FuenteEstado["estado"], Apariencia> = {
  al_dia: { texto: "Al día", icono: <CheckCircle2 size={15} aria-hidden />, clase: "border-mossTexto/30 text-mossTexto", placa: "bg-granate-50 text-mossTexto", grupo: "bien" },
  atrasada: { texto: "Atrasada", icono: <Clock size={15} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto", placa: "bg-amber-soft text-amberTexto", grupo: "problema" },
  error: { texto: "Falló la última carga", icono: <AlertTriangle size={15} aria-hidden />, clase: "border-crimsonTexto/40 text-crimsonTexto", placa: "bg-crimson-soft text-crimsonTexto", grupo: "problema" },
  manual: { texto: "Se carga a mano", icono: <Hand size={15} aria-hidden />, clase: "border-line text-inkSoft", placa: "bg-paperDeep text-inkSoft", grupo: "mano" },
  fuente_vieja: { texto: "La fuente no publica hace meses", icono: <Clock size={15} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto", placa: "bg-amber-soft text-amberTexto", grupo: "problema" },
};

/** En el celular, cuántas fuentes del mosaico se ven antes de «Ver las N más». */
const EN_CELULAR = 8;

const apariencia = (f: FuenteEstado): Apariencia => (f.situacion && SITUACION[f.situacion]) || ESTADO[f.estado];

/** Días enteros desde una fecha del calendario hasta hoy (para «hace 4 días»: a grandes rasgos). */
function diasAtras(iso: string): number | null {
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-05:00` : iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null;
}

function hace(dias: number | null): string | null {
  if (dias == null) return null;
  if (dias === 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${numero(dias)} días`;
}

/** El resumen: cuántas en cada grupo, en cifras grandes con su ícono, y la barra que las reparte. */
const GRUPOS: Record<Grupo, { etiqueta: (n: number) => string; icono: ReactNode; cifra: string; barra: string }> = {
  bien: { etiqueta: () => "al día", icono: <CheckCircle2 size={16} aria-hidden />, cifra: "text-mossTexto", barra: "bg-moss" },
  mano: { etiqueta: (n) => (n === 1 ? "se carga a mano o es una foto" : "se cargan a mano o son una foto"), icono: <Hand size={16} aria-hidden />, cifra: "text-ink", barra: "bg-inkSoft/40" },
  problema: { etiqueta: () => "con un problema", icono: <AlertTriangle size={16} aria-hidden />, cifra: "text-amberTexto", barra: "bg-amber" },
};

function Pastilla({ a }: { a: Apariencia }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-rotulo font-semibold", a.clase)}>
      {a.icono}
      {a.texto}
    </span>
  );
}

function RegistroOficial({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-6 items-center gap-1 font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate"
    >
      Registro oficial <ExternalLink size={12} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

/** Hasta dónde llega una fuente, como cifra: la fecha en grande y, al lado, cuánto hace. */
function Llega({ f }: { f: FuenteEstado }) {
  const dias = f.hasta ? diasAtras(f.hasta) : null;
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-display text-bloque font-bold leading-none tabular-nums text-ink">
        <span className="sr-only">Llega hasta el </span>
        {f.hasta ? fechaCorta(f.hasta) : "Sin dato"}
      </span>
      <span className="text-rotulo text-mute">{f.hasta ? hace(dias) : "sin fecha de corte"}</span>
    </p>
  );
}

export async function EstadoDatos() {
  let fuentes: FuenteEstado[] = [];
  try {
    const r = await fetch(`${API_BASE}/estado/datos`, { next: { revalidate: 600 } } as RequestInit);
    if (r.ok) fuentes = ((await r.json()) as { fuentes: FuenteEstado[] }).fuentes ?? [];
  } catch {
    fuentes = [];
  }
  if (!fuentes.length) return null;

  const conProblema = fuentes.filter((f) => apariencia(f).grupo === "problema");
  const resto = fuentes.filter((f) => apariencia(f).grupo !== "problema");
  const cuenta: Record<Grupo, number> = { bien: 0, mano: 0, problema: 0 };
  for (const f of fuentes) cuenta[apariencia(f).grupo]++;
  const orden: Grupo[] = ["bien", "mano", "problema"];

  return (
    <section aria-labelledby="estado-datos" className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex items-center gap-1.5">
          <h2 id="estado-datos" className="font-display text-seccion font-bold leading-tight text-ink">
            Cómo están hoy
          </h2>
          <Ayuda titulo="¿Qué quiere decir cada estado?">
            <span className="block">«Al día»: su última carga automática salió bien dentro de lo que se espera (un día, una semana o un mes, según la fuente).</span>
            <span className="mt-2 block">«Atrasada»: no hay una carga buena reciente; sus datos pueden no tener lo último. «Falló la última carga»: se reintenta en la próxima.</span>
            <span className="mt-2 block">«La fuente no publica hace meses»: la carga sale bien, pero el registro oficial no trae nada de los últimos tres meses.</span>
            <span className="mt-2 block">«Se carga a mano»: el registro no responde fuera del Perú o no tiene una descarga automática; se actualiza desde una computadora en el Perú.</span>
            <span className="mt-2 block">«La fuente no responde»: su sitio oficial está caído. «Captura detenida»: Vigía dejó de traerla por ahora. «Foto de una fecha»: se cargó una vez y no se actualiza sola. En esos casos va el porqué.</span>
          </Ayuda>
        </div>
        <p className="mt-0.5 text-dato leading-snug text-inkSoft">
          Hasta qué fecha llega cada registro. Una cifra de Vigía nunca va más allá de su fuente.
        </p>

        {/* El resumen: tres cifras con su ícono y la barra que reparte las {fuentes.length} fuentes. */}
        <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-2xl">
          {orden.map((g) => (
            <p key={g} className="min-w-0">
              <span className={cn("flex items-center gap-1.5 font-display text-cifra font-extrabold leading-none tabular-nums", GRUPOS[g].cifra)}>
                <span className="shrink-0">{GRUPOS[g].icono}</span>
                {numero(cuenta[g])}
              </span>
              <span className="mt-1 block text-meta leading-snug text-inkSoft">{GRUPOS[g].etiqueta(cuenta[g])}</span>
            </p>
          ))}
        </div>
        <div
          role="img"
          aria-label={`De ${plural(fuentes.length, "fuente", "fuentes")}: ${numero(cuenta.bien)} al día, ${numero(cuenta.mano)} a mano o como foto, ${numero(cuenta.problema)} con un problema`}
          className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full sm:max-w-2xl"
        >
          {orden
            .filter((g) => cuenta[g] > 0)
            .map((g) => (
              <span key={g} className={cn("gs-barra-crece h-full min-w-[4px]", GRUPOS[g].barra)} style={{ width: `${(100 * cuenta[g]) / fuentes.length}%` }} />
            ))}
        </div>
      </div>

      {/* Las que tienen un problema, primero y con el porqué a la vista: es lo que cambia cómo se lee una cifra. */}
      {conProblema.length > 0 && (
        <div className="mt-5 border-t border-line bg-amber-soft/40 px-4 py-4 sm:px-5">
          <h3 className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
            <AlertTriangle size={17} className="text-amberTexto" aria-hidden />
            {conProblema.length === 1 ? "Una fuente con un problema" : `${numero(conProblema.length)} fuentes con un problema`}
          </h3>
          <ul className="mt-3 grid gap-2.5 lg:grid-cols-2">
            {conProblema.map((f) => {
              const a = apariencia(f);
              return (
                <li key={f.clave} className="flex gap-3 rounded-xl border border-line bg-paper p-3.5">
                  <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", a.placa)}>
                    {a.icono}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-dato font-semibold leading-snug text-ink">{f.nombre}</p>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Llega f={f} />
                      <Pastilla a={a} />
                    </div>
                    {f.nota && <p className="mt-2 text-meta leading-relaxed text-inkSoft">{f.nota}</p>}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} aria-hidden />
                        {f.ultimaCarga ? `${f.cadencia}; última carga el ${fechaCorta(f.ultimaCarga)}` : f.cadencia}
                      </span>
                      {f.enlace && <RegistroOficial href={f.enlace} />}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Las demás, en mosaico: el ícono dice el estado y la fecha, hasta dónde llega. Lo que trae, en dos líneas. En el
          celular se ven las primeras EN_CELULAR y las demás con «Ver las N más» (un interruptor sin JS): 26 fuentes en una
          columna eran cinco pantallas. */}
      <input type="checkbox" id="estado-datos-todas" className="peer sr-only" aria-label="Ver todas las fuentes" />
      <ul
        aria-label="Las demás fuentes"
        className={cn("grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3 max-sm:peer-checked:[&>li]:flex", conProblema.length === 0 && "mt-5")}
      >
        {resto.map((f, i) => {
          const a = apariencia(f);
          return (
            <li key={f.clave} className={cn("flex gap-3 bg-paper px-4 py-3.5 sm:px-5", i >= EN_CELULAR && "max-sm:hidden")}>
              <span aria-hidden title={a.texto} className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", a.placa)}>
                {a.icono}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-dato font-semibold leading-snug text-ink">
                  {f.nombre}
                  <span className="sr-only">: {a.texto}.</span>
                </p>
                <Llega f={f} />
                <p className="mt-1 line-clamp-2 text-meta leading-snug text-inkSoft" title={f.que}>
                  {f.que}
                </p>
                {f.nota && <p className="mt-1 line-clamp-3 text-rotulo leading-snug text-mute" title={f.nota}>{f.nota}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
                  <span className="inline-flex items-center gap-1">
                    {a.grupo === "mano" ? <Hand size={12} aria-hidden /> : <Clock size={12} aria-hidden />}
                    {f.cadencia}
                  </span>
                  {f.enlace && <RegistroOficial href={f.enlace} />}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {resto.length > EN_CELULAR && (
        <label
          htmlFor="estado-datos-todas"
          className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border-t border-line text-dato font-semibold text-ink hover:text-granate peer-checked:hidden sm:hidden"
        >
          Ver las {numero(resto.length - EN_CELULAR)} fuentes más <ChevronDown size={16} aria-hidden />
        </label>
      )}
    </section>
  );
}
