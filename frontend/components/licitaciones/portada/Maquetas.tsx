import type { ReactNode } from "react";
import { BellRing, Building2, Clock3, MapPin, Search, Tag, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Las maquetas de la portada de Gobserva Licitaciones (2026-11-07): cómo se ve cada paso del producto, armadas con las
 * mismas piezas de la interfaz (no son capturas). Todo lo que muestran es un EJEMPLO y lo dicen: entidades genéricas
 * («una UGEL de Cusco»), ningún código de proceso ni cifra presentada como real. Server-safe.
 */

/** La marca de lo ilustrativo: va en cada maqueta, a la vista. */
export function Ejemplo({ className, oscuro = false }: { className?: string; oscuro?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-rotulo font-semibold leading-none",
        oscuro ? "border-paper/25 text-paper/75" : "border-line bg-paperSoft text-mute",
        className,
      )}
    >
      Ejemplo
    </span>
  );
}

/** El puntaje de afinidad (0 a 100), como en «Para ti»: lleno desde 70, apagado debajo. */
export function Puntaje({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-label={`${n} de afinidad`}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-lg font-display text-cuerpo font-bold tabular-nums",
        n >= 70 ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft",
        className,
      )}
    >
      {n}
    </span>
  );
}

/** El marco de una maqueta: una ventana de la app con su título y la marca de ejemplo. */
function Maqueta({ titulo, Icono, children, className }: { titulo: string; Icono: typeof Search; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0 overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-paperSoft px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-meta font-semibold text-inkSoft">
          <Icono size={15} aria-hidden className="shrink-0 text-granate" />
          <span className="truncate">{titulo}</span>
        </span>
        <Ejemplo />
      </figcaption>
      <div className="p-4 sm:p-5">{children}</div>
    </figure>
  );
}

function Chip({ children, activo = false }: { children: ReactNode; activo?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-rotulo font-medium",
        activo ? "border-granate/40 bg-granate-50 text-granate" : "border-line bg-paper text-inkSoft",
      )}
    >
      {children}
    </span>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-rotulo font-semibold text-mute">{etiqueta}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Paso 1: la línea de negocio, como se llena en «Para ti». */
export function MaquetaLinea() {
  return (
    <Maqueta titulo="Tu línea de negocio" Icono={Search}>
      <div className="space-y-4">
        <Campo etiqueta="Qué vende tu empresa">
          <p className="rounded-xl border border-line bg-paperDeep px-3.5 py-2.5 text-dato text-ink">
            Útiles de oficina, tóner y papel para impresoras
          </p>
        </Campo>
        <Campo etiqueta="Palabras clave">
          <div className="flex flex-wrap gap-1.5">
            <Chip activo>tóner</Chip>
            <Chip activo>papel bond</Chip>
            <Chip activo>archivadores</Chip>
          </div>
        </Campo>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Dónde atiendes">
            <div className="flex flex-wrap gap-1.5">
              <Chip>Cusco</Chip>
              <Chip>Puno</Chip>
              <Chip>Apurímac</Chip>
            </div>
          </Campo>
          <Campo etiqueta="Qué compras">
            <div className="flex flex-wrap gap-1.5">
              <Chip activo>Bienes</Chip>
              <Chip>Servicios</Chip>
            </div>
          </Campo>
        </div>
      </div>
    </Maqueta>
  );
}

const PARA_TI = [
  { n: 92, titulo: "Útiles de oficina para el año escolar", quien: "Una UGEL de Cusco", tipo: "Contrato menor", cuando: "Cierra en 2 días" },
  { n: 88, titulo: "Tóner y cartuchos para impresoras", quien: "Una municipalidad de Puno", tipo: "Licitación", cuando: "Consultas hasta el viernes" },
  { n: 64, titulo: "Mobiliario para aulas", quien: "Un gobierno regional", tipo: "Licitación", cuando: "Consultas hasta el lunes" },
];

/** Paso 2: «Para ti», ordenado por afinidad. */
export function MaquetaParaTi() {
  return (
    <Maqueta titulo="Para ti: Útiles de oficina" Icono={Search}>
      <ol className="-my-1 divide-y divide-line">
        {PARA_TI.map((o) => (
          <li key={o.titulo} className="flex items-start gap-3 py-3">
            <Puntaje n={o.n} />
            <div className="min-w-0">
              <p className="text-dato font-semibold leading-snug text-ink">{o.titulo}</p>
              <p className="mt-0.5 text-meta text-inkSoft">
                {o.quien}, {o.tipo.toLowerCase()}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-rotulo font-semibold text-granate">
                <Clock3 size={12} aria-hidden /> {o.cuando}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-line pt-3 text-meta leading-relaxed text-mute">
        El puntaje dice cuánto se parece lo que se compra a lo que vendes. No es la probabilidad de ganar.
      </p>
    </Maqueta>
  );
}

/** Paso 3: el aviso que llega (correo o notificación). */
export function MaquetaAviso({ correo }: { correo: boolean }) {
  return (
    <Maqueta titulo={correo ? "Tu correo" : "Tu cuenta"} Icono={BellRing}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate-50 text-granate">
          <BellRing size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta text-mute">
            <span className="font-semibold text-inkSoft">Gobserva Licitaciones</span>
            <span>Hoy, 7:00</span>
          </p>
          <p className="mt-1 text-cuerpo font-semibold leading-snug text-ink">3 oportunidades nuevas para Útiles de oficina</p>
          <ul className="mt-3 space-y-2">
            <li className="rounded-xl border border-line bg-paperSoft px-3 py-2">
              <p className="text-dato font-medium text-ink">Útiles de oficina para el año escolar</p>
              <p className="text-rotulo text-mute">Una UGEL de Cusco, cierra en 2 días</p>
            </li>
            <li className="rounded-xl border border-line bg-paperSoft px-3 py-2">
              <p className="text-dato font-medium text-ink">Tóner y cartuchos para impresoras</p>
              <p className="text-rotulo text-mute">Una municipalidad de Puno, licitación</p>
            </li>
          </ul>
          <p className="mt-3 text-meta font-semibold text-granate">Y 1 más en tu cuenta</p>
        </div>
      </div>
    </Maqueta>
  );
}

/** Paso 4: lo que se sabe antes de ofertar. */
export function MaquetaContexto() {
  const filas = [
    { Icono: Users, etiqueta: "Cuántos compiten", valor: "2 postores por proceso, en compras parecidas" },
    { Icono: Building2, etiqueta: "Quién le vende a esta entidad", valor: "3 empresas en el último año" },
    { Icono: Tag, etiqueta: "A qué precio se adjudicó lo mismo", valor: "De S/ 180 a S/ 240 por cartucho, en otras entidades" },
  ];
  return (
    <Maqueta titulo="Tóner y cartuchos para impresoras" Icono={MapPin}>
      <p className="text-meta font-semibold text-inkSoft">Antes de ofertar</p>
      <dl className="mt-3 space-y-3">
        {filas.map(({ Icono, etiqueta, valor }) => (
          <div key={etiqueta} className="flex items-start gap-3">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paperDeep text-granate">
              <Icono size={17} />
            </span>
            <div className="min-w-0">
              <dt className="text-rotulo font-semibold text-mute">{etiqueta}</dt>
              <dd className="text-dato font-semibold leading-snug text-ink">{valor}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Maqueta>
  );
}

/** El destacado de «Todo en una cuenta»: contratos menores que cierran pronto. */
export function MaquetaMenores() {
  const filas = [
    { titulo: "Papel bond A4 para la sede central", quien: "Un hospital de Cusco", cuando: "Cierra en 5 horas", urge: true },
    { titulo: "Archivadores y folders", quien: "Una municipalidad de Puno", cuando: "Cierra mañana", urge: false },
  ];
  return (
    <div className="min-w-0 rounded-2xl bg-paper p-4 text-ink shadow-pop">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta font-semibold text-inkSoft">Contratos menores abiertos</p>
        <Ejemplo />
      </div>
      <ul className="mt-2 divide-y divide-line">
        {filas.map((f) => (
          <li key={f.titulo} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0">
              <span className="block text-dato font-semibold text-ink">{f.titulo}</span>
              <span className="block text-rotulo text-mute">{f.quien}</span>
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-rotulo font-semibold",
                f.urge ? "bg-amber-soft text-amberTexto" : "bg-paperDeep text-inkSoft",
              )}
            >
              <Clock3 size={12} aria-hidden /> {f.cuando}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
