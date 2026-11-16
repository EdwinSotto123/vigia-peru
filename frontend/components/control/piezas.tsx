import { Banknote, FilePen, HardHat, IdCard, Package, Tag, Target, Wallet, type LucideIcon } from "lucide-react";
import { numero } from "@/lib/formato";
import { TIPO_RESPONSABILIDAD } from "@/lib/corrupcion";
import { cn } from "@/lib/utils";

/**
 * Las piezas que repiten la lista de informes de la Contraloría, su buscador y el panel de un informe: el tema de una
 * observación (con su ícono, el mismo en los tres lugares) y la responsabilidad presunta (penal en rojo, civil en ámbar,
 * las administrativas en neutro: el mismo código que tenía la lista). Server-safe.
 */

/** Los temas de la lectura de IA (lib/contraloriaFichas.ts de la API), por clave: su nombre y su ícono. */
const TEMAS: Record<string, { texto: string; icono: LucideIcon }> = {
  seleccion_contratacion: { texto: "Selección y contratación", icono: FilePen },
  ejecucion_contractual: { texto: "Ejecución contractual u obra", icono: HardHat },
  pagos_adelantos: { texto: "Pagos y adelantos", icono: Banknote },
  personal_planillas: { texto: "Personal y planillas", icono: IdCard },
  bienes_almacen: { texto: "Bienes y almacén", icono: Package },
  presupuesto_tesoreria: { texto: "Presupuesto y tesorería", icono: Wallet },
  otros: { texto: "Otros", icono: Tag },
  objetivo: { texto: "Objetivo del informe", icono: Target },
};

/** El tema por su clave («pagos_adelantos») o por su nombre («Pagos y adelantos», como llega en la lista). */
export function temaDe(tema: string | null | undefined, texto?: string | null): { clave: string; texto: string; icono: LucideIcon } | null {
  const t = (tema ?? "").trim();
  if (!t && !texto) return null;
  if (t && TEMAS[t]) return { clave: t, ...TEMAS[t] };
  const porTexto = Object.entries(TEMAS).find(([, v]) => v.texto.toLocaleLowerCase("es") === (texto ?? t).toLocaleLowerCase("es"));
  if (porTexto) return { clave: porTexto[0], ...porTexto[1] };
  return { clave: t || "otro", texto: (texto ?? t) || "Otro tema", icono: Tag };
}

/** El tema de una observación, en su chip con ícono. Sin tema (la IA todavía no la leyó), nada. */
export function ChipTema({ tema, texto, className }: { tema: string | null | undefined; texto?: string | null; className?: string }) {
  const t = temaDe(tema, texto);
  if (!t) return null;
  const Icono = t.icono;
  return (
    <span className={cn("pill max-w-full border-line bg-paperSoft text-inkSoft", className)}>
      <Icono size={12} className="shrink-0 text-mute" aria-hidden />
      <span className="sr-only">Tema: </span>
      <span className="truncate">{t.texto}</span>
    </span>
  );
}

const TONO: Record<string, string> = {
  penal: "border-crimson/20 bg-crimson-soft text-crimsonTexto",
  civil: "border-amber/20 bg-amber-soft text-amberTexto",
};

/** Una responsabilidad presunta en su chip («Penal», «Civil»…), con cuántos la tienen si se da `n`. */
export function ChipResponsabilidad({ tipo, n, className }: { tipo: string; n?: number; className?: string }) {
  return (
    <span className={cn("pill", TONO[tipo] ?? "border-mute/20 bg-line text-inkSoft", className)}>
      {TIPO_RESPONSABILIDAD[tipo] ?? tipo.replace(/_/g, " ")}
      {n != null && <span className="font-mono font-semibold tabular-nums">{numero(n)}</span>}
    </span>
  );
}

/** Las responsabilidades presuntas de un informe o de una persona, en una lista de chips. */
export function ChipsResponsabilidad({ tipos, etiqueta = "Responsabilidad presunta", className }: { tipos: string[]; etiqueta?: string; className?: string }) {
  if (!tipos.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label={etiqueta}>
      {tipos.map((t) => (
        <li key={t}>
          <ChipResponsabilidad tipo={t} />
        </li>
      ))}
    </ul>
  );
}
