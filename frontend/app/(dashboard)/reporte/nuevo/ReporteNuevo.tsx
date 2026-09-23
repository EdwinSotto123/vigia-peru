"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Camera, ArrowLeft, Building2, HardHat, UserX, MapPin, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { REGIONES } from "@/lib/peru-data";
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
 * superior: había que bajar tres pantallas para empezar. Ahora, debajo de `sm`,
 * el encabezado es una línea de título y una de contexto.
 */
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

  return (
    <div className="container-page max-w-3xl space-y-5 py-6 sm:space-y-8 sm:py-10">
      <Link href="/app/denuncias" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Volver a las denuncias
      </Link>

      <header className="overflow-hidden rounded-3xl border border-line bg-ink text-paper">
        <div className="relative px-5 py-5 sm:px-10 sm:py-10">
          <div className="pointer-events-none absolute -right-16 -top-16 hidden h-56 w-56 rounded-full bg-heroGreen/20 blur-3xl sm:block" aria-hidden />
          <div className="relative space-y-2 sm:space-y-4">
            <span className="hidden items-center gap-1.5 rounded-full border border-paper/20 bg-paper/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-heroGreen sm:inline-flex">
              <Camera size={12} aria-hidden /> Vigilancia ciudadana
            </span>
            <h1 className="font-serif text-2xl font-bold leading-tight sm:text-5xl sm:leading-[1.05]">
              Denuncia lo que viste
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-paper/80 sm:text-lg">
              Sube una foto, marca el lugar y cuenta qué pasa. Se publica para que cualquiera la vea.
            </p>
            {/* Tres cosas que el código sí hace. Antes decía "100% anónimo",
                "cruzado con datos del Estado" y "si coincide, caso público":
                ninguna era cierta. */}
            <ul className="hidden flex-wrap gap-2 pt-1 sm:flex">
              {[
                { icon: <UserX size={13} />, text: "Sin cuenta ni nombre" },
                { icon: <MapPin size={13} />, text: "Con tu foto y el lugar" },
                { icon: <Eye size={13} />, text: "Pública desde que la envías" },
              ].map((p) => (
                <li key={p.text} className="inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1.5 text-xs font-medium text-paper/90">
                  <span className="text-heroGreen" aria-hidden>
                    {p.icon}
                  </span>{" "}
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-paperSoft p-1.5" role="group" aria-label="Qué quieres denunciar">
        <TabBig
          active={modo === "obra"}
          onClick={() => setModo("obra")}
          icon={<HardHat size={18} />}
          title="Una obra"
          subtitle="Paralizada, fantasma, mal hecha"
        />
        <TabBig
          active={modo === "entidad"}
          onClick={() => setModo("entidad")}
          icon={<Building2 size={18} />}
          title="Una entidad"
          subtitle="Un patrón en una institución"
        />
      </div>

      {ok ? (
        <Confirmacion id={ok} modo={modo} regionNombre={okRegion} onOtra={otra} />
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
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors sm:px-4 sm:py-3",
        active ? "bg-ink text-paper shadow-card" : "bg-transparent text-inkSoft hover:bg-paper hover:text-ink",
      )}
    >
      <span
        className={cn(
          "hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:flex",
          active ? "bg-paper/15 text-paper" : "bg-paperDeep text-mute",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cn("block text-xs", active ? "text-paper/80" : "text-mute")}>{subtitle}</span>
      </span>
    </button>
  );
}
