"use client";

import useSWR from "swr";
import { Caja } from "@/components/gobserva/app/Caja";
import { cargarUso, cargarUsoMcp, fechaLarga } from "@/lib/gobserva-cuenta";
import type { Producto } from "@/lib/gobserva";

const NUM = new Intl.NumberFormat("es-PE");
const DIA = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "UTC" });
const dia = (iso: string) => DIA.format(new Date(`${iso}T12:00:00Z`)).replace(".", "");

const MODO: Record<string, string> = { rapido: "rápido", fino: "preciso", profundo: "profundo" };
/** Las herramientas del MCP con su nombre de persona (las demás, sin guiones bajos). */
const HERRAMIENTA: Record<string, string> = {
  buscar_plazas_cas: "Buscar plazas", ficha_plaza_cas: "Ficha de una plaza", buscar_licitaciones: "Buscar licitaciones", mercado_rubro: "Mercado de un rubro",
  buscar_proyectos_inversion: "Buscar obras", ficha_proyecto: "Ficha de una obra", mercado_obras: "Mercado de obras", compras_menores: "Contratos menores",
  ficha_contrato: "Ficha de un contrato", ficha_empresa: "Ficha de una empresa", ficha_entidad: "Ficha de una entidad", buscar_documentos: "Buscar en documentos",
  documentos_zip: "Bajar documentos", consultar_datos: "Consulta de cifras", proveedores_de_entidad: "Proveedores de una entidad", ordenes: "Órdenes de compra",
};
const nombreHerramienta = (x: string) => HERRAMIENTA[x] ?? x.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Tu uso de créditos (2026-11-08, el usuario: «falta historial de consultas»): cuánto usaste este mes del asistente y del
 * MCP, día por día de los últimos 30 días y por modo o herramienta. Para el plan con créditos (Plan y pagos, #uso).
 */
export function UsoCreditos({ producto }: { producto: Producto }) {
  const mes = useSWR(["gobserva-mcp", producto], () => cargarUsoMcp(producto), { revalidateOnFocus: false });
  const uso = useSWR(["gobserva-uso", producto], () => cargarUso(producto, 30), { revalidateOnFocus: false });
  if (!mes.data || mes.data.creditos === 0) return null;
  const dias = uso.data?.porDia ?? [];
  // Los 30 días completos, también los que no se usó nada.
  const serie = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - 5 * 3_600_000 - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    const x = dias.find((y) => y.dia === d);
    return { dia: d, creditos: x?.creditos ?? 0, preguntas: x?.preguntas ?? 0, mcp: x?.mcp ?? 0 };
  });
  const max = Math.max(1, ...serie.map((s) => s.creditos));
  const quedan = Math.max(0, mes.data.creditos - mes.data.usados);
  const detalle = uso.data?.porDetalle ?? [];

  return (
    <Caja id="uso" titulo="Tu uso de créditos" descripcion="Lo que usaste del asistente de la app y del MCP en tu IA.">
      <p className="text-dato leading-relaxed text-inkSoft">
        Este mes usaste <b className="font-semibold tabular-nums text-ink">{NUM.format(mes.data.usados)}</b> de {NUM.format(mes.data.creditos)} créditos; te quedan{" "}
        <b className="font-semibold tabular-nums text-ink">{NUM.format(quedan)}</b> hasta el {fechaLarga(mes.data.renueva)}.
      </p>
      <figure className="mt-5">
        <div className="relative h-32" aria-hidden>
          <span className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {serie.map((s) => (
              <div
                key={s.dia}
                className="group relative flex h-full flex-1 items-end"
                title={`${dia(s.dia)}: ${NUM.format(s.creditos)} créditos (${s.preguntas} ${s.preguntas === 1 ? "pregunta" : "preguntas"}, ${s.mcp} en el MCP)`}
              >
                <div
                  className={s.creditos ? "w-full rounded-t-[3px] bg-granate/80 transition-colors duration-rapido group-hover:bg-granate" : "w-full rounded-t-[3px] bg-ink/[0.06]"}
                  style={{ height: s.creditos ? `${Math.max(4, (s.creditos / max) * 100)}%` : "2px" }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex justify-between text-rotulo text-mute" aria-hidden>
          <span>{dia(serie[0].dia)}</span>
          <span>Hoy</span>
        </div>
        <figcaption className="mt-1 text-meta text-mute">Créditos por día, de los últimos 30 días. El día más alto: {NUM.format(max)}.</figcaption>
        <table className="sr-only">
          <caption>Créditos por día</caption>
          <thead>
            <tr><th>Día</th><th>Créditos</th><th>Preguntas al asistente</th><th>Llamadas al MCP</th></tr>
          </thead>
          <tbody>
            {serie.filter((s) => s.creditos).map((s) => (
              <tr key={s.dia}><td>{s.dia}</td><td>{s.creditos}</td><td>{s.preguntas}</td><td>{s.mcp}</td></tr>
            ))}
          </tbody>
        </table>
      </figure>
      {detalle.length > 0 ? (
        <table className="mt-5 w-full border-collapse text-left text-dato">
          <caption className="sr-only">Créditos por modo y herramienta, últimos 30 días</caption>
          <thead>
            <tr className="border-b border-line text-meta text-mute">
              <th scope="col" className="py-2 font-semibold">En qué</th>
              <th scope="col" className="py-2 text-right font-semibold">Usos</th>
              <th scope="col" className="py-2 text-right font-semibold">Créditos</th>
            </tr>
          </thead>
          <tbody>
            {detalle.map((x) => (
              <tr key={`${x.canal}:${x.detalle}`} className="border-b border-line last:border-0">
                <td className="py-2 text-ink">{x.canal === "asistente" ? `Asistente, modo ${MODO[x.detalle] ?? x.detalle}` : `MCP, ${nombreHerramienta(x.detalle)}`}</td>
                <td className="py-2 text-right tabular-nums text-inkSoft">{NUM.format(x.usos)}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-ink">{NUM.format(x.creditos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-meta text-mute">Todavía no usaste créditos en los últimos 30 días.</p>
      )}
    </Caja>
  );
}
