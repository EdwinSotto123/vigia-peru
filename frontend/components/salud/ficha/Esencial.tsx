import Link from "next/link";
import { Ayuda } from "@/components/patrones/Ayuda";
import type { Tono } from "@/components/gobserva/ui/Insignia";
import { iconoEstado, tonoEstado } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { numero, rutaFicha, rutaMedico, type Chequeo, type FichaIpress } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { detalleLeido } from "./piezas";
import { resumenVerificacion } from "./Verificacion";

/**
 * «Lo esencial» de una IPRESS, de un vistazo (2026-11-21, el usuario: la ficha se sentía «demasiado atosigante, sin
 * jerarquías»): la frase de la verificación UNA sola vez (antes se repetía en «Para atenderte aquí», en «Verificación» y
 * en la descripción) y una casilla por chequeo con su respuesta corta («Activa», «II-2», «7 firmes») y el color de su
 * estado. Cada casilla lleva a su detalle. El texto largo de cada chequeo, con su fuente y su fecha, queda más abajo en
 * «Cómo lo verificamos». Server-safe.
 */

const CORTO: Record<string, string> = {
  registro: "Registro",
  categoria: "Categoría",
  quirurgico: "Centro quirúrgico",
  licencia: "Licencia municipal",
  sanciones: "Sanciones firmes",
  denuncias: "Denuncias",
  responsable: "Responsable médico",
};

/** La casilla: con borde y fondo de alerta sólo cuando hay algo que revisar; lo conforme queda tranquilo. */
const CASILLA: Record<Tono, string> = {
  exito: "border-line bg-paper",
  neutro: "border-line bg-paper",
  acento: "border-line bg-paper",
  aviso: "border-amber/45 bg-amber-soft/40",
  urgente: "border-crimson/45 bg-crimson-soft/50",
};
const ICONO: Record<Tono, string> = {
  exito: "text-mossTexto",
  neutro: "text-mute",
  acento: "text-granate",
  aviso: "text-amberTexto",
  urgente: "text-crimsonTexto",
};
const VALOR: Record<Tono, string> = {
  exito: "text-ink",
  neutro: "text-inkSoft",
  acento: "text-ink",
  aviso: "text-amberTexto",
  urgente: "text-crimsonTexto",
};

/** La respuesta corta de un chequeo: lo que una persona lee en la casilla. */
function valorCorto(c: Chequeo, f: FichaIpress): string {
  const leido = detalleLeido(f);
  switch (c.clave) {
    case "registro":
      if (!f.enRegistro) return "Ya no figura";
      if (f.activo) return "Activa";
      return f.estado ? f.estado.charAt(0) + f.estado.slice(1).toLocaleLowerCase("es-PE") : "Sin estado";
    case "categoria":
      return (leido ? f.detalle!.categoria : null) ?? f.categoria ?? "Sin categoría";
    case "quirurgico":
      return c.estado === "ok" ? "Registrado" : c.estado === "sin_dato" ? "Sin dato" : "No registrado";
    case "licencia":
      return c.estado === "ok" ? "Declarada" : c.estado === "sin_dato" ? "Sin dato" : "No declarada";
    case "sanciones": {
      const n = f.registroSanciones.length;
      return n === 0 ? "Ninguna" : n === 1 ? "1 firme" : `${numero(n)} firmes`;
    }
    case "denuncias": {
      const ultimo = [...f.denunciasPorAnio].sort((a, b) => b.anio - a.anio)[0];
      if (!ultimo) return "Sin dato";
      return `${numero(ultimo.denuncias)} en ${ultimo.anio}`;
    }
    case "responsable":
      return leido && f.detalle!.responsableColegiatura ? `CMP ${f.detalle!.responsableColegiatura}` : "Sin dato";
    default:
      return c.titulo;
  }
}

/** Adónde lleva cada casilla: su pestaña, su página o el chequeo de abajo. */
function destino(c: Chequeo, f: FichaIpress, base: string): string {
  const ficha = rutaEn(base, rutaFicha(f.codigo));
  switch (c.clave) {
    case "sanciones":
      return f.registroSanciones.length ? `${ficha}?seccion=sanciones#secciones` : `${ficha}?seccion=verificacion#secciones`;
    case "denuncias":
      return `${ficha}?seccion=denuncias#secciones`;
    case "quirurgico":
      return `${ficha}?seccion=servicios#secciones`;
    case "licencia":
      return `${ficha}?seccion=documentos#secciones`;
    case "responsable":
      return detalleLeido(f) && f.detalle.responsableColegiatura ? rutaEn(base, rutaMedico(f.detalle.responsableColegiatura)) : `${ficha}?seccion=verificacion#secciones`;
    default:
      return `${ficha}?seccion=verificacion#secciones`;
  }
}

export function EsencialFicha({ f, base, className }: { f: FichaIpress; base: string; className?: string }) {
  return (
    <section aria-labelledby="esencial-t" className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5">
        <h2 id="esencial-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Lo esencial
        </h2>
        <Ayuda titulo="¿Cómo se lee?" etiqueta="Cómo se leen las casillas">
          Cada casilla es lo que dice una fuente oficial. En rojo o ámbar, lo que conviene revisar; el resto está conforme o
          no tiene dato. En la pestaña «Verificación», cada una con su fuente y su fecha.
          <span className="mt-1.5 block">Nada de esto califica a un establecimiento como seguro o peligroso.</span>
        </Ayuda>
      </div>
      <p className="mt-1.5 max-w-[70ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{resumenVerificacion(f)}</p>
      <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7" aria-label="Lo esencial, chequeo por chequeo">
        {f.verificacion.map((c) => {
          // Una sanción firme va en el rojo de las sanciones firmes de todo Salud (las listas, el registro), aunque el chequeo diga «Revisa».
          const tono: Tono = c.clave === "sanciones" && f.registroSanciones.length > 0 ? "urgente" : tonoEstado(c.estado);
          const Icono = iconoEstado(c.estado);
          return (
            <li key={c.clave} className="min-w-0">
              <Link
                href={destino(c, f, base)}
                prefetch={false}
                className={cn(
                  "group flex h-full min-h-[5.25rem] flex-col justify-between rounded-xl border px-3.5 py-3 transition-colors duration-rapido hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                  CASILLA[tono],
                )}
              >
                <span className="flex items-start gap-1.5 text-meta leading-snug text-inkSoft">
                  <Icono size={15} aria-hidden className={cn("mt-px shrink-0", ICONO[tono])} />
                  <span className="min-w-0">{CORTO[c.clave] ?? c.titulo}</span>
                </span>
                <span className={cn("mt-2 font-display text-bloque font-bold leading-tight tabular-nums [overflow-wrap:anywhere]", VALOR[tono])}>
                  {valorCorto(c, f)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
