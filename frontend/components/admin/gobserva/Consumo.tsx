"use client";

import { useState } from "react";
import { useAdmin } from "@/lib/useAdmin";
import { DataTable, EmptyState, ErrorBanner, FilterChips, StatCard, StatGrid, plural, type Columna } from "@/components/admin/ui";
import { soles } from "./tipos";

/** GET /admin/gobserva/consumo (migración 268). */
interface PorDetalle {
  canal: "mcp" | "asistente";
  detalle: string;
  llamadas: number;
  creditos: number;
  costo: number;
  cuentas: number;
}
interface PorDia {
  dia: string;
  preguntas: number;
  mcp: number;
  creditos: number;
  costo: number;
  cuentas: number;
}
interface PorCuenta {
  uid: string;
  email: string | null;
  app: string | null;
  preguntas: number;
  mcp: number;
  creditos: number;
  costo: number;
  planes: string | null;
}
interface RespuestaConsumo {
  dias: number;
  porDetalle: PorDetalle[];
  porDia: PorDia[];
  porCuenta: PorCuenta[];
  mes: { ingresos: number; costo: number; pagando: number };
}

type Rango = "7" | "30" | "90";

const NUM = new Intl.NumberFormat("es-PE");
const usd = (n: number) => `US$ ${n.toLocaleString("es-PE", { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
const MODO: Record<string, string> = { rapido: "Rápido (Haiku)", fino: "Preciso (Sonnet)", profundo: "Profundo (Sonnet)" };
const fecha = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-PE", { day: "numeric", month: "short" });
};

/**
 * Consumo del asistente y del MCP de Gobserva (2026-11-08): cuánto se usa, cuántos créditos y lo que cuesta el modelo
 * (sólo el asistente: en el MCP lo paga la IA de quien pregunta), frente a lo que entró por planes este mes. Para cuidar
 * el margen: por modo y herramienta, por día y por cuenta.
 */
export function ConsumoGobserva() {
  const [rango, setRango] = useState<Rango>("30");
  const { data, error, isLoading, mutate } = useAdmin<RespuestaConsumo>(`/gobserva/consumo?dias=${rango}`);
  const asistente = (data?.porDetalle ?? []).filter((x) => x.canal === "asistente");
  const mcp = (data?.porDetalle ?? []).filter((x) => x.canal === "mcp");
  const preguntas = asistente.reduce((a, x) => a + x.llamadas, 0);
  const costo = asistente.reduce((a, x) => a + x.costo, 0);
  const llamadasMcp = mcp.reduce((a, x) => a + x.llamadas, 0);
  const creditos = (data?.porDetalle ?? []).reduce((a, x) => a + x.creditos, 0);

  const colDetalle: Columna<PorDetalle>[] = [
    { clave: "detalle", titulo: "Modo o herramienta", principal: true, celda: (x) => (x.canal === "asistente" ? `Asistente, ${MODO[x.detalle] ?? x.detalle}` : `MCP, ${x.detalle}`) },
    { clave: "llamadas", titulo: "Usos", alinear: "derecha", celda: (x) => NUM.format(x.llamadas) },
    { clave: "creditos", titulo: "Créditos", alinear: "derecha", celda: (x) => NUM.format(x.creditos) },
    { clave: "costo", titulo: "Costo del modelo", alinear: "derecha", celda: (x) => (x.canal === "asistente" ? usd(x.costo) : "Lo paga su IA") },
    { clave: "promedio", titulo: "Por uso", alinear: "derecha", celda: (x) => (x.canal === "asistente" && x.llamadas ? usd(x.costo / x.llamadas) : "") },
    { clave: "cuentas", titulo: "Cuentas", alinear: "derecha", celda: (x) => NUM.format(x.cuentas) },
  ];
  const colDia: Columna<PorDia>[] = [
    { clave: "dia", titulo: "Día", principal: true, celda: (x) => fecha(x.dia) },
    { clave: "preguntas", titulo: "Preguntas al asistente", alinear: "derecha", celda: (x) => NUM.format(x.preguntas) },
    { clave: "mcp", titulo: "Llamadas al MCP", alinear: "derecha", celda: (x) => NUM.format(x.mcp) },
    { clave: "creditos", titulo: "Créditos", alinear: "derecha", celda: (x) => NUM.format(x.creditos) },
    { clave: "costo", titulo: "Costo del modelo", alinear: "derecha", celda: (x) => usd(x.costo) },
    { clave: "cuentas", titulo: "Cuentas", alinear: "derecha", celda: (x) => NUM.format(x.cuentas) },
  ];
  const colCuenta: Columna<PorCuenta>[] = [
    { clave: "email", titulo: "Cuenta", principal: true, celda: (x) => x.email ?? `Cuenta ${x.uid.slice(0, 8)} (de Vigía)` },
    { clave: "planes", titulo: "Planes", celda: (x) => x.planes ?? "Sin plan vigente", anchoCompletoMovil: true },
    { clave: "preguntas", titulo: "Preguntas", alinear: "derecha", celda: (x) => NUM.format(x.preguntas) },
    { clave: "mcp", titulo: "MCP", alinear: "derecha", celda: (x) => NUM.format(x.mcp) },
    { clave: "creditos", titulo: "Créditos", alinear: "derecha", celda: (x) => NUM.format(x.creditos) },
    { clave: "costo", titulo: "Costo del modelo", alinear: "derecha", celda: (x) => usd(x.costo) },
  ];

  return (
    <div className="space-y-5">
      {error && <ErrorBanner error={error} titulo="No se pudo cargar el consumo" onReintentar={() => mutate()} />}
      <FilterChips<Rango>
        etiqueta="Periodo"
        valor={rango}
        onCambiar={setRango}
        opciones={[{ valor: "7", etiqueta: "7 días" }, { valor: "30", etiqueta: "30 días" }, { valor: "90", etiqueta: "90 días" }]}
      />
      <StatGrid columnas={4}>
        <StatCard
          etiqueta="Preguntas al asistente"
          valor={data ? NUM.format(preguntas) : null}
          pista={data ? asistente.map((x) => `${MODO[x.detalle] ?? x.detalle} ${NUM.format(x.llamadas)}`).join(", ") || "Todavía ninguna" : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Llamadas al MCP"
          valor={data ? NUM.format(llamadasMcp) : null}
          pista={data ? `${plural(mcp.length, "herramienta usada", "herramientas usadas")}; el modelo lo paga la IA de cada cuenta` : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Costo del modelo"
          valor={data ? usd(costo) : null}
          pista={data ? `${NUM.format(creditos)} créditos usados en ${data.dias} días; ${preguntas ? usd(costo / preguntas) : "US$ 0"} por pregunta` : undefined}
          cargando={isLoading}
        />
        <StatCard
          etiqueta="Este mes"
          valor={data ? soles(data.mes.ingresos) : null}
          pista={data ? `Entró por planes; el modelo costó ${usd(data.mes.costo)}. ${plural(data.mes.pagando, "cuenta paga", "cuentas pagan")} un plan` : undefined}
          tono={data && data.mes.costo > 0 && data.mes.ingresos === 0 ? "warn" : "neutral"}
          cargando={isLoading}
        />
      </StatGrid>

      {data && !data.porDetalle.length ? (
        <EmptyState titulo="Todavía no hay consumo" descripcion="Aparece cuando alguien con un plan le pregunta al asistente o usa el MCP." />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Por modo y herramienta</h3>
            <DataTable etiqueta="Consumo por modo y herramienta" columnas={colDetalle} filas={data?.porDetalle} claveFila={(x) => `${x.canal}:${x.detalle}`} cargando={isLoading} />
          </section>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Por cuenta</h3>
            <DataTable etiqueta="Consumo por cuenta" columnas={colCuenta} filas={data?.porCuenta} claveFila={(x) => x.uid} cargando={isLoading} />
          </section>
          <section className="space-y-2">
            <h3 className="text-dato font-semibold text-ink">Por día</h3>
            <DataTable etiqueta="Consumo por día" columnas={colDia} filas={data?.porDia} claveFila={(x) => x.dia} cargando={isLoading} />
          </section>
        </>
      )}
    </div>
  );
}
