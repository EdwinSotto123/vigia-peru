import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Indicador } from "@/components/listado";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import type { AnalisisEnRevision, RevisionMotivo } from "@/lib/revision";

/**
 * "Financiados en revisión" sobre la plantilla Listado (§14.1): los análisis
 * financiados que terminaron y NO se publicaron (§10.1 y §10.4).
 *
 * Indicadores: cuántos, de cuántos, y los motivos más frecuentes. Tabla: una fila por
 * contrato —qué es, por qué (chips con la medida), cuánto, cuándo— y el detalle de
 * cada motivo (valor contra umbral, reglas sin respaldo) en el panel lateral.
 *
 * §10.4: de una alerta en revisión se dice "En revisión" y el motivo, nada más —ni
 * puntaje, ni señales—. Todo sale de `GET /alertas/:codigo/revision`.
 */

const pct = (x: number | null) => (x == null ? null : porcentaje(x * 100));

const COLUMNAS: Columna[] = [
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1.4fr)" },
  { clave: "motivo", titulo: "Por qué está en revisión", ancho: "minmax(0,1fr)", desde: "md" },
  { clave: "valor", titulo: "Valor referencial", ancho: "124px", alinear: "der", desde: "lg" },
  { clave: "leido", titulo: "Leído", ancho: "80px", desde: "lg" },
];

/** Las cifras de la vista: el total con su denominador y los motivos que más frenan. */
export function indicadoresRevision(items: AnalisisEnRevision[], procesados: number | null, publicadas: number): Indicador[] {
  const porMotivo = new Map<string, number>();
  for (const it of items) for (const m of it.revision?.motivos ?? []) porMotivo.set(m.titulo, (porMotivo.get(m.titulo) ?? 0) + 1);
  const top = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const conDenominador = procesados != null && procesados >= items.length;
  return [
    {
      valor: numero(items.length),
      etiqueta: "financiados en revisión",
      contexto: conDenominador ? `de ${numero(procesados)} financiados leídos` : undefined,
      ayuda: (
        <Ayuda titulo="¿Por qué están en revisión?">
          <span className="block">
            El análisis terminó, pero la autoevaluación no alcanzó el umbral para publicarlo. Una persona lo revisa y
            decide publicar o descartar; mientras tanto no cuenta como señal hallada.
          </span>
          <span className="mt-2 block text-mute">
            Se muestran a propósito: las {numero(publicadas)} señales publicadas sólo significan algo si se sabe qué
            quedó fuera y por qué.
          </span>
        </Ayuda>
      ),
    },
    ...top.map(([titulo, n]) => ({ valor: numero(n), etiqueta: titulo, contexto: `de ${numero(items.length)} en revisión` })),
  ];
}

export function EnRevision({ items }: { items: AnalisisEnRevision[] }) {
  if (items.length === 0) {
    return (
      <EstadoVacio titulo="Ningún contrato financiado está en revisión" compacto>
        Cuando la autoevaluación frena un análisis, aparece aquí con su motivo.
      </EstadoVacio>
    );
  }
  const filas: Fila[] = items.map(({ procesamiento: p, revision }) => {
    const motivos = revision?.motivos ?? [];
    const titulo = p.titulo ?? "Contrato sin título en el registro";
    return {
      id: p.ocid,
      celdas: {
        contrato: <CeldaPrincipal titulo={titulo} meta={[p.entidad ?? "Entidad no registrada", p.zona]} />,
        motivo: (
          <span className="flex min-w-0 flex-wrap gap-1.5">
            {motivos.length === 0 ? (
              <span className="pill border-dashed border-line text-mute">Motivo sin leer</span>
            ) : (
              motivos.map((m) => (
                <span key={m.clave} className="pill border-line bg-paperSoft text-inkSoft">
                  {m.titulo}
                  {m.valor != null && <span className="font-semibold tabular-nums text-ink">{pct(m.valor)}</span>}
                </span>
              ))
            )}
          </span>
        ),
        valor: <CeldaNumero>{p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}</CeldaNumero>,
        leido: <CeldaFecha fecha={revision?.analizadoEn ?? p.finalizadoAt} />,
      },
      detalle: {
        titulo,
        etiqueta: `Ver por qué está en revisión: ${titulo}`,
        descripcion: (
          <span className="flex flex-wrap gap-x-3">
            <span>{p.entidad ?? "Entidad no registrada"}</span>
            <span className="font-mono">{p.alertaCodigo ?? p.ocid}</span>
          </span>
        ),
        contenido: <DetalleMotivos item={{ procesamiento: p, revision }} titulo={titulo} />,
        pie: (
          <Link href={`/app/auditoria/${p.ocid}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-granate hover:underline">
            Ver el análisis completo, fase por fase <ArrowRight size={13} aria-hidden />
          </Link>
        ),
      },
    };
  });
  return <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Financiados en revisión" />;
}

export function EnRevisionSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS} filas={8} />;
}

/**
 * El panel (§14.4): el chip "En revisión", los datos del contrato en filas y un bloque por
 * motivo con su medida contra el umbral. Nada de puntaje ni señales (§10.4).
 */
function DetalleMotivos({ item: { procesamiento: p, revision }, titulo }: { item: AnalisisEnRevision; titulo: string }) {
  const motivos = revision?.motivos ?? [];
  const leido = revision?.analizadoEn ?? p.finalizadoAt;
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <PesoRiesgo score={null} enRevision formato="pastilla" />
        <Ayuda titulo="¿Qué significa «en revisión»?">
          El análisis terminó, pero la autoevaluación no alcanzó el umbral para publicarlo. Una persona lo revisa y decide
          publicar o descartar; mientras tanto no cuenta como señal hallada.
        </Ayuda>
      </ChipsDetalle>

      {/* La cabecera del panel recorta el título a una línea; el objeto completo va aquí. */}
      <DatosClave
        items={[
          { etiqueta: "Objeto del contrato", valor: titulo },
          { etiqueta: "Entidad", valor: p.entidad },
          { etiqueta: "Zona", valor: p.zona },
          { etiqueta: "Valor referencial", valor: p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : null, mono: true },
          { etiqueta: "Leído el", valor: leido ? fecha(leido) : null },
        ]}
      />

      {motivos.length === 0 ? (
        <BloqueDetalle titulo="Por qué está en revisión">
          <p className="text-mute">El motivo detallado no se pudo leer. El análisis sigue sin publicarse.</p>
        </BloqueDetalle>
      ) : (
        motivos.map((m) => <Motivo key={m.clave} m={m} />)
      )}
    </CuerpoDetalle>
  );
}

/** Un motivo: la medida y su umbral junto al título ("33 %, mínimo 60 %"), la barra y lo que lo explica. */
function Motivo({ m }: { m: RevisionMotivo }) {
  const tieneMedida = m.valor != null && m.umbral != null;
  return (
    <BloqueDetalle
      titulo={m.titulo}
      acciones={
        tieneMedida ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-mute">
            <span className="font-semibold text-ink">{pct(m.valor)}</span>, mínimo {pct(m.umbral)}
          </span>
        ) : undefined
      }
    >
      {tieneMedida && <Medidor valor={m.valor as number} umbral={m.umbral as number} titulo={m.titulo} />}
      <p className={tieneMedida ? "mt-2 text-inkSoft" : "text-inkSoft"}>{m.detalle}</p>
      {m.reglasEtiquetas && m.reglasEtiquetas.length > 0 && (
        <DatosClave
          className="mt-3"
          items={[
            {
              etiqueta: "Sin respaldo localizable",
              valor: (
                <span className="flex flex-wrap gap-1.5">
                  {m.reglasEtiquetas.map((r) => (
                    <span key={r} className="pill border-line bg-paperSoft text-inkSoft">
                      {r}
                    </span>
                  ))}
                </span>
              ),
            },
          ]}
        />
      )}
    </BloqueDetalle>
  );
}

/** Valor contra umbral. Barra neutra, no roja: quedar debajo del umbral es el control de calidad trabajando. */
function Medidor({ valor, umbral, titulo }: { valor: number; umbral: number; titulo: string }) {
  const v = Math.max(0, Math.min(1, valor));
  const u = Math.max(0, Math.min(1, umbral));
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full bg-paperDeep"
      role="img"
      aria-label={`${titulo}: ${Math.round(v * 100)} por ciento, umbral mínimo ${Math.round(u * 100)} por ciento`}
    >
      <div className="h-full rounded-full bg-mute" style={{ width: `${v * 100}%` }} />
      <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${u * 100}% - 1px)` }} aria-hidden />
    </div>
  );
}
