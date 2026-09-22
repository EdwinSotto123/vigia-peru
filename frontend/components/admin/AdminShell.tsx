"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Receipt, Users, Wallet, ScrollText, LogOut, ExternalLink, ShieldCheck, FlaskConical, Grid3x3, Database, Activity, Eye } from "lucide-react";
import { Marca } from "@/components/Marca";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/admin/contribuciones", label: "Contribuciones", icon: Receipt },
  { href: "/admin/financiadores", label: "Financiadores", icon: Users },
  { href: "/admin/pagos", label: "Medios de pago", icon: Wallet },
  { href: "/admin/revision", label: "Revisión humana", icon: Eye },
  { href: "/admin/procesamientos", label: "Procesamiento", icon: Activity },
  { href: "/admin/clasificacion", label: "Clasificación", icon: Grid3x3 },
  { href: "/admin/cobertura", label: "Cobertura", icon: Database },
  { href: "/admin/analisis", label: "Análisis a demanda", icon: FlaskConical },
  { href: "/admin/bitacora", label: "Bitácora", icon: ScrollText },
];

export function AdminShell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-paperDeep">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-ink text-paper lg:flex">
        <div className="flex items-center gap-2 border-b border-paper/10 px-5 py-4">
          <Marca tono="oscuro" tamano="sm" />
          <span className="rounded bg-amber px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-paper/10 text-paper" : "text-paper/65 hover:bg-paper/5 hover:text-paper")}>
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-paper/10 p-3 text-sm">
          <Link href="/app/financiar" target="_blank" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-paper/65 hover:bg-paper/5 hover:text-paper">
            <ExternalLink size={16} /> Ver sitio público
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-paper/65 hover:bg-paper/5 hover:text-paper">
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-paper/90 px-6 py-3 backdrop-blur">
          <div>
            <h1 className="font-serif text-xl font-bold text-ink">{title}</h1>
            {subtitle && <p className="text-xs text-mute">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
        {/* nav móvil */}
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-paper px-3 py-2 lg:hidden">
          {NAV.map(({ href, label, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return <Link key={href} href={href} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs", active ? "bg-ink text-paper" : "text-mute")}>{label}</Link>;
          })}
        </nav>
        <main className="p-6">{children}</main>
        <footer className="flex items-center gap-2 px-6 pb-6 text-[11px] text-mute"><ShieldCheck size={12} /> Panel interno · las acciones quedan en la bitácora con tu nombre.</footer>
      </div>
    </div>
  );
}

export function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: string | number; hint?: string; tone?: "ink" | "amber" | "moss" | "rust" }) {
  const toneCls = { ink: "text-ink", amber: "text-amberTexto", moss: "text-moss", rust: "text-rust" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className={cn("font-mono text-2xl font-semibold", toneCls)}>{typeof value === "number" ? value.toLocaleString("es-PE") : value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-mute">{label}</div>
      {hint && <div className="text-[11px] text-mute">{hint}</div>}
    </div>
  );
}

export function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{children}</span>;
}
