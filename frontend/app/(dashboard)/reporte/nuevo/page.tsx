"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Camera,
  Lock,
  ArrowLeft,
  Building2,
  HardHat,
  Flag,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REGIONES } from "@/lib/peru-data";
import { Confirmacion } from "@/components/reporte/Confirmacion";
import { FormObra } from "@/components/reporte/FormObra";
import { FormEntidad } from "@/components/reporte/FormEntidad";
import type { Modo } from "@/components/reporte/types";

export default function ReporteNuevoPage() {
  return (
    <Suspense fallback={<div className="container-page py-10">Cargando…</div>}>
      <ReporteNuevoInner />
    </Suspense>
  );
}

function ReporteNuevoInner() {
  const search = useSearchParams();
  const initialModo: Modo = search.get("modo") === "entidad" ? "entidad" : "obra";
  const initialRuc = search.get("ruc") ?? "";
  // Viene del hub del mapa: /reporte/nuevo?region=lima → prellenamos la región.
  const initialRegion = REGIONES.find((r) => r.id === (search.get("region") ?? "").toLowerCase())?.nombre ?? "";

  const [modo, setModo] = useState<Modo>(initialModo);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [okRegion, setOkRegion] = useState<string | null>(null);   // nombre de región del reporte enviado (enlace al pin)

  return (
    <div className="container-page max-w-3xl space-y-8 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver al mapa
      </Link>

      <header className="overflow-hidden rounded-3xl border border-line bg-ink text-paper">
        <div className="relative px-6 py-8 sm:px-10 sm:py-10">
          {/* glow sutil — mismo verde de marca que la pantalla de confirmación de este
              mismo flujo (Confirmacion.tsx), para que "antes" y "después" de enviar se
              sientan como un solo viaje en vez de dos paletas sueltas. */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-heroGreen/20 blur-3xl" />
          <div className="relative space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-paper/20 bg-paper/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-heroGreenTexto">
              <Camera size={12} /> Vigilancia ciudadana
            </span>
            <h1 className="font-serif text-4xl font-bold leading-[1.05] sm:text-5xl">
              Lo que viste<br />
              <span className="text-heroGreen">el Estado no lo puede ignorar.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Sube una foto y cuéntanos qué pasa. En minutos, nuestros agentes la
              cruzan con contratos del SEACE, SUNAT y obras públicas. Tú eres los
              ojos que el sistema no tiene.
            </p>
            {/* tres promesas honestas */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { icon: <Lock size={13} />, text: "100% anónimo" },
                { icon: <Zap size={13} />, text: "Cruzado con datos del Estado" },
                { icon: <Flag size={13} />, text: "Si coincide → caso público" },
              ].map((p) => (
                <span
                  key={p.text}
                  className="inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1.5 text-xs font-medium text-paper/90"
                >
                  <span className="text-heroGreen">{p.icon}</span> {p.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-paperSoft p-1.5">
        <TabBig
          active={modo === "obra"}
          onClick={() => setModo("obra")}
          icon={<HardHat size={18} />}
          title="Una obra específica"
          subtitle="Obra paralizada, fantasma, etc."
        />
        <TabBig
          active={modo === "entidad"}
          onClick={() => setModo("entidad")}
          icon={<Building2 size={18} />}
          title="Una entidad del Estado"
          subtitle="Patrón sistemático en una institución"
        />
      </div>

      {ok ? (
        <Confirmacion id={ok} modo={modo} regionNombre={okRegion} />
      ) : modo === "obra" ? (
        <FormObra
          initialRegion={initialRegion}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={(id, region) => { setOkRegion(region ?? null); setOk(id); }}
        />
      ) : (
        <FormEntidad
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={setOk}
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
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        active
          ? "bg-ink text-paper shadow-card"
          : "bg-transparent text-mute hover:bg-paper hover:text-ink",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-paper/15 text-paper" : "bg-paperDeep text-mute",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className={cn("text-xs", active ? "text-paper/70" : "text-mute")}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}
