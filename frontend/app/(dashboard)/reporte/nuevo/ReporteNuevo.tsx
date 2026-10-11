"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, HardHat, UserX, MapPin, Eye, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { REGIONES } from "@/lib/peru-data";
import { EncabezadoPagina, Pagina } from "@/components/patrones";
import { Confirmacion } from "@/components/reporte/Confirmacion";
import { FormObra } from "@/components/reporte/FormObra";
import { FormEntidad } from "@/components/reporte/FormEntidad";
import type { Modo } from "@/components/reporte/types";

/**
 * El formulario de denuncia. Vive aparte de page.tsx para que la página pueda
 * ser un server component con `metadata`.
 *
 * En un teléfono de 390 px, el encabezado oscuro con su titular de dos líneas,
 * el párrafo y tres píldoras empujaba el botón "Tomar foto" a 1.300 px del borde
 * superior: había que bajar tres pantallas para empezar. Ahora el encabezado es
 * el del sistema (título, una línea de contexto) sobre papel, y lo que promete la
 * denuncia cambia según qué se denuncia: una obra se publica, una entidad no.
 */

/** Tres cosas que el código sí hace, por tipo de denuncia. */
const PROMESAS: Record<Modo, { icono: React.ReactNode; texto: string }[]> = {
  obra: [
    { icono: <UserX size={14} />, texto: "Sin cuenta ni nombre" },
    { icono: <MapPin size={14} />, texto: "Con tu foto y el lugar" },
    { icono: <Eye size={14} />, texto: "Pública desde que la envías" },
  ],
  entidad: [
    { icono: <UserX size={14} />, texto: "Sin cuenta ni nombre" },
    { icono: <Building2 size={14} />, texto: "A nombre de una entidad del Estado" },
    { icono: <Lock size={14} />, texto: "Queda en reserva: no se publica" },
  ],
};

export function ReporteNuevo() {
  const search = useSearchParams();
  const initialModo: Modo = search.get("modo") === "entidad" ? "entidad" : "obra";
  const initialRuc = search.get("ruc") ?? "";
  // Viene del hub del mapa: /reporte/nuevo?region=lima → se precarga la región.
  const initialRegion = REGIONES.find((r) => r.id === (search.get("region") ?? "").toLowerCase())?.nombre ?? "";

  const [modo, setModo] = useState<Modo>(initialModo);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [okRegion, setOkRegion] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0); // cambia la `key` de los formularios para dejarlos en blanco

  const otra = () => {
    setOk(null);
    setOkRegion(null);
    setVuelta((v) => v + 1);
    window.scrollTo({ top: 0 });
  };

  // `Pagina` como toda la app: el formulario usa todo el ancho porque son tres columnas (desde lg) que se
  // habilitan una tras otra; en el teléfono se apilan como un acordeón de pasos.
  return (
    <Pagina>
      <div className="space-y-3">
        <Link href="/app/denuncias" className="inline-flex min-h-[44px] items-center gap-2 text-[13px] font-medium text-inkSoft hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Volver a las denuncias
        </Link>

        {/* Una sola franja: título, frase, las tres garantías y el tipo de denuncia como pestañas. */}
        <div className="space-y-3 rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:px-5">
          <EncabezadoPagina
            titulo="Denuncia lo que viste"
            bajada={
              modo === "obra"
                ? "Sube una foto, marca el lugar y cuenta qué pasa. Se publica para que cualquiera la vea."
                : "Elige la entidad y cuenta el patrón que viste. Tu denuncia queda en reserva: no se publica."
            }
            acciones={
              <div className="grid w-full grid-cols-2 gap-1 rounded-full border border-line bg-paperDeep p-1 sm:w-auto" role="group" aria-label="Qué quieres denunciar">
                <TabBig active={modo === "obra"} onClick={() => setModo("obra")} icon={<HardHat size={16} />} title="Una obra" subtitle="Paralizada, fantasma, mal hecha" />
                <TabBig active={modo === "entidad"} onClick={() => setModo("entidad")} icon={<Building2 size={16} />} title="Una entidad" subtitle="Un patrón en una institución" />
              </div>
            }
          />
          <ul className="flex flex-wrap gap-2" aria-label="Qué pasa con tu denuncia">
            {PROMESAS[modo].map((p) => (
              <li key={p.texto} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-inkSoft">
                <span className="text-granate" aria-hidden>
                  {p.icono}
                </span>
                {p.texto}
              </li>
            ))}
          </ul>
        </div>

        {ok ? (
          <div className="max-w-3xl">
            <Confirmacion id={ok} modo={modo} regionNombre={okRegion} onOtra={otra} />
          </div>
        ) : modo === "obra" ? (
          <FormObra
            key={`obra-${vuelta}`}
            initialRegion={initialRegion}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onDone={(id, region) => {
              setOkRegion(region ?? null);
              setOk(id);
              window.scrollTo({ top: 0 });
            }}
          />
        ) : (
          <FormEntidad
            key={`entidad-${vuelta}`}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onDone={(id) => {
              setOk(id);
              window.scrollTo({ top: 0 });
            }}
            initialRuc={initialRuc}
          />
        )}
      </div>
    </Pagina>
  );
}

function TabBig({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={subtitle}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-rapido",
        // Granate = la opción elegida (selección de marca), no una advertencia.
        active ? "bg-granate text-paper" : "bg-transparent text-inkSoft hover:bg-paper hover:text-ink",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{title}</span>
      <span className="sr-only">: {subtitle}</span>
    </button>
  );
}
