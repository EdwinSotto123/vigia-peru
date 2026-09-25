import Image from "next/image";
import Link from "next/link";
import { BarraCompartir } from "@/components/patrones";
import { FranjaTextil, Isotipo } from "@/components/marca";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fecha, numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AvatarAliado, esFundador } from "./TarjetaAliado";
import { SelloMaqueta } from "./AvisoMaqueta";
import { ContactoAliado, IdentidadAliado, Insignias, type DatoIdentidad, type Insignia } from "./IdentidadAliado";
import { Puesto } from "./Podio";
import type { AliadoPerfil } from "./perfil";

/**
 * La cabecera del perfil público de un aliado (DESIGN_SYSTEM.md §14.6): la página que
 * una empresa quiere mostrar y compartir, armada como un perfil social. Portada (su
 * imagen, o la marca de Vigía con la franja textil), el logo grande superpuesto, su
 * nombre, su puesto en el ranking y lo que el aliado publicó de sí mismo; debajo, las
 * dos acciones: compartir y financiar.
 *
 * Sólo lo que el aliado publicó: sin descripción, web, correo o redes no hay hueco. El
 * correo es el de contacto que eligió mostrar, nunca el del pago.
 */

const TIPO: Record<AliadoPerfil["tipo"], { texto: string; icono: DatoIdentidad["icono"] }> = {
  empresa: { texto: "Empresa", icono: "tipo-empresa" },
  organizacion: { texto: "Organización", icono: "tipo-organizacion" },
  persona: { texto: "Persona", icono: "tipo-persona" },
};

const esImagen = (v: string | null | undefined): v is string => !!v && /^(https:\/\/|\/)[^\s"'<>]+$/i.test(v);

export function PortadaAliado({
  aliado,
  puesto,
  insignias,
  aportes,
  ruta,
  hrefRanking,
  esMaqueta = false,
}: {
  aliado: AliadoPerfil;
  /** "#3 de 12": su lugar en el ranking de todo el Perú, desde el inicio. */
  puesto: { puesto: number; de: number } | null;
  insignias: Insignia[];
  /** Cuántos aportes confirmados tiene (se dice junto a su tipo). */
  aportes: number;
  /** La ruta relativa de este perfil, para compartirlo. */
  ruta: string;
  hrefRanking: string;
  esMaqueta?: boolean;
}) {
  const fundador = esFundador(aliado);
  const tipo = TIPO[aliado.tipo];
  const identidad: DatoIdentidad[] = [
    { icono: fundador ? "tipo-organizacion" : tipo.icono, texto: fundador ? "La propia plataforma, con capital semilla" : tipo.texto },
    ...(aliado.desde ? [{ icono: "fecha" as const, texto: `Aliado desde el ${fecha(aliado.desde)}` }] : []),
    { icono: "aportes", texto: plural(aportes, "aporte", "aportes") },
  ];

  return (
    <section
      aria-label={`Perfil de ${aliado.nombre}`}
      className={cn("overflow-hidden rounded-2xl border bg-paper", esMaqueta ? "border-dashed border-amber/60" : "border-line")}
    >
      {/* Portada: su imagen si la publicó; si no, un momento de marca de Vigía (§3.8) con
          la franja textil al pie. Nada de texto sobre la franja (§6). */}
      <div className="sobre-oscuro relative h-28 bg-granate-deep sm:h-40">
        {esImagen(aliado.portadaUrl) ? (
          <Image src={aliado.portadaUrl} alt="" fill unoptimized priority className="object-cover" />
        ) : (
          <>
            <p className="absolute right-4 top-3.5 inline-flex items-center gap-2 text-[12.5px] font-medium text-paper/80 sm:right-6 sm:top-5">
              <Isotipo tamano={22} />
              Aliado de transparencia de Vigía Perú
            </p>
            <FranjaTextil alto={16} className="absolute inset-x-0 bottom-0" />
          </>
        )}
      </div>

      <div className="px-4 pb-5 sm:px-7 sm:pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
          {/* El logo sobre la portada, con un marco de papel que lo separa de ella. `relative z-[1]`:
              sin posición propia, la franja (absoluta) de la portada lo tapaba por arriba. */}
          <div className="relative z-[1] -mt-12 w-fit shrink-0 rounded-3xl bg-paper p-1.5 shadow-card sm:-mt-14">
            <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="perfil" maqueta={esMaqueta} />
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[28px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[34px]">
              {aliado.nombre}
              {esMaqueta && <SelloMaqueta className="font-sans" />}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {puesto && (
                <Link
                  href={hrefRanking}
                  className="inline-flex min-h-[32px] items-center gap-2 rounded-full text-[13px] font-medium text-inkSoft underline-offset-2 hover:text-granate hover:underline"
                >
                  <Puesto n={puesto.puesto} />
                  de {numero(puesto.de)} {puesto.de === 1 ? "aliado" : "aliados"}
                </Link>
              )}
              <IdentidadAliado datos={identidad} />
            </div>
          </div>
        </div>

        {aliado.descripcion && (
          <p className="mt-4 max-w-[70ch] text-[15px] leading-relaxed text-inkSoft text-pretty">{aliado.descripcion}</p>
        )}

        <ContactoAliado web={aliado.web} email={aliado.email} redes={aliado.redes} className="mt-4" />

        <Insignias insignias={insignias} className="mt-4" />

        {/* Las dos acciones del perfil (§14.6): compartirlo y financiar como él. */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <BarraCompartir
            ruta={ruta}
            texto={`${aliado.nombre} financia la lectura de contratos públicos en Vigía Perú`}
            titulo={`${aliado.nombre}, aliado de transparencia`}
          />
          <EnlaceAccion href="/app/financiar" flecha className="w-full sm:w-auto">
            Financiar como {aliado.nombre}
          </EnlaceAccion>
        </div>
      </div>
    </section>
  );
}
