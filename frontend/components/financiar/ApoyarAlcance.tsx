"use client";

/**
 * Lo que va a la derecha de la ficha de una zona, una entidad o un partido en /app/financiar. Hasta el 2026-10-30 era el
 * formulario para pagar la lectura de N contratos a la tarifa vigente («S/ X por contrato», ContribuirForm): la venta de
 * un servicio, que pedía RUC, comprobantes y Libro de Reclamaciones, y que mezclaba las donaciones con un negocio ante
 * SUNAT (auditoría legal del 2026-10-30). El usuario decidió que fuera una donación: esta tarjeta dice qué pasa con el
 * aporte (va al fondo común; lo que se mira queda como destino sugerido y no decide qué se lee) y lleva a /app/apoyar,
 * donde se aporta, con `?para=`.
 *
 * Un partido no tiene destino sugerido (la base guarda un RUC o un ubigeo): lleva a /app/apoyar a secas. Una entidad con
 * RUC 10 es una persona: su nombre no se muestra ni viaja como destino (docs/PRIVACIDAD.md). El nombre llega ya
 * legible desde la página (tituloNatural), que es server component.
 *
 * Con sesión de administrador y contratos en cola, el lote a nombre de Vigía Perú (LoteAdmin), que no cobra nada.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Building2, CalendarCheck, Landmark, MapPin, PiggyBank } from "lucide-react";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { rutaApoyar } from "@/lib/rutas";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { cn } from "@/lib/utils";
import { LoteAdmin } from "./LoteAdmin";
import { MarcaMercadoPago, MarcaPlin, MarcaYape, TarjetasAceptadas } from "./MarcasPago";
import { esRucPersona } from "./NombreEntidad";
import { ETIQUETA_GRUPO, TARJETA } from "./PasosAporte";
import type { AlcanceAporte } from "./alcanceAporte";

/** Los medios de pago abiertos hoy (lib/financiamiento `mediosAbiertos`), para mostrar sus marcas. */
export interface MediosAbiertos {
  tarjeta: boolean;
  yape: boolean;
  plin: boolean;
}

export function ApoyarAlcance({ alcance, medios, lote = null }: {
  alcance: AlcanceAporte;
  medios: MediosAbiertos;
  /** El lote del administrador: los contratos en cola y la tarifa de referencia. Sin cola, no hay lote. */
  lote?: { precioPen: number; restantes: number; padre?: { ubigeo: string; nombre: string } | null } | null;
}) {
  const esAdmin = useEsAdmin();
  if (esAdmin && lote && lote.restantes > 0) return <LoteAdmin alcance={alcance} {...lote} />;
  return <TarjetaApoyo alcance={alcance} medios={medios} />;
}

function TarjetaApoyo({ alcance, medios }: { alcance: AlcanceAporte; medios: MediosAbiertos }) {
  const persona = alcance.tipo === "entidad" && esRucPersona(alcance.ruc);
  const nombre = persona ? "esta entidad" : alcance.nombre;
  const para = persona ? null : alcance.tipo === "zona" ? alcance.ubigeo : alcance.tipo === "entidad" ? alcance.ruc : null;
  const hayMedios = medios.tarjeta || medios.yape || medios.plin;
  return (
    <div className={cn(TARJETA, "space-y-5")}>
      <div className="space-y-1.5">
        <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink">
          {alcance.tipo === "partido" ? `Ayuda a vigilar a los gobiernos de ${nombre}` : `Ayuda a vigilar ${nombre}`}
        </h2>
        <p className="text-pretty text-dato leading-relaxed text-inkSoft">
          Vigía cruza cada día lo que compra el Estado y lee a fondo lo más grave. Tu aporte va al fondo común que lo sostiene.
        </p>
      </div>

      <ul className="space-y-3.5" aria-label="Qué pasa con tu aporte">
        <Punto icono={<PiggyBank size={18} />} titulo="Va al fondo común">
          Servidores, la base de datos, los datos de cada día y la lectura a fondo de lo más grave, en todo el Perú.
        </Punto>
        {para ? (
          <Punto icono={alcance.tipo === "zona" ? <MapPin size={18} /> : <Building2 size={18} />} titulo={`${nombre}, como destino sugerido`}>
            Sale en tu constancia. No decide qué se lee: lo más grave va primero, sea de donde sea.
          </Punto>
        ) : (
          <Punto icono={<Landmark size={18} />} titulo="Nadie elige qué se lee">
            Lo más grave va primero, sea {alcance.tipo === "partido" ? "del gobierno" : "de la entidad"} que sea.
          </Punto>
        )}
        <Punto icono={<CalendarCheck size={18} />} titulo="Desde S/ 5, una vez o cada mes">
          No se cobra por contrato ni por lectura.
        </Punto>
      </ul>

      {hayMedios && (
        <div className="space-y-2 border-t border-line pt-4">
          <span className={cn(ETIQUETA_GRUPO, "block")}>Cómo pagas</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {medios.tarjeta && (
              <>
                <MarcaMercadoPago />
                <TarjetasAceptadas />
              </>
            )}
            {medios.yape && <MarcaYape />}
            {medios.plin && <MarcaPlin />}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <EnlaceAccion href={rutaApoyar(para)} tamano="md" flecha className="w-full sm:w-auto">
          Aportar
        </EnlaceAccion>
        <Link
          href="/app/cuanto-cuesta"
          prefetch={false}
          className="inline-flex min-h-[40px] items-center gap-1 text-dato font-semibold text-granate underline-offset-2 hover:underline"
        >
          En qué se usa el fondo <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/** Una cosa que pasa con el aporte: su ícono, lo que es y una línea que lo explica. */
function Punto({ icono, titulo, children }: { icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-granate">
        {icono}
      </span>
      <span className="min-w-0">
        <span className="block text-dato font-semibold leading-snug text-ink">{titulo}</span>
        <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{children}</span>
      </span>
    </li>
  );
}
