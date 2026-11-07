"use client";

import { CalendarPlus } from "lucide-react";
import { crearIcs } from "@/lib/licitaciones-app/ics";

/** Baja los plazos con fecha como .ics (Google Calendar, Outlook, el celular), con un aviso un día antes. */
export function BotonIcs({ id, codigo, hitos, url }: { id: string; codigo: string | null; hitos: { clave: string; etiqueta: string; fecha: string }[]; url: string }) {
  const bajar = () => {
    const ics = crearIcs(hitos.map((h) => ({ uid: `${id}-${h.clave}`, titulo: `${h.etiqueta}: ${codigo ?? id}`, fecha: h.fecha, url })));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    a.download = `plazos-${codigo ?? id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <button
      type="button"
      onClick={bajar}
      disabled={!hitos.length}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-caja px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-ink/20 disabled:opacity-50"
    >
      <CalendarPlus size={15} aria-hidden /> Añadir a mi calendario
    </button>
  );
}
