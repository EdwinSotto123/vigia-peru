"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate } from "@/lib/admin";

interface Entry { actor: string; accion: string; objeto: string; detalle: any; createdAt: string }

export default function BitacoraPage() {
  const [rows, setRows] = useState<Entry[]>([]);
  useEffect(() => { adminFetch<{ data: Entry[] }>("/log").then((r) => setRows(r.data)).catch(() => {}); }, []);
  return (
    <AdminShell title="Bitácora" subtitle="Toda acción administrativa queda registrada con autor y fecha">
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full text-sm">
          <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="px-3 py-2">Cuándo</th><th>Quién</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-mute">Sin acciones registradas.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2 text-[12px] text-mute">{fmtDate(r.createdAt)}</td>
                <td>{r.actor}</td>
                <td><span className="rounded bg-paperDeep px-1.5 py-0.5 font-mono text-[11px]">{r.accion}</span></td>
                <td className="font-mono text-xs">{r.objeto}</td>
                <td className="max-w-md truncate text-[12px] text-mute">{r.detalle ? JSON.stringify(r.detalle) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
