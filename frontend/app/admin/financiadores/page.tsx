"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, AlertTriangle, ExternalLink } from "lucide-react";
import { AdminShell, Badge } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, fmtDate } from "@/lib/admin";
import { useDialog } from "@/components/admin/Dialog";

interface F {
  id: number; tipo: string; nombrePublico: string | null; slug: string | null; ruc: string | null; email: string; logoUrl: string | null;
  visible: boolean; motivoNoVisible: string | null; createdAt: string; aportes: number; contratosFinanciados: number; montoPen: number;
  sancionVigente: boolean; alertasActivas: boolean;
}

export default function FinanciadoresPage() {
  const [rows, setRows] = useState<F[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const { open, toast } = useDialog();
  async function load() { try { setRows((await adminFetch<{ data: F[] }>("/financiadores")).data); } catch (e) { setMsg((e as Error).message); } }
  useEffect(() => { load(); }, []);

  function toggle(f: F) {
    const nombre = f.nombrePublico ?? f.email;
    if (f.visible) {
      open({
        title: `Ocultar a ${nombre}`, tone: "danger", confirmLabel: "Ocultar del ranking y muro",
        body: <>No toca su dinero ni sus asignaciones: solo deja de aparecer en ranking, muro y comprobantes públicos (regla 3 de independencia).</>,
        fields: [{ name: "motivo", label: "Motivo", type: "select", defaultValue: "decision_admin", options: [
          { value: "decision_admin", label: "Decisión del equipo" }, { value: "sancion_vigente_osce", label: "Sanción OSCE vigente" },
          { value: "proveedor_con_alertas_activas", label: "Proveedor con alertas activas" }, { value: "solicitud_del_financiador", label: "Lo pidió el financiador" }] }],
        onConfirm: async (v) => { await adminFetch(`/financiadores/${f.id}`, { method: "PATCH", body: JSON.stringify({ visible: false, motivoNoVisible: v.motivo }) }); toast(`${nombre} oculto`); load(); },
      });
    } else {
      open({
        title: `Volver visible a ${nombre}`, tone: "success", confirmLabel: "Mostrar",
        body: <>{f.sancionVigente && <p className="text-rust">Ojo: tiene sanción OSCE vigente.</p>}{f.alertasActivas && <p className="text-rust">Ojo: aparece como proveedor en alertas activas.</p>}<p>Volverá a aparecer en ranking, muro y comprobantes.</p></>,
        onConfirm: async () => { await adminFetch(`/financiadores/${f.id}`, { method: "PATCH", body: JSON.stringify({ visible: true }) }); toast(`${nombre} visible`); load(); },
      });
    }
  }

  function editar(f: F) {
    open({
      title: "Editar financiador", confirmLabel: "Guardar",
      fields: [
        { name: "nombre", label: "Nombre público", defaultValue: f.nombrePublico ?? "", placeholder: "Vacío = anónimo" },
        { name: "logo", label: "URL del logo", defaultValue: f.logoUrl ?? "", placeholder: "https://…/logo.png", hint: "PNG/SVG cuadrado, fondo transparente." },
      ],
      onConfirm: async (v) => {
        await adminFetch(`/financiadores/${f.id}`, { method: "PATCH", body: JSON.stringify({ nombrePublico: v.nombre || null, logoUrl: v.logo || null }) });
        toast("Financiador actualizado"); load();
      },
    });
  }

  return (
    <AdminShell title="Financiadores" subtitle="Quién aporta, cuánto, y quién queda sin reconocimiento público por conflicto de interés">
      {msg && <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson-soft p-3 text-sm text-crimson">{msg}</div>}
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full text-sm">
          <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute">
            <tr><th className="px-3 py-2">Financiador</th><th>Tipo</th><th>RUC / email</th><th className="text-right">Aportes</th><th className="text-right">Contratos</th><th className="text-right">Monto</th><th>Visibilidad</th><th>Alta</th><th></th></tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-mute">Todavía no hay financiadores.</td></tr>}
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {f.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.logoUrl} alt="" className="h-6 w-6 rounded border border-line object-contain" /> : null}
                    <span className="font-medium text-ink">{f.nombrePublico ?? <span className="text-mute">Anónimo</span>}</span>
                    {f.slug && <Link href={`/aliado/${f.slug}`} target="_blank" className="text-mute hover:text-ink"><ExternalLink size={12} /></Link>}
                  </div>
                  {(f.sancionVigente || f.alertasActivas) && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-rust"><AlertTriangle size={11} />{f.sancionVigente ? "sanción OSCE vigente" : "proveedor con alertas activas"}</div>
                  )}
                </td>
                <td className="text-xs text-mute">{f.tipo}</td>
                <td className="text-xs"><div className="font-mono">{f.ruc ?? "—"}</div><div className="text-mute">{f.email}</div></td>
                <td className="text-right font-mono">{f.aportes}</td>
                <td className="text-right font-mono">{f.contratosFinanciados}</td>
                <td className="text-right font-mono">{fmtPEN(f.montoPen)}</td>
                <td>{f.visible ? <Badge cls="bg-moss/10 text-moss">visible</Badge> : <Badge cls="bg-crimson-soft text-crimson">oculto · {f.motivoNoVisible?.replace(/_/g, " ")}</Badge>}</td>
                <td className="text-[11px] text-mute">{fmtDate(f.createdAt)}</td>
                <td className="pr-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => editar(f)} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-paperDeep">Editar</button>
                    <button onClick={() => toggle(f)} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-paperDeep" title={f.visible ? "Ocultar" : "Mostrar"}>{f.visible ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-mute">Ocultar a un financiador no toca su dinero ni sus asignaciones: solo lo saca del ranking, del muro de aliados y de los comprobantes públicos (regla 3 de independencia).</p>
    </AdminShell>
  );
}
