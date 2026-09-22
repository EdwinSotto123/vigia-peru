import { BookOpen, Bot, ExternalLink, FileText, Quote, Scale } from "lucide-react";
import { NivelSenal } from "@/components/alertas/NivelSenal";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import { soles, type Senal } from "@/lib/revision";

/**
 * El detalle de UNA señal, tal como se lee dentro del panel de <Revelar>: norma
 * citada, cita textual con su página, enlace al documento y —obligatorio— qué NO
 * prueba esto.
 *
 * Es un ReactNode que arma el server component y cruza el límite ya renderizado;
 * no viaja ninguna función. El detalle se renderiza con la fila (no al abrir), así
 * que el panel no tiene estado de carga: el dato ya estaba.
 *
 * El bloque "qué no prueba" no es una nota legal al pie ni letra chica: es la
 * pieza de producto que impide que la interfaz convierta una señal en un veredicto.
 * Va en el mismo peso tipográfico que la evidencia, no por debajo.
 */

function Bloque({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute">
        <span className="text-mute" aria-hidden>{icono}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

const Dato = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
  <div className="flex gap-2 py-1 text-[13px] leading-snug">
    <dt className="w-28 shrink-0 text-mute">{etiqueta}</dt>
    <dd className="min-w-0 flex-1 text-ink">{children}</dd>
  </div>
);

export function SenalDetalle({ s }: { s: Senal }) {
  return (
    <div className="space-y-4">
      <Bloque icono={<Scale size={12} />} titulo="La señal">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <NivelSenal nivel={s.severidad} formato="pastilla" />
          <SelloCotejo verificada={s.verificada} />
          <span className="font-mono text-[11px] text-mute">{s.regla}</span>
        </div>
        {s.queMira ? (
          <p className="text-[14px] leading-relaxed text-ink">{s.queMira}</p>
        ) : (
          <p className="text-[13px] leading-relaxed text-mute">
            Esta regla no está en el catálogo publicado del pipeline, así que no hay una descripción oficial de qué
            mira. Lo que sí hay es su evidencia y la norma que cita, aquí abajo.
          </p>
        )}
      </Bloque>

      <Bloque icono={<FileText size={12} />} titulo="Evidencia">
        {s.evidencia ? (
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">{s.evidencia}</p>
        ) : (
          <p className="text-[13px] text-mute">
            El análisis registró la señal pero no guardó el texto de su evidencia. Sin evidencia legible, esta señal no
            se puede defender ante nadie: trátala como una pista para volver al expediente, no como un hallazgo.
          </p>
        )}
      </Bloque>

      <Bloque icono={<BookOpen size={12} />} titulo="Norma citada">
        {s.norma ? (
          <p className="text-[14px] leading-relaxed text-ink">{s.norma}</p>
        ) : (
          <p className="text-[13px] text-mute">Sin norma citada. Una señal sin norma no sostiene una denuncia.</p>
        )}
        {s.opinionOece && (
          <p className="mt-2 rounded-xl border border-line bg-paperSoft px-3 py-2 text-[13px] leading-relaxed text-inkSoft">
            <span className="font-semibold text-ink">Opinión del OECE aplicable: </span>
            {s.opinionOece}
          </p>
        )}
      </Bloque>

      <Bloque icono={<Quote size={12} />} titulo="Cita del expediente">
        {s.citas.length > 0 ? (
          <ul className="space-y-2">
            {s.citas.map((c, i) => (
              <li key={i} className="rounded-xl border border-line bg-paperSoft p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mute">
                  <span className="font-medium text-inkSoft">{c.documentoTitulo ?? "Documento del expediente"}</span>
                  {c.pagina != null && (
                    <span className="font-mono tabular-nums text-ink">pág. {c.pagina}</span>
                  )}
                  {c.enVigia && <span className="font-mono">copia en Vigía</span>}
                </div>
                {c.cita && (
                  <blockquote className="mt-1.5 border-l-2 border-heroViolet/40 pl-3 text-[13.5px] italic leading-relaxed text-ink">
                    “{c.cita}”
                  </blockquote>
                )}
                {c.documentoUrl && (
                  <a
                    href={c.documentoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-lg text-[12px] font-medium text-heroViolet underline-offset-2 hover:underline focus-visible:underline"
                  >
                    Abrir el documento <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] leading-relaxed text-mute">
            Sin cita de página. La página exacta la deja el agente que lee el expediente en PDF; esta señal no la tiene,
            sea porque salió de datos estructurados —registro OCDS, RNP, SUNAT— o porque el texto no se pudo anclar a
            una página concreta. El documento fuente sigue abajo, entero.
          </p>
        )}
      </Bloque>

      <Bloque icono={<Bot size={12} />} titulo="Quién la encontró">
        <dl>
          <Dato etiqueta="Agente">
            {s.agenteLabel ? (
              <>
                {s.agenteLabel} <span className="font-mono text-[11px] text-mute">({s.agente})</span>
              </>
            ) : (
              <span className="text-mute">
                No consta. El análisis es anterior a que se guardara el agente de origen, o el contrato ya no responde
                en el índice OCDS.
              </span>
            )}
          </Dato>
          <Dato etiqueta="Cotejo">
            {s.verificada === true
              ? "Los montos, RUC, fechas y URLs que cita se volvieron a comprobar contra fuentes oficiales."
              : s.verificada === false
                ? "El cotejo automático no pudo confirmar alguno de los datos citados."
                : "No consta que se haya cotejado por segunda vez. No es lo mismo que haber fallado."}
          </Dato>
          <Dato etiqueta="En este contrato">
            {s.senalesDelContrato === 1
              ? "Es la única señal del contrato."
              : `Es 1 de ${s.senalesDelContrato} señales del mismo contrato.`}
          </Dato>
        </dl>
      </Bloque>

      {/* Verdad de producto, no letra chica: la plataforma publica señales, nunca acusaciones. */}
      <section className="rounded-2xl border border-paperEdge bg-paperDeep p-4">
        <h3 className="mb-2 font-serif text-[15px] font-bold leading-tight text-ink">Qué NO prueba esto</h3>
        <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-inkSoft">
          <li>
            <strong className="font-semibold text-ink">No prueba que haya delito.</strong> Una señal es una regla que
            disparó sobre documentos públicos. No hay imputación, ni investigación fiscal, ni sanción detrás de esta
            fila.
          </li>
          <li>
            <strong className="font-semibold text-ink">No prueba mala fe.</strong> Casi todas estas reglas tienen
            explicaciones legítimas: una sola oferta válida puede ser un mercado chico, y un requisito estrecho puede
            ser una necesidad técnica real.
          </li>
          <li>
            <strong className="font-semibold text-ink">Nadie dio su descargo.</strong> Vigía lee expedientes públicos;
            no le pidió explicaciones a {s.entidad} ni a {s.proveedor}, y ninguno de los dos respondió aquí.
          </li>
          <li>
            <strong className="font-semibold text-ink">No se suma con las otras.</strong> Que el contrato tenga{" "}
            {s.senalesDelContrato} {s.senalesDelContrato === 1 ? "señal" : "señales"} no multiplica la gravedad de esta:
            cada una se sostiene, o no, con su propia norma y su propia evidencia.
          </li>
        </ul>
      </section>

      <Bloque icono={<FileText size={12} />} titulo="El contrato">
        <dl>
          <Dato etiqueta="Objeto">{s.objeto}</Dato>
          <Dato etiqueta="Entidad">{s.entidad}</Dato>
          <Dato etiqueta="Proveedor">{s.proveedor}</Dato>
          <Dato etiqueta="Monto">
            <span className="font-mono tabular-nums">{soles(s.montoSoles)}</span>
          </Dato>
          <Dato etiqueta="Score">
            <span className="font-mono tabular-nums">{s.score}</span> de 100, con{" "}
            <span className="font-mono tabular-nums">{s.senalesDelContrato}</span>{" "}
            {s.senalesDelContrato === 1 ? "señal" : "señales"} en total
          </Dato>
        </dl>
      </Bloque>
    </div>
  );
}
