import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { Banknote, BookOpenText, ScrollText, ShieldCheck, Target } from "lucide-react";
import { Indicadores } from "@/components/listado";
import { Agentes } from "@/components/metricas/Agentes";
import { Bitacora } from "@/components/metricas/Bitacora";
import { CostosVolumen } from "@/components/metricas/Costos";
import { Rag } from "@/components/metricas/Rag";
import { Verificacion } from "@/components/metricas/Verificacion";
import { fechaHora } from "@/components/metricas/piezas";
import { EncabezadoPagina, EstadoError, Migas, Nota, Pagina, Pestanas } from "@/components/patrones";
import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";
import { decimal, numero, plural, porcentaje } from "@/lib/formato";
import { canonica } from "@/lib/seo";
import { dolares, enLima, getTransparencia } from "@/lib/transparencia";

export const metadata: Metadata = {
  title: "Métricas y transparencia",
  description:
    "Qué tan bien leen los agentes de Vigía, cuánto se equivocan, cómo rinde el buscador de normas y cuánto costó analizar cada contrato. Cada cifra con su fecha y de dónde sale.",
  alternates: canonica("/metricas"),
};

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Métricas y transparencia (2026-11-16, pedido del dueño: «precisión de agentes, porcentaje de alucinación, costos,
 * todo con fecha y logs»). Una vista más de «Cómo trabaja Vigía», con la misma franja. Cinco pestañas, una pregunta
 * cada una: ¿aciertan los agentes?, ¿encuentra la norma correcta?, ¿cuánto de lo publicado pasó un control?, ¿cuánto
 * costó?, ¿qué corrió y cuándo? Todo sale de GET /transparencia (sólo agregados); lo que la base no tiene se dice
 * «no medido», nunca se rellena.
 */
export default async function MetricasPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const seccion = uno(searchParams?.seccion);
  const pagina = Math.max(1, Math.floor(Number(uno(searchParams?.pagina))) || 1);
  const datos = await getTransparencia();
  if (!datos) noStore();
  const generado = enLima(datos?.generado);

  const redes = datos?.agentes?.redes ?? [];
  const f1s = redes.map((r) => r.ultima.f1).filter((v): v is number => v != null);
  const senales = datos?.verificacion.senales ?? null;
  const analisis = datos?.costos.analisis ?? null;
  const analizados = datos?.costos.analizados?.total ?? analisis?.n ?? null;
  const propias = (datos?.rag?.serie ?? []).filter((e) => e.sistema !== "chroma");
  const rag = propias[propias.length - 1] ?? null;

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Cómo trabaja Vigía", href: "/metodologia" }, { etiqueta: "Métricas y transparencia", href: "/metricas" }]} />
      <EncabezadoPagina
        titulo="Métricas y transparencia"
        bajada="Qué tan bien leen los agentes, cuánto se equivocan y cuánto costó. Cada cifra con su fecha y de dónde sale."
      />
      <VistasComoTrabaja activa="metricas" />

      {!datos ? (
        <EstadoError titulo="No pudimos leer las métricas">Es una falla de esta página: las mediciones siguen guardadas. Vuelve a intentar en unos minutos.</EstadoError>
      ) : (
        <>
          <Indicadores
            franja
            items={[
              {
                valor: f1s.length ? `${decimal(Math.min(...f1s), 2)} a ${decimal(Math.max(...f1s), 2)}` : null,
                etiqueta: "F1 de las redes de agentes",
                contexto: f1s.length ? `${plural(redes.length, "red", "redes")}, al ${fechaHora(datos.agentes?.fecha)}` : "no medido",
                icono: <Target size={15} aria-hidden />,
                parte: null,
              },
              {
                valor: rag?.acierto8 != null ? porcentaje(rag.acierto8 * 100, { decimales: 1 }) : null,
                etiqueta: "acierto del buscador de normas",
                contexto: rag ? `entre los 8 primeros, en ${plural(rag.preguntas, "pregunta", "preguntas")}` : "no medido",
                icono: <BookOpenText size={15} aria-hidden />,
                parte: rag?.acierto8 ?? null,
              },
              {
                valor: senales ? numero(senales.cotejadas) : null,
                etiqueta: "señales publicadas cotejadas",
                contexto: senales ? `de ${numero(senales.total)} publicadas` : "no medido",
                icono: <ShieldCheck size={15} aria-hidden />,
              },
              {
                valor: analisis ? dolares(analisis.usd) : analizados != null ? numero(analizados) : null,
                etiqueta: analisis ? "costo de los análisis" : "contratos analizados",
                contexto: analisis ? `${plural(analisis.n, "contrato", "contratos")}, ${analisis.medioUsd != null ? dolares(analisis.medioUsd, 3) : "sin dato"} cada uno` : undefined,
                icono: <Banknote size={15} aria-hidden />,
                parte: null,
              },
            ]}
          />

          <Nota icono={<ShieldCheck size={15} aria-hidden />}>
            Todo lo de esta página sale de la base de Vigía y se publica tal cual, también cuando el número no favorece. Lo que no se mide se dice
            «no medido». Consultado el {fechaHora(generado)}, hora de Lima; se actualiza cada hora.
          </Nota>

          <Pestanas
            variante="segunda"
            etiqueta="Partes de métricas y transparencia"
            activa={seccion}
            pestanas={[
              { clave: "agentes", etiqueta: "Los agentes", conteo: redes.length || null, icono: <Target size={15} aria-hidden />, contenido: <Agentes agentes={datos.agentes} /> },
              { clave: "rag", etiqueta: "RAG normativo", icono: <BookOpenText size={15} aria-hidden />, contenido: <Rag rag={datos.rag} /> },
              { clave: "verificacion", etiqueta: "Verificación", icono: <ShieldCheck size={15} aria-hidden />, contenido: <Verificacion verificacion={datos.verificacion} agentes={datos.agentes} generado={generado} /> },
              { clave: "costos", etiqueta: "Costos y volumen", icono: <Banknote size={15} aria-hidden />, contenido: <CostosVolumen costos={datos.costos} generado={generado ?? datos.generado} /> },
              {
                clave: "bitacora",
                etiqueta: "Bitácora",
                icono: <ScrollText size={15} aria-hidden />,
                contenido: <Bitacora tipo={uno(searchParams?.tipo)} q={uno(searchParams?.q)} pagina={seccion === "bitacora" ? pagina : 1} />,
              },
            ]}
          />
        </>
      )}
    </Pagina>
  );
}
