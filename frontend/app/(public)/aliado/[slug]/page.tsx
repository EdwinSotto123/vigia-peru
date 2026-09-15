import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/financiar/RankingTable";
import { API_BASE } from "@/lib/api-client";

export const revalidate = 120;

interface Aliado { id: number; tipo: "empresa" | "persona" | "organizacion"; nombre: string; slug: string; logoUrl: string | null; desde: string }
interface Contrib { codigo: string; contratos: number; estado: string; pagadaAt: string; ubigeo: string; zona: string; nivel: string; procesados: number; senales: number }

export default async function AliadoPage({ params }: { params: { slug: string } }) {
  let data: { aliado: Aliado; contribuciones: Contrib[] } | null = null;
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(params.slug)}`, { next: { revalidate: 120 } } as any);
    if (r.ok) data = await r.json();
  } catch { /* 404 abajo */ }
  if (!data) notFound();
  const { aliado, contribuciones } = data;
  const total = contribuciones.reduce((n, c) => n + c.contratos, 0);
  const procesados = contribuciones.reduce((n, c) => n + c.procesados, 0);
  const senales = contribuciones.reduce((n, c) => n + c.senales, 0);
  const zonas = new Set(contribuciones.map((c) => c.ubigeo)).size;

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-4">
          <Avatar tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-mute">Aliado de transparencia · {aliado.tipo}</div>
            <h1 className="font-serif text-4xl font-bold text-ink">{aliado.nombre}</h1>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <K label="Contratos financiados" v={total} />
          <K label="Procesados" v={procesados} />
          <K label="Señales halladas" v={senales} />
          <K label="Zonas apoyadas" v={zonas} />
        </div>
        <h2 className="mt-8 font-semibold text-ink">Contribuciones</h2>
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
          {contribuciones.map((c) => (
            <li key={c.codigo} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <Link href={`/impacto/${c.codigo}`} className="font-mono text-ink hover:underline">{c.codigo}</Link>
                <span className="text-mute"> · </span>
                <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
                <div className="text-[11px] text-mute">{new Date(c.pagadaAt).toLocaleDateString("es-PE")} · {c.estado.replace("_", " ")}</div>
              </div>
              <div className="text-right font-mono text-sm text-ink">{c.procesados}/{c.contratos}<div className="text-[10px] uppercase text-mute">{c.senales} señales</div></div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function K({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-xl text-ink">{v.toLocaleString("es-PE")}</div>
    </div>
  );
}
