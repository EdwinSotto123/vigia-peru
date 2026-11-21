import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Hourglass } from "lucide-react";
import type { Tono } from "@/components/gobserva/ui/Insignia";
import { nombrePropio, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * Las piezas que comparten las pestañas de la ficha de una IPRESS (server-safe). Una caja por bloque (`.tarjeta`, la de
 * primer nivel): adentro, filas con divisores y aire, nunca otra caja con borde.
 */

/** La página de SUSALUD para presentar una consulta o denuncia, y la consulta oficial de RENIPRESS (components/salud/fuentes/urls.ts). */
export { URL_DENUNCIA_SUSALUD, URL_RENIPRESS_CONSULTA } from "@/components/salud/fuentes/urls";

/** El fondo y la tinta de un tono de insignia, para un disco con ícono (el mismo par que `Insignia`). */
export const DISCO_TONO: Record<Tono, string> = {
  neutro: "bg-ink/[0.06] text-inkSoft",
  acento: "bg-granate-50 text-granate",
  urgente: "bg-crimson-soft text-crimsonTexto",
  aviso: "bg-amber-soft text-amberTexto",
  exito: "bg-moss/15 text-mossTexto",
};

/** ¿Ya se leyó el detalle de RENIPRESS (servicios, documentos, responsable)? */
export const detalleLeido = (f: Pick<FichaIpress, "detalle">): f is { detalle: NonNullable<FichaIpress["detalle"]> } =>
  !!f.detalle && !!f.detalle.leidoAl && !f.detalle.error;

/**
 * RENIPRESS trae la dirección en mayúsculas y, a veces, con el «°» roto por la codificación del archivo («N� 350»): se
 * escribe en oración y el «N�» vuelve a ser «N°». Nada más se toca.
 */
export function direccionLegible(t: string | null | undefined): string {
  if (!t) return "";
  return nombrePropio(t.replace(/\bN�\s?/g, "N° ").replace(/\s+/g, " ").trim());
}

/** «LICENCIA MUNICIPAL» → «Licencia municipal»: un texto en mayúsculas de RENIPRESS, en oración. */
export const enOracion = (t: string | null | undefined) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "");

/** «UPSS - CONSULTA EXTERNA» → «Consulta externa». Los nombres de RENIPRESS van en mayúsculas. */
export function nombreServicio(t: string | null | undefined): string {
  let s = (t ?? "").replace(/^\s*UPSS\s*-\s*/i, "").trim();
  const adm = /^\s*SERV\.?\s*ADM\.?\s*-\s*/i.test(s);
  s = s.replace(/^\s*SERV\.?\s*ADM\.?\s*-\s*/i, "").replace(/\s*-\s*$/, "").trim();
  if (!s) return adm ? "Servicio administrativo" : "Sin nombre";
  // En mayúsculas (o casi: «LOGISTICA (Abastecimiento)»), en oración; un nombre ya escrito en oración queda como está.
  const letras = s.replace(/[^\p{L}]/gu, "");
  const mayus = letras.replace(/[^\p{Lu}]/gu, "").length;
  const oracion = letras.length && mayus / letras.length > 0.6 ? s.toLowerCase() : s;
  const listo = oracion.charAt(0).toUpperCase() + oracion.slice(1);
  return adm ? `Servicio administrativo: ${listo.charAt(0).toLowerCase()}${listo.slice(1)}` : listo;
}

/** Una caja de primer nivel con su título (h3), un conteo y una línea opcional. */
export function Bloque({
  titulo,
  icono: Icono,
  cuenta,
  descripcion,
  ayuda,
  acciones,
  children,
  className,
  cuerpo = "relleno",
  id,
}: {
  titulo: ReactNode;
  icono?: LucideIcon;
  cuenta?: ReactNode;
  descripcion?: ReactNode;
  ayuda?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  /** `relleno`: el cuerpo con aire; `lista`: las filas llegan al borde (cada una trae el suyo). */
  cuerpo?: "relleno" | "lista";
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-t` : undefined} className={cn("tarjeta min-w-0 scroll-mt-32 rounded-2xl border border-line bg-paper", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 id={id ? `${id}-t` : undefined} className="flex flex-wrap items-center gap-2 font-display text-bloque font-bold leading-snug text-ink">
            {Icono && <Icono size={18} aria-hidden className="shrink-0 text-mute" />}
            <span className="min-w-0">{titulo}</span>
            {cuenta != null && (
              <span className="rounded-full bg-paperDeep px-2 py-0.5 font-sans text-rotulo font-semibold tabular-nums text-inkSoft">{cuenta}</span>
            )}
            {ayuda}
          </h3>
          {descripcion && <p className="mt-0.5 text-pretty text-meta leading-snug text-inkSoft">{descripcion}</p>}
        </div>
        {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
      </header>
      <div className={cn("min-w-0", cuerpo === "relleno" ? "px-4 py-4 sm:px-5" : "")}>{children}</div>
    </section>
  );
}

/** Una cifra en su tesela: ícono, número y qué es (y su contexto, si lo hay). Caja de primer nivel. */
export function Tesela({
  icono: Icono,
  valor,
  etiqueta,
  contexto,
  tono = "neutro",
  className,
}: {
  icono: LucideIcon;
  /** Ya formateado; `null` = «Sin dato» (nunca un cero inventado). */
  valor: ReactNode | null;
  etiqueta: ReactNode;
  contexto?: ReactNode;
  tono?: Tono;
  className?: string;
}) {
  return (
    <div className={cn("tarjeta flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-paper p-3.5 sm:p-4", className)}>
      <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", DISCO_TONO[tono])}>
        <Icono size={18} />
      </span>
      <div className="min-w-0">
        <p className={cn("font-display text-seccion font-bold leading-none tabular-nums", valor == null ? "text-mute" : "text-ink")}>
          {valor ?? <span className="text-dato font-semibold">Sin dato</span>}
        </p>
        <p className="mt-1.5 text-meta font-medium leading-snug text-inkSoft">{etiqueta}</p>
        {contexto && <p className="mt-0.5 text-rotulo leading-snug text-mute">{contexto}</p>}
      </div>
    </div>
  );
}

/** Un enlace a un sitio oficial, en medio del texto: subrayado, con la flecha de «se abre afuera». */
export function EnlaceOficial({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-semibold text-granate underline decoration-granate/40 underline-offset-2 transition-colors duration-rapido hover:decoration-granate", className)}
    >
      {children}
      <ArrowUpRight size={13} aria-hidden className="ml-0.5 inline align-[-1px]" />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

/**
 * El detalle de RENIPRESS (servicios, documentos, responsable) todavía no llegó: la API ya lo pidió al abrir la ficha y
 * el cargador lo lee primero en su corrida de la madrugada (03:40, susalud_detalle). Mientras, la consulta oficial. Por
 * qué falta y cuánto falta: docs/salud/datos.md §8.
 */
export function DetallePendiente({ url, className }: { url: string; className?: string }) {
  return (
    <div role="status" className={cn("flex gap-3 rounded-2xl border border-amber/30 bg-amber-soft/50 px-4 py-3.5", className)}>
      <Hourglass size={18} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
      <p className="min-w-0 text-dato leading-relaxed text-ink">
        <span className="font-semibold">Todavía no leímos el detalle de este establecimiento en RENIPRESS</span>{" "}
        <span className="text-inkSoft">
          (servicios, especialidades, documentos y responsable). Ya lo pedimos: RENIPRESS se consulta de madrugada, así que suele
          estar aquí al día siguiente. Mientras, míralo en la <EnlaceOficial href={url}>consulta oficial de RENIPRESS</EnlaceOficial>.
        </span>
      </p>
    </div>
  );
}

/**
 * ¿El responsable es del Colegio Médico del Perú? Sólo entonces su número es un CMP y lleva a /medico, que busca en el
 * CMP. El 2026-11-21, 6 565 de los 12 991 responsables leídos eran de otro colegio (odontólogos, enfermeros, obstetras,
 * tecnólogos médicos, biólogos…) y la ficha los mostraba como «CMP» y enlazaba a otra persona.
 */
export const esColegioMedico = (colegio: string | null | undefined) => /^\s*COLEGIO\s+M\S?DICO\s+DEL\s+PER/i.test(colegio ?? "");

/** La profesión del responsable según su colegio, para la casilla de «Lo esencial» cuando no es médico. */
export function profesionResponsable(colegio: string | null | undefined): string {
  const t = (colegio ?? "").toUpperCase();
  if (/TECNOLOG/.test(t)) return "Tecnología médica";
  if (/ODONTOL/.test(t)) return "Odontología";
  if (/T.CNICO/.test(t)) return "Técnico de salud";
  if (/ENFERMER/.test(t)) return "Enfermería";
  if (/OBSTETR/.test(t)) return "Obstetricia";
  if (/PSICOL/.test(t)) return "Psicología";
  if (/BI.LOGO/.test(t)) return "Biología";
  if (/QU.MICO|FARMAC/.test(t)) return "Química farmacéutica";
  if (/NUTRICION/.test(t)) return "Nutrición";
  return "Otro colegio";
}

/** Una fila «qué es → cuál es» de una lista de datos (`<dl>`), con su ícono. */
export function FilaDato({ icono: Icono, t, children, mono = false }: { icono?: LucideIcon; t: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-b border-line/70 py-2.5 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)]">
      <dt className="flex items-center gap-1.5 text-meta text-mute">
        {Icono && <Icono size={14} aria-hidden className="shrink-0" />}
        {t}
      </dt>
      <dd className={cn("min-w-0 break-words text-dato text-ink", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}
