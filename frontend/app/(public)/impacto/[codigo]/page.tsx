import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, ShieldCheck, Sprout, XCircle } from "lucide-react";
import { Avatar } from "@/components/financiar/RankingTable";
import { EstadoAporte, haceDias } from "@/components/financiar/EstadoAporte";
import { CuentaCta } from "@/components/financiar/CuentaCta";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { Severidad } from "@/components/ui/Severidad";
import { FranjaTextil } from "@/components/marca";
import { Ayuda, BarraCompartir, Pestanas } from "@/components/patrones";
import { Indicadores } from "@/components/listado";
import { esSenalPublicada, indicadoresAporte } from "@/components/financiar/indicadoresAporte";
import { fecha, numero, plural, solesCompacto } from "@/lib/formato";
import {
  TIPO_FINANCIADOR_LABEL,
  getComprobante,
  mensajePublicoVisible,
  type Comprobante,
  type ComprobanteContrato,
} from "@/lib/financiamiento";
import { getProcesamientos, type Procesamiento } from "@/lib/auditoria";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: { codigo: string } }) {
  const codigo = params.codigo.toUpperCase();
  const c = await getComprobante(codigo);
  const description = c
    ? `${c.financiador} financió la lectura de ${plural(c.contratos, "contrato público", "contratos públicos")} en ${c.zona}. ${numero(c.resumen.contratosConSenal ?? c.resumen.senales)} con al menos una señal.`
    : "Comprobante público de una lectura financiada en Vigía Perú.";
  return {
    title: `Comprobante de impacto ${codigo}`,
    description,
    openGraph: { title: c ? `Lectura financiada por ${c.financiador}` : `Comprobante de impacto ${codigo}`, description },
    twitter: { card: "summary_large_image" },
  };
}

/**
 * Semilla del tablero en vivo a partir del detalle del comprobante: así la página
 * pinta la lista al instante y sigue funcionando si el endpoint de procesamientos
 * no responde (el tablero la reemplaza en cuanto llega la primera respuesta).
 */
function semillaDesdeComprobante(c: Comprobante): Procesamiento[] {
  return c.detalle.map((k) => ({
    ocid: k.ocid,
    estado: k.procesadaAt ? "procesado" : "encolado",
    faseActual: k.procesadaAt ? "final" : null,
    faseIndex: k.procesadaAt ? 10 : null,
    iniciadoAt: null,
    finalizadoAt: k.procesadaAt,
    intentos: 0,
    contribucionCodigo: c.codigo,
    financiador: c.financiador,
    financiadorVisible: true,
    ubigeo: c.ubigeo,
    zona: c.zona,
    titulo: k.titulo,
    entidad: k.entidad,
    montoPen: k.valorReferencial,
    alertaCodigo: k.alertaCodigo,
    alertaEstado: k.alertaEstado ?? null,
    score: k.score,
    banderas: k.banderas,
  }));
}

type Tono = "positivo" | "espera" | "error" | "neutro";

/** Tono del estado → color de texto + ícono. Nunca ámbar (es "Señal media") ni granate (es la marca). */
const TONO: Record<Tono, { clase: string; Icono: typeof Clock }> = {
  positivo: { clase: "text-mossTexto", Icono: CheckCircle2 },
  espera: { clase: "text-inkSoft", Icono: Clock },
  error: { clase: "text-crimsonTexto", Icono: XCircle },
  neutro: { clase: "text-inkSoft", Icono: Clock },
};

const ESTADO: Record<string, { label: string; tono: Tono }> = {
  pendiente_pago: { label: "Pago pendiente de validación", tono: "espera" },
  pagada: { label: "Pago confirmado, esperando contratos en cola", tono: "positivo" },
  en_proceso: { label: "Pago confirmado, lectura en proceso", tono: "positivo" },
  procesada: { label: "Lectura completada", tono: "positivo" },
  rechazada: { label: "Aporte rechazado", tono: "error" },
  reembolsada: { label: "Aporte reembolsado", tono: "neutro" },
};

/** Un lote del capital semilla no pasó por ningún pago: se dice qué es. */
function estadoInstitucional(estado: string, esperando: boolean): { label: string; tono: Tono } {
  if (estado === "procesada") return { label: "Aporte institucional (capital semilla), lectura completada", tono: "positivo" };
  if (esperando) return { label: "Aporte institucional (capital semilla), esperando documentos", tono: "espera" };
  if (estado === "en_proceso") return { label: "Aporte institucional (capital semilla), lectura en proceso", tono: "positivo" };
  return { label: "Aporte institucional (capital semilla)", tono: "positivo" };
}

const bandera = (s: string | null): "alta" | "media" | "baja" | null =>
  s === "alta" || s === "media" || s === "baja" ? s : null;

/**
 * El comprobante público de un aporte. Es un recibo de trazabilidad, no un
 * agradecimiento: dice qué contratos hizo leer el aporte y qué salió en cada uno.
 * La franja textil de 8 px en el tope es la firma de marca del recibo (una por
 * pantalla); la llamita no aparece acá, porque esta página nombra a quien financió
 * y muestra señales, y la llamita nunca va al lado de una persona ni de una señal.
 *
 * Orden de ficha (DESIGN_SYSTEM.md §14.2): identidad → `Indicadores` (las cifras del
 * aporte, las mismas del panel del aporte en la ficha del aliado) → pestañas (§14.3):
 * Resumen (el aporte en una frase, su estado en cuatro pasos, el primer contrato leído) |
 * Contratos (el tablero en vivo, que con cientos de filas empujaba todo lo demás abajo)
 * → la independencia, la cuenta y compartir (§14.5).
 *
 * Contenedor: el `container-page` de la cabecera pública, sin la columna angosta
 * centrada de antes (el tablero de contratos necesita el ancho). Avisos y notas, en
 * una línea con su ⓘ (§10.7).
 */
export default async function ImpactoPage({
  params,
  searchParams,
}: {
  params: { codigo: string };
  /** `?seccion=contratos` abre la pestaña del tablero. */
  searchParams?: { seccion?: string | string[] };
}) {
  const c = await getComprobante(params.codigo);
  if (!c) notFound();
  const institucional = c.pasarela === "institucional";
  // El tablero en vivo arranca con lo que ya sabe el API de procesamientos; si aún no
  // responde (o la contribución no tiene asignaciones), usa el detalle del comprobante.
  const enVivo = await getProcesamientos({ codigo: c.codigo, limit: 300 });
  const semilla = enVivo && enVivo.length ? enVivo : semillaDesdeComprobante(c);

  const leidos = c.detalle.filter((k) => k.procesadaAt);
  const valorAsignado = c.detalle.reduce((n, k) => n + (k.valorReferencial ?? 0), 0);
  const esperandoDocumentos = (enVivo ?? []).filter((x) => x.estado === "esperando_documentos").length;
  const asignadaAt = c.detalle.map((k) => k.asignadaAt).filter(Boolean).sort()[0] ?? null;
  const esperando = c.resumen.procesados === 0 && c.resumen.asignados > 0 && esperandoDocumentos > 0;
  const est = institucional ? estadoInstitucional(c.estado, esperando) : ESTADO[c.estado] ?? { label: c.estado, tono: "neutro" as Tono };
  const { clase: tonoEstado, Icono: IconoEstado } = TONO[est.tono];
  const mensaje = mensajePublicoVisible(c.mensajePublico, c.pasarela);
  // Primer contrato procesado: el resultado más antiguo del aporte, con enlace a su lectura.
  const primero = [...leidos].sort((a, b) => String(a.procesadaAt).localeCompare(String(b.procesadaAt)))[0] ?? null;

  const nConSenal = c.resumen.contratosConSenal ?? leidos.filter(esSenalPublicada).length;

  return (
    <div className="container-page py-8 sm:py-10">
      <article className="overflow-hidden rounded-2xl border border-line bg-paper">
        <FranjaTextil alto={8} />
        <div className="p-5 sm:p-8">
          {/* Identidad del recibo: su código, qué es y en qué estado está. Quien financió, al costado. */}
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="break-all font-mono text-[28px] font-bold leading-tight text-ink sm:text-[32px]">
                <span className="sr-only">Comprobante de impacto </span>
                {c.codigo}
              </h1>
              <p className="mt-1 text-sm text-inkSoft">
                Comprobante de impacto: lectura de {plural(c.contratos, "contrato", "contratos")} en {c.zona}
              </p>
              <p className={`mt-2 inline-flex items-start gap-1.5 text-sm font-medium ${tonoEstado}`}>
                {institucional ? <Sprout size={15} className="mt-0.5 shrink-0" aria-hidden /> : <IconoEstado size={15} className="mt-0.5 shrink-0" aria-hidden />}
                {est.label}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {c.slug ? <Link href={`/aliado/${c.slug}`} className="underline-offset-2 hover:underline">{c.financiador}</Link> : c.financiador}
                </p>
                <p className="text-[12px] text-mute">{c.slug === "vigia-peru" ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[c.tipo] ?? c.tipo}</p>
              </div>
            </div>
          </header>

          <p className="mt-4 text-sm text-inkSoft">
            {institucional
              ? `Asignado el ${fecha(asignadaAt ?? c.createdAt)} con capital semilla de Vigía Perú.`
              : c.pagadaAt
                ? `Pago confirmado el ${fecha(c.pagadaAt)}.`
                : `Registrado el ${fecha(c.createdAt)}.`}
          </p>
          {mensaje && <blockquote className="mt-3 border-l-2 border-granate-200 pl-3 text-sm italic text-inkSoft">“{mensaje}”</blockquote>}

          {/* Cada cifra con su denominador (§10.2), número → qué es → contexto. */}
          <Indicadores className="mt-6" items={indicadoresAporte(c, esperandoDocumentos)} />

          {/* Resumen | Contratos: el tablero (hasta 300 filas) va en su pestaña, a un clic. */}
          <Pestanas
            className="mt-6"
            etiqueta="Secciones del comprobante"
            activa={typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined}
            pestanas={[
              {
                clave: "resumen",
                etiqueta: "Resumen",
                contenido: (
                  <div className="space-y-6">
                    {/* El aporte en una frase, armada con el detalle real del comprobante. */}
                    <EnUnaFrase c={c} leidos={leidos} valorAsignado={valorAsignado} esperandoDocumentos={esperandoDocumentos} />

                    {/* Estado del aporte en 4 pasos */}
                    <EstadoAporte
                      estado={c.estado}
                      procesados={c.resumen.procesados}
                      contratos={c.contratos}
                      institucional={institucional}
                      registrado={c.createdAt}
                      espera={c.resumen.asignados > 0 ? { asignadoHace: haceDias(asignadaAt), esperandoDocumentos, asignados: c.resumen.asignados } : null}
                    />

                    {/* Primer contrato leído. Tarjeta neutra: puede traer señales, y un verde de "logro" las taparía. */}
                    {primero && (
                      <Link
                        href={`/app/auditoria/${encodeURIComponent(primero.ocid)}`}
                        className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-ink transition-colors duration-150 hover:border-granate/40 hover:bg-granate-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold text-mute">Primer contrato leído con este aporte</span>
                          <span className="mt-0.5 block truncate font-medium">{primero.titulo ?? primero.ocid}</span>
                          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-[12px] text-inkSoft">
                            <span className="truncate">{primero.entidad ?? "Entidad no identificada"}</span>
                            <span className="shrink-0">
                              {primero.alertaEstado === "revision"
                                ? "En revisión"
                                : primero.banderas > 0
                                  ? `Con ${plural(primero.banderas, "señal", "señales")}`
                                  : "Sin señales"}
                            </span>
                          </span>
                        </span>
                        <ArrowRight size={16} className="shrink-0 text-granate transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                ),
              },
              {
                // El conteo son los asignados: los que el tablero puede mostrar (los pagados sin
                // asignar ya se cuentan en "por leer").
                clave: "contratos",
                etiqueta: "Contratos",
                conteo: c.resumen.asignados,
                contenido: (
                  <>
                    <p className="mb-3 text-sm text-inkSoft">
                      {c.estado === "pendiente_pago"
                        ? "Se asignan al validar el pago; desde ahí los verás avanzar en vivo."
                        : "Toca uno para ver su lectura paso por paso."}
                    </p>
                    <TableroAuditoria codigo={c.codigo} autoRefreshMs={5000} limit={300} initial={semilla} />
                  </>
                ),
              },
            ]}
          />

          <p className="mt-8 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>{institucional ? "Este lote" : "Este aporte"} financió capacidad de lectura, no resultados.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              Los contratos se asignaron por antigüedad y los dictámenes se escribieron sin conocer el nombre de quien
              financió.
            </Ayuda>
          </p>

          {!institucional && <div className="mt-6"><CuentaCta codigo={c.codigo} /></div>}

          {/* Compartir (§14.5): una barra, junto a lo que se comparte; la acción siguiente, a la derecha. */}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <BarraCompartir
              ruta={`/impacto/${c.codigo}`}
              titulo={`Lectura financiada por ${c.financiador}`}
              texto={`${c.financiador} financió la lectura de ${plural(c.contratos, "contrato público", "contratos públicos")} en ${c.zona}. ${numero(nConSenal)} con al menos una señal.`}
            />
            <EnlaceAccion href="/app/financiar" className="sm:ml-auto">
              Elegir otra zona <ArrowRight size={14} aria-hidden />
            </EnlaceAccion>
          </div>
        </div>
      </article>
    </div>
  );
}

/**
 * "Los 10 contratos de Cusco suman S/ 3.2 M en 7 entidades; 8 tenían al menos una señal."
 * Todo sale del detalle del comprobante; si todavía no hay contratos asignados, no se dice nada.
 * La señal más fuerte (score más alto entre las publicadas) enlaza a su ficha, con su
 * severidad en los tres canales (color + ícono + palabra) y nunca en granate: la marca no es riesgo.
 */
function EnUnaFrase({ c, leidos, valorAsignado, esperandoDocumentos }: {
  c: Comprobante;
  leidos: ComprobanteContrato[];
  valorAsignado: number;
  esperandoDocumentos: number;
}) {
  const n = c.detalle.length;
  if (n === 0) return null;
  const entidades = new Set(c.detalle.map((k) => k.entidad).filter(Boolean)).size;
  const conSenal = leidos.filter(esSenalPublicada);
  const nConSenal = c.resumen.contratosConSenal ?? conSenal.length;
  const fuerte = [...conSenal].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.banderas - a.banderas)[0] ?? null;
  const sevFuerte = fuerte ? bandera(fuerte.severidad) : null;

  let desenlace: React.ReactNode;
  if (leidos.length === 0) {
    desenlace = esperandoDocumentos > 0
      ? <>; ninguno terminó de leerse todavía, {numero(esperandoDocumentos)} esperan sus documentos.</>
      : <>; ninguno terminó de leerse todavía.</>;
  } else if (leidos.length < n) {
    desenlace = <>. Van <strong className="font-mono">{numero(leidos.length)}</strong> leídos y <strong className="font-mono">{numero(nConSenal)}</strong> {nConSenal === 1 ? "tenía" : "tenían"} al menos una señal.</>;
  } else {
    desenlace = <>; <strong className="font-mono">{numero(nConSenal)}</strong> {nConSenal === 1 ? "tenía" : "tenían"} al menos una señal.</>;
  }

  return (
    <div className="rounded-2xl border border-line bg-paperSoft px-4 py-4 sm:px-5">
      <p className="font-display text-lg leading-snug text-ink text-pretty sm:text-xl">
        {n === 1 ? "El contrato" : <>Los <strong className="font-mono">{numero(n)}</strong> contratos</>} de {c.zona}{" "}
        {n === 1 ? "vale" : "suman"} <strong className="whitespace-nowrap">{solesCompacto(valorAsignado)}</strong> de valor referencial
        {entidades > 0 && <> en {entidades === 1 ? "1 entidad" : `${numero(entidades)} entidades`}</>}
        {desenlace}
      </p>
      {fuerte && (
        <Link
          href={`/app/contratos/${encodeURIComponent(fuerte.ocid)}`}
          className="group mt-3 flex items-start justify-between gap-3 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm transition-colors duration-150 hover:border-ink/30"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-inkSoft">
              La señal más fuerte
              {sevFuerte && <Severidad bandera={sevFuerte} formato="pastilla" />}
              {fuerte.score != null && <span className="font-normal text-mute">puntaje {numero(fuerte.score)} de 100</span>}
            </span>
            <span className="mt-1 line-clamp-2 font-medium text-ink">{fuerte.titulo ?? fuerte.ocid}</span>
            {fuerte.entidad && <span className="mt-0.5 block truncate text-[12px] text-inkSoft">{fuerte.entidad}</span>}
          </span>
          <ArrowRight size={16} className="mt-1 shrink-0 text-inkSoft transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
