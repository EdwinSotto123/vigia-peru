"use client";

import { useMemo, useState } from "react";
import { Download, RefreshCw, Rocket, Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { Badge, DataTable, EmptyState, ErrorBanner, PageSection, StatCard, claseBoton, type Columna } from "@/components/admin/ui";

/**
 * Inscritos de Gobserva (migración 226): quién se anotó en Gobserva Empleo, Gobserva Licitaciones o el MCP, con su plan,
 * sus intereses y desde qué página. Es la lista de espera con la que se valida la demanda antes de cobrar: aquí se ve
 * cuántos hay por producto y por plan, se busca y se baja en CSV para escribirles. Sólo admin (correos y teléfonos).
 * Fuente: GET /api/admin/gobserva/suscripciones
 */
interface Inscrito {
  id: number;
  producto: "empleo" | "licitaciones" | "mcp";
  email: string;
  nombre: string | null;
  empresa: string | null;
  ruc: string | null;
  telefono: string | null;
  plan: string;
  intereses: Record<string, unknown>;
  origen: string | null;
  acepta: boolean;
  creado: string;
  actualizado: string;
}
interface Respuesta {
  data: Inscrito[];
  cuentas: { producto: string; plan: string; n: number; semana: number }[];
}

const PRODUCTO: Record<string, string> = {
  empleo: "Empleo",
  licitaciones: "Licitaciones",
  mcp: "MCP",
};
const PLAN: Record<string, string> = {
  gratis: "Gratis",
  alertas: "Alertas",
  pro: "Pro",
  empresa: "Empresa",
  institucional: "Institucional",
  mcp: "MCP",
};
const plano = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Los intereses en una línea: «palabras: abogado; regiones: Lima, Cusco». */
function interesesEnTexto(i: Record<string, unknown>): string {
  return Object.entries(i ?? {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join("; ");
}

function bajarCsv(filas: Inscrito[]) {
  const cols = ["creado", "producto", "plan", "email", "nombre", "empresa", "ruc", "telefono", "intereses", "origen"] as const;
  const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = [cols.join(","), ...filas.map((f) => cols.map((c) => celda(c === "intereses" ? interesesEnTexto(f.intereses) : f[c])).join(","))];
  const blob = new Blob([`﻿${lineas.join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gobserva-inscritos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function InscritosGobserva() {
  const { data, error, isLoading, isValidating } = useAdmin<Respuesta>("/gobserva/suscripciones");
  const [producto, setProducto] = useState<string>("");
  const [q, setQ] = useState("");
  const filas = useMemo(() => {
    const t = plano(q.trim());
    return (data?.data ?? []).filter(
      (f) =>
        (!producto || f.producto === producto) &&
        (!t || [f.email, f.nombre, f.empresa, f.ruc, f.origen, interesesEnTexto(f.intereses)].some((v) => plano(v).includes(t))),
    );
  }, [data, producto, q]);
  const total = (p?: string) => (data?.cuentas ?? []).filter((c) => !p || c.producto === p).reduce((a, c) => a + c.n, 0);
  const semana = (data?.cuentas ?? []).reduce((a, c) => a + c.semana, 0);
  const porPlan = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data?.cuentas ?? []) if (!producto || c.producto === producto) m.set(c.plan, (m.get(c.plan) ?? 0) + c.n);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data, producto]);

  const columnas: Columna<Inscrito>[] = [
    {
      clave: "email",
      titulo: "Inscrito",
      principal: true,
      celda: (f) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{f.email}</span>
          <span className="block truncate text-rotulo text-mute">
            {[f.nombre, f.empresa, f.ruc ? `RUC ${f.ruc}` : null].filter(Boolean).join(", ") || "Sin nombre"}
          </span>
        </span>
      ),
    },
    {
      clave: "producto",
      titulo: "Producto",
      celda: (f) => (
        <Badge tono={f.producto === "licitaciones" ? "brand" : f.producto === "empleo" ? "ok" : "neutral"}>{PRODUCTO[f.producto] ?? f.producto}</Badge>
      ),
    },
    {
      clave: "plan",
      titulo: "Plan",
      celda: (f) => <span className="font-medium text-ink">{PLAN[f.plan] ?? f.plan}</span>,
    },
    {
      clave: "telefono",
      titulo: "WhatsApp",
      celda: (f) => <span className="font-mono text-meta">{f.telefono ?? "Sin dato"}</span>,
    },
    {
      clave: "intereses",
      titulo: "Intereses",
      anchoCompletoMovil: true,
      celda: (f) => <span className="line-clamp-2 text-meta text-inkSoft">{interesesEnTexto(f.intereses) || "Sin dato"}</span>,
    },
    {
      clave: "creado",
      titulo: "Se anotó",
      alinear: "derecha",
      celda: (f) => <span className="whitespace-nowrap font-mono text-meta text-inkSoft">{f.creado}</span>,
    },
  ];

  return (
    <AdminShell
      title="Inscritos de Gobserva"
      subtitle="La lista de espera de Empleo, Licitaciones y el MCP: quién quiere qué plan"
      actions={
        <div className="flex gap-2">
          <button type="button" onClick={() => refrescarAdmin("/gobserva/suscripciones")} className={claseBoton("secundario")} disabled={isValidating}>
            <RefreshCw size={15} aria-hidden className={isValidating ? "animate-spin" : undefined} /> Actualizar
          </button>
          <button type="button" onClick={() => bajarCsv(filas)} className={claseBoton("primario")} disabled={!filas.length}>
            <Download size={15} aria-hidden /> CSV ({filas.length})
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorBanner error={error} onReintentar={() => refrescarAdmin("/gobserva/suscripciones")} />}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            etiqueta="Inscritos"
            valor={total()}
            pista={`${semana} en los últimos 7 días`}
            activo={!producto}
            onClick={() => setProducto("")}
            cargando={isLoading}
            rol="radio"
          />
          <StatCard
            etiqueta="Empleo"
            valor={total("empleo")}
            activo={producto === "empleo"}
            onClick={() => setProducto("empleo")}
            cargando={isLoading}
            rol="radio"
          />
          <StatCard
            etiqueta="Licitaciones"
            valor={total("licitaciones")}
            activo={producto === "licitaciones"}
            onClick={() => setProducto("licitaciones")}
            cargando={isLoading}
            rol="radio"
          />
          <StatCard etiqueta="MCP" valor={total("mcp")} activo={producto === "mcp"} onClick={() => setProducto("mcp")} cargando={isLoading} rol="radio" />
          <StatCard
            etiqueta="Por plan"
            valor={porPlan.length ? porPlan.map(([p, n]) => `${PLAN[p] ?? p} ${n}`).join(", ") : "Sin inscritos"}
            cargando={isLoading}
          />
        </div>
        <PageSection titulo="Lista" descripcion="Cada fila es un correo en un producto: si se vuelve a anotar, se actualiza su plan y sus intereses.">
          <label className="mb-3 flex max-w-md items-center gap-2 rounded-xl border border-line bg-paper px-3">
            <Search size={15} aria-hidden className="text-mute" />
            <span className="sr-only">Buscar inscritos</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por correo, empresa, RUC o interés"
              className="min-h-11 w-full bg-transparent text-destacado text-ink outline-none sm:text-dato"
            />
          </label>
          <DataTable
            columnas={columnas}
            filas={data ? filas : null}
            claveFila={(f) => String(f.id)}
            etiqueta="Inscritos de Gobserva"
            cargando={isLoading}
            porPagina={25}
            vacio={
              <EmptyState
                compacto
                icono={<Rocket size={20} aria-hidden />}
                titulo={q || producto ? "Nadie con ese filtro" : "Todavía no se anota nadie"}
                descripcion="Los inscritos llegan desde los formularios de empleo.gobserva.cloud y licitaciones.gobserva.cloud."
              />
            }
          />
        </PageSection>
      </div>
    </AdminShell>
  );
}
