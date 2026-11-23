import Link from "next/link";
import type { ReactNode } from "react";
import { BedDouble, Clock3, Gavel, MapPin, MessageSquareWarning, Scissors, ShieldCheck, Stethoscope } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { InsigniaCategoria } from "@/components/salud/comun";
import { direccionLegible } from "@/components/salud/ficha/piezas";
import { rutaEn } from "@/lib/gobserva";
import { CLASES_DE_HECHO, SECTORES, nombrePropio, numero, rutaFicha, type FilaIpress } from "@/lib/gobserva-salud";
import { atiende24, seguroIpress } from "@/lib/salud-seguros";
import { cn } from "@/lib/utils";
import { lugarIpress } from "./filtros";
import { InsigniaRegistro } from "./Insignias";

/** El dibujo de una IPRESS por su clasificación en RENIPRESS. */
export function spriteLugar(x: Pick<FilaIpress, "clasificacion" | "internamiento">): NombreSprite {
  const c = (x.clasificacion ?? "").toUpperCase();
  if (/ODONTOLOG/.test(c)) return "iconoDientes";
  if (/PATOLOGIA CLINICA|LABORATORIO/.test(c)) return "iconoAnalisis";
  if (/IMAGENES|RADIOLOG/.test(c)) return "iconoImagenes";
  if (/OPTIC/.test(c)) return "iconoOjos";
  if (/REHABILITA/.test(c)) return "iconoHuesos";
  if (/HOSPITAL|CLINICA|CAMAS|INTERNAMIENTO/.test(c) || x.internamiento) return "lugarHospital";
  if (/PUESTO|POSTA|CENTROS? DE SALUD/.test(c)) return "lugarPosta";
  return "lugarConsultorio";
}

/**
 * Una IPRESS como casilla de vitrina (2026-11-22, el usuario: «que sea tipo marketplace, o sea con casillas y no filas»).
 * Segunda vuelta, el mismo día («mejora la UX/UI de todo… esta mierda es texto plano»; en el celular cada casilla medía
 * 320 px por un dibujo de 96 px repetido, diez eran 3,800 px): en el celular la casilla es horizontal, con el dibujo en
 * una baldosa chica a la izquierda; desde 520 px vuelve la vitrina con el dibujo arriba. La categoría y el seguro van en
 * pastillas sobre el nombre; lo que tiene (24 horas, centro quirúrgico, internamiento, médicos) como etiquetas con
 * ícono; y al pie, las señales como pastillas de color: sanciones firmes en rojo, «Sin sanciones firmes» en verde (es una
 * respuesta, no un vacío) y denuncias en ámbar, nunca juntas en una sola. Toda la casilla lleva a la ficha; al pasar o
 * tocar, la mira se cierra sobre ella y el dibujo da un brinco. `children` va debajo (la distancia en «Cerca de mí», la
 * colegiatura en la búsqueda). Server-safe.
 */
export function TarjetaEstablecimiento({
  x,
  base,
  children,
  conDireccion = false,
  className,
}: {
  x: FilaIpress;
  base: string;
  children?: ReactNode;
  conDireccion?: boolean;
  className?: string;
}) {
  const nombre = nombrePropio(x.nombre) || `IPRESS ${x.codigo}`;
  const denuncias = x.denuncias ?? 0;
  const seguro = (x.activo ? seguroIpress(x.institucion).corto : null) ?? SECTORES[x.sector] ?? x.sector;
  const rasgos: { Icono: typeof Clock3; texto: string; titulo?: string }[] = [
    ...(x.activo && atiende24(x.horario) ? [{ Icono: Clock3, texto: "24 horas" }] : []),
    ...(x.quirurgico ? [{ Icono: Scissors, texto: "Centro quirúrgico", titulo: "RENIPRESS le registra un centro quirúrgico activo." }] : []),
    ...(x.internamiento ? [{ Icono: BedDouble, texto: "Internamiento", titulo: "RENIPRESS lo registra como establecimiento con internamiento." }] : []),
    ...(x.medicos ? [{ Icono: Stethoscope, texto: x.medicos === 1 ? "1 médico" : `${numero(x.medicos)} médicos`, titulo: "Médicos que declaró a SUSALUD" }] : []),
  ];
  return (
    <article
      className={cn(
        "gs-mira group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-paper transition-colors duration-rapido focus-within:ring-2 focus-within:ring-granate hover:border-granate/50",
        x.activo ? "border-line" : "border-crimson/30",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3 p-3.5 min-[520px]:flex-col min-[520px]:gap-0 min-[520px]:p-0">
        <span
          aria-hidden
          className={cn(
            "flex h-[4.5rem] w-[4.5rem] shrink-0 items-end justify-center rounded-xl p-2 min-[520px]:h-24 min-[520px]:w-full min-[520px]:rounded-none min-[520px]:border-b min-[520px]:border-line min-[520px]:px-6 min-[520px]:pb-0 min-[520px]:pt-5",
            x.activo ? "bg-granate-50" : "bg-paperSoft grayscale",
          )}
        >
          <Pixel nombre={spriteLugar(x)} escala={3} animado={false} acento="accion" className="px-salta max-h-full max-w-full" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col min-[520px]:px-3.5 min-[520px]:pb-3.5 min-[520px]:pt-3">
          <p className="flex min-w-0 flex-wrap items-center gap-1.5">
            <InsigniaCategoria categoria={x.categoria} />
            {seguro && <span className="truncate rounded-full bg-paperSoft px-2 py-0.5 text-rotulo font-semibold text-inkSoft ring-1 ring-line">{seguro}</span>}
          </p>
          <h3 className="mt-1.5 text-cuerpo font-bold leading-snug text-ink">
            <Link
              href={rutaEn(base, rutaFicha(x.codigo))}
              prefetch={false}
              className="group line-clamp-2 underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:text-granate group-hover:underline focus-visible:outline-none"
            >
              {nombre}
            </Link>
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1 text-meta text-inkSoft">
            <MapPin size={13} aria-hidden className="shrink-0 text-mute" />
            <span className="truncate">{lugarIpress(x)}</span>
          </p>
          {conDireccion && x.direccion && <p className="mt-0.5 line-clamp-2 text-rotulo text-mute">{direccionLegible(x.direccion)}</p>}
          {!x.activo && <InsigniaRegistro activo={x.activo} estado={x.estado} className="mt-2 self-start" />}

          {rasgos.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Lo que tiene">
              {rasgos.map((r) => (
                <li key={r.texto} title={r.titulo} className="inline-flex items-center gap-1 rounded-md bg-paperSoft px-1.5 py-0.5 text-rotulo font-medium text-inkSoft">
                  <r.Icono size={12} aria-hidden className="shrink-0 text-mute" />
                  {r.texto}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-auto flex flex-wrap gap-1.5 pt-3 text-meta" aria-label="Señales">
            {x.sanciones > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-crimson/10 px-2.5 py-1 font-semibold text-crimsonTexto" title={CLASES_DE_HECHO.sancion_firme.explica}>
                <Gavel size={14} aria-hidden className="shrink-0" />
                <span>
                  <b className="font-bold tabular-nums">{numero(x.sanciones)}</b> {x.sanciones === 1 ? "sanción firme" : "sanciones firmes"}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mossTexto/10 px-2.5 py-1 font-semibold text-mossTexto">
                <ShieldCheck size={14} aria-hidden className="shrink-0" />
                Sin sanciones firmes
              </span>
            )}
            {denuncias > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-2.5 py-1 font-semibold text-amberTexto" title={CLASES_DE_HECHO.denuncia.explica}>
                <MessageSquareWarning size={14} aria-hidden className="shrink-0" />
                <span>
                  <b className="font-bold tabular-nums">{numero(denuncias)}</b> {denuncias === 1 ? "denuncia" : "denuncias"}
                  {x.denunciasDe ? ` en ${x.denunciasDe}` : ""}
                  {x.denunciasDe === new Date().getFullYear() ? " (parcial)" : ""}
                </span>
              </span>
            )}
          </p>
          {children && <div className="relative z-10 mt-2.5">{children}</div>}
        </div>
      </div>
    </article>
  );
}

/** La rejilla de las casillas: 1 columna en el celular chico, 2 desde 520 px, 3 en pantalla ancha. */
export const REJILLA_TARJETAS = "grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 xl:grid-cols-3";
