import { ExternalLink } from "lucide-react";
import { NivelSenal } from "@/components/alertas/NivelSenal";
import { SelloCotejo } from "@/components/alertas/SelloCotejo";
import { ProveedorProtegido, TextoProtegido } from "@/components/alertas/Protegido";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { Ayuda, BloqueDetalle, ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave } from "@/components/patrones";
import { Ruc } from "@/components/Redact";
import { plural, soles } from "@/lib/formato";
import type { Senal } from "@/lib/revision";

/**
 * El detalle de UNA señal, tal como se lee dentro del panel de <Revelar> (§14.4):
 * chips (severidad y cotejo) → datos del contrato en filas → qué mira la regla, qué se
 * encontró, la norma, la evidencia del expediente y —obligatorio— qué NO prueba esto.
 *
 * Es un ReactNode que arma el server component y cruza el límite ya renderizado;
 * no viaja ninguna función. El detalle se renderiza con la fila (no al abrir), así
 * que el panel no tiene estado de carga: el dato ya estaba.
 *
 * El bloque "qué no prueba" no es una nota legal al pie ni letra chica: es la
 * pieza de producto que impide que la interfaz convierta una señal en un veredicto.
 * Va en el mismo peso tipográfico que la evidencia, no por debajo.
 */

/** Dice lo que el cotejo hace y nada más: revisa los datos citados, no la conclusión. */
function textoCotejo(v: boolean | null): string {
  if (v === true) {
    return "El cotejo automático no encontró contradicciones entre los datos que cita (montos, RUC, fechas o enlaces) y las fuentes oficiales. Revisa los datos, no la conclusión de la señal.";
  }
  if (v === false) return "El cotejo automático no pudo confirmar alguno de los datos citados.";
  return "No consta que se haya cotejado por segunda vez. No es lo mismo que haber fallado.";
}

export function SenalDetalle({ s }: { s: Senal }) {
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <NivelSenal nivel={s.severidad} formato="pastilla" />
        <SelloCotejo verificada={s.verificada} />
        <Ayuda titulo="¿Qué revisa el cotejo?">{textoCotejo(s.verificada)}</Ayuda>
      </ChipsDetalle>

      <DatosClave
        items={[
          { etiqueta: "Objeto del contrato", valor: s.objeto },
          { etiqueta: "Entidad", valor: s.entidad },
          { etiqueta: "Proveedor", valor: <ProveedorProtegido nombre={s.proveedor} ruc={s.rucProveedor} /> },
          ...(s.rucProveedor ? [{ etiqueta: "RUC del proveedor", valor: <Ruc value={s.rucProveedor} />, mono: true }] : []),
          { etiqueta: "Monto", valor: s.montoSoles > 0 ? soles(s.montoSoles) : null, mono: true },
          {
            etiqueta: "Peso del riesgo",
            ayuda: (
              <Ayuda titulo="¿De qué es este peso?">
                Es del contrato completo, no de esta señal: suma el peso de cada señal según su severidad, con tope en 100.
                No es una probabilidad de delito.
              </Ayuda>
            ),
            valor: (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <PesoRiesgo score={s.score} banderas={s.senalesDelContrato} className="text-[13px]" />
                <span className="tabular-nums text-inkSoft">
                  puntaje {s.score} de 100, por {plural(s.senalesDelContrato, "señal", "señales")}
                </span>
              </span>
            ),
          },
          {
            etiqueta: "Señales del contrato",
            valor: s.senalesDelContrato === 1 ? "Es la única" : `Es 1 de ${s.senalesDelContrato}`,
          },
          {
            etiqueta: "La encontró",
            valor: s.agenteLabel ?? <span className="text-mute">No consta</span>,
            ayuda: s.agenteLabel ? undefined : (
              <Ayuda titulo="¿Por qué no consta el agente?">
                El análisis es anterior a que se guardara qué agente encontró cada señal, o la ficha del contrato ya no
                aparece en el portal de contrataciones del OECE.
              </Ayuda>
            ),
          },
        ]}
      />

      <BloqueDetalle titulo="Qué mira esta regla">
        {s.queMira ? (
          <p>{s.queMira}</p>
        ) : (
          <p className="text-mute">
            Sin descripción publicada todavía. Lo que sí hay es su evidencia y la norma que cita, aquí abajo.
          </p>
        )}
      </BloqueDetalle>

      <BloqueDetalle titulo="Qué se encontró">
        {s.evidencia ? (
          <p className="whitespace-pre-line">
            <TextoProtegido texto={s.evidencia} nombres={s.personasPrivadas} />
          </p>
        ) : (
          <p className="text-mute">
            El análisis registró la señal pero no guardó el texto de su evidencia. Sin evidencia legible, trátala como una
            pista para volver al expediente, no como un hallazgo.
          </p>
        )}
      </BloqueDetalle>

      <BloqueDetalle titulo="La norma que cita">
        {s.norma ? <p>{s.norma}</p> : <p className="text-mute">Sin norma citada. Una señal sin norma no sostiene una denuncia.</p>}
        {s.opinionOece && (
          <div className="mt-2">
            <CitaDetalle fuente="Opinión del OECE aplicable">{s.opinionOece}</CitaDetalle>
          </div>
        )}
      </BloqueDetalle>

      <BloqueDetalle
        titulo="Evidencia en el expediente"
        ayuda={
          s.citas.length === 0 ? (
            <Ayuda titulo="¿Por qué no hay página citada?">
              La página exacta la anota el agente que lee los PDF del expediente, y esta señal no la tiene: salió de
              registros oficiales (el de contrataciones del OECE, el Registro Nacional de Proveedores o SUNAT) o su texto
              no se pudo ubicar en una página concreta.
              {s.fuenteUrl ? " La ficha oficial del contrato está en el pie de este panel." : ""}
            </Ayuda>
          ) : undefined
        }
      >
        {s.citas.length > 0 ? (
          <ul className="space-y-2">
            {s.citas.map((c, i) => {
              const fuente = (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                  <span className="font-medium text-inkSoft">{c.documentoTitulo ?? "Documento del expediente"}</span>
                  {c.pagina != null && <span className="font-mono tabular-nums text-ink">pág. {c.pagina}</span>}
                  {c.enVigia && <span className="font-mono">copia en Vigía</span>}
                  {c.documentoUrl && (
                    <a
                      href={c.documentoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg font-medium text-granate underline-offset-2 hover:underline focus-visible:underline"
                    >
                      Abrir el documento <ExternalLink size={11} aria-hidden />
                    </a>
                  )}
                </span>
              );
              return (
                <li key={i}>
                  {/* Sin texto de la página no hay cita que mostrar: sólo el documento y su enlace. */}
                  {c.cita ? (
                    <CitaDetalle fuente={fuente}>
                      “<TextoProtegido texto={c.cita} nombres={s.personasPrivadas} />”
                    </CitaDetalle>
                  ) : (
                    fuente
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-mute">Sin cita de página.</p>
        )}
      </BloqueDetalle>

      {/* Verdad de producto, no letra chica: la plataforma publica señales, nunca acusaciones. */}
      <BloqueDetalle titulo="Qué no prueba esto">
        <ul className="space-y-1.5 text-inkSoft">
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
            no le pidió explicaciones a {s.entidad} ni a <ProveedorProtegido nombre={s.proveedor} ruc={s.rucProveedor} />,
            y ninguno de los dos respondió aquí.
          </li>
          <li>
            <strong className="font-semibold text-ink">No se suma con las otras.</strong> Que el contrato tenga{" "}
            {s.senalesDelContrato} {s.senalesDelContrato === 1 ? "señal" : "señales"} no multiplica la gravedad de esta:
            cada una se sostiene, o no, con su propia norma y su propia evidencia.
          </li>
        </ul>
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}
