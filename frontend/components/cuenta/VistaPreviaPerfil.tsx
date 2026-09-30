import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, ShieldAlert } from "lucide-react";
import { FranjaTextil, Isotipo } from "@/components/marca";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
import { ContactoAliado, IdentidadAliado, type DatoIdentidad } from "@/components/aliados/IdentidadAliado";
import { comoSePublica, type ValoresPerfil } from "@/lib/perfilAliado";
import { cn } from "@/lib/utils";

/**
 * Vista previa, en vivo, de la cabecera de la página del aliado (/aliado/<slug>, PortadaAliado):
 * portada o franja textil, logo superpuesto, nombre, tipo, descripción y enlaces. Usa las mismas
 * piezas que la página real (AvatarAliado, IdentidadAliado, ContactoAliado) y sólo muestra lo que
 * se publicaría: un enlace a medio escribir o inválido no aparece, igual que allá.
 * Sin puesto, insignias ni cifras: esos datos no salen de este formulario.
 */

export type EstadoPublico = "visible" | "anonimo" | "oculto";

const TIPO: Record<"empresa" | "persona" | "organizacion", { texto: string; icono: DatoIdentidad["icono"] }> = {
  empresa: { texto: "Empresa", icono: "tipo-empresa" },
  organizacion: { texto: "Organización", icono: "tipo-organizacion" },
  persona: { texto: "Persona", icono: "tipo-persona" },
};

const ESTADO: Record<EstadoPublico, { texto: string; clase: string; Icono: typeof Eye }> = {
  visible: { texto: "Visible", clase: "border-granate/20 bg-granate-soft font-semibold text-granate", Icono: Eye },
  anonimo: { texto: "Anónimo", clase: "border-line bg-paperDeep font-medium text-mute", Icono: EyeOff },
  oculto: { texto: "Oculto por Vigía", clase: "border-amber/30 bg-amber-soft font-semibold text-amberTexto", Icono: ShieldAlert },
};

export function VistaPreviaPerfil({
  nombre,
  tipo,
  logoUrl,
  valores,
  estado,
  publicada,
  className,
}: {
  nombre: string;
  tipo: "empresa" | "persona" | "organizacion";
  logoUrl: string | null;
  valores: ValoresPerfil;
  estado: EstadoPublico;
  /** Ruta de la página ya publicada (/aliado/<slug>), si hoy se ve. */
  publicada: string | null;
  className?: string;
}) {
  const pub = comoSePublica(valores);
  const e = ESTADO[estado];
  const n = nombre.trim();
  return (
    <section aria-label="Vista previa de tu página de aliado" className={cn("overflow-hidden rounded-2xl border border-line bg-paper", className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="font-display text-[15px] font-bold text-ink">Vista previa de tu página</h2>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]", e.clase)}>
          <e.Icono size={11} aria-hidden /> {e.texto}
        </span>
      </div>

      <div className="sobre-oscuro relative h-20 bg-granate-deep">
        {pub.portadaUrl ? (
          <Image src={pub.portadaUrl} alt="" fill unoptimized className="object-cover" />
        ) : (
          <>
            <Isotipo tamano={18} className="absolute right-3 top-3" />
            <FranjaTextil alto={12} className="absolute inset-x-0 bottom-0" />
          </>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="relative z-[1] -mt-7 w-fit rounded-2xl bg-paper p-1 shadow-card">
          <AvatarAliado tipo={tipo} logoUrl={logoUrl} nombre={n || "Tu logo"} size="lg" />
        </div>
        <p className={cn("mt-2 truncate font-display text-lg font-bold", n ? "text-ink" : "italic text-mute")}>{n || "Aún sin nombre"}</p>
        {TIPO[tipo] && <IdentidadAliado datos={[{ icono: TIPO[tipo].icono, texto: TIPO[tipo].texto }]} tam="sm" className="mt-1" />}
        {pub.descripcion && <p className="mt-2 text-[13px] leading-relaxed text-inkSoft text-pretty">{pub.descripcion}</p>}
        <ContactoAliado web={pub.web} email={pub.email} redes={pub.redes} className="mt-3" />

        <p className="mt-3 border-t border-line pt-3 text-xs text-mute">
          {estado === "oculto" ? (
            "Nadie ve esta página mientras el equipo de Vigía la tenga oculta."
          ) : estado === "anonimo" ? (
            "Nadie ve esta página: elegiste aparecer como Anónimo."
          ) : publicada ? (
            <>
              Publicada en{" "}
              <Link href={publicada} className="font-mono text-granate underline underline-offset-2">{publicada}</Link>. Lo que guardes se ve ahí en
              hasta un minuto.
            </>
          ) : (
            "Así se verá tu página cuando guardes."
          )}
        </p>
      </div>
    </section>
  );
}
