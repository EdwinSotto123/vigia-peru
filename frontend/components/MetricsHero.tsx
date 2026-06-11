"use client";

import { AlertTriangle, MapPinned, Eye, Coins } from "lucide-react";
import { METRICAS_MOCK, formatSoles } from "@/lib/mock-data";
import { NumberTicker } from "@/components/magicui/NumberTicker";

export function MetricsHero() {
  const m = METRICAS_MOCK;
  const items: {
    label: string;
    value: number;
    formatted?: (n: number) => string;
    hint: string;
    icon: React.ReactNode;
    tone: string;
    bg: string;
  }[] = [
    {
      label: "Alertas automáticas activas",
      value: m.alertasActivas,
      hint: "este mes",
      icon: <AlertTriangle size={18} />,
      tone: "text-amber",
      bg: "bg-amber-soft",
    },
    {
      label: "Reportes ciudadanos",
      value: m.reportesCiudadanos,
      hint: "verificados o en cola",
      icon: <MapPinned size={18} />,
      tone: "text-crimson",
      bg: "bg-crimson-soft",
    },
    {
      label: "Casos convergentes",
      value: m.casosConvergentes,
      hint: "máquina + ciudadano",
      icon: <Eye size={18} />,
      tone: "text-bone",
      bg: "bg-coal",
    },
    {
      label: "Monto vigilado",
      value: m.montoVigiladoSoles,
      formatted: (n) => formatSoles(n),
      hint: `${m.contratosVigilados.toLocaleString("es-PE")} contratos`,
      icon: <Coins size={18} />,
      tone: "text-navy",
      bg: "bg-navy-soft",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="surface p-5">
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${it.bg} ${it.tone}`}
          >
            {it.icon}
          </span>
          <div className="mt-4 font-serif text-3xl font-bold text-ink">
            <NumberTicker
              value={it.value}
              duration={1700}
              formatter={it.formatted}
            />
          </div>
          <div className="mt-1 text-sm font-medium text-ink">{it.label}</div>
          <div className="text-xs text-ash">{it.hint}</div>
        </div>
      ))}
    </div>
  );
}
