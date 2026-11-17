/**
 * «Perfil del contratista»: lo que las bases le pedían a quien quisiera ganar (pedido del usuario del 2026-11-17: «crea un
 * PERFIL DEL CONTRATISTA en el sentido de lo que PIDEN las BASES»). Sale de la ficha de las bases leída por pieza
 * (backend/lector/ficha_bases.py, las integradas si las hay): experiencia, personal clave, equipamiento, exigencias,
 * documentos, factores de evaluación, plazos, garantías, penalidades y pago, cada dato con la página que lo dice.
 *
 * Server component; `CitaPagina` es la isla de cliente que abre la página del documento.
 */
import type { ReactNode } from "react";
import { BadgeCheck, CalendarClock, ClipboardList, FileCheck2, Scale, ShieldCheck, Tag, Users, Wrench } from "lucide-react";
import { Ayuda, BloqueDetalle, CabeceraPestana, DatosClave, EnUnaFrase, FuenteDato, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { enlacesProceso } from "@/lib/fuentes";
import { numero, oracion, plural, soles } from "@/lib/formato";
import type { CitaDocumento, ContratoDetalle as Detalle, PerfilContratista as Perfil } from "@/lib/contratos";
import { CitaPagina } from "./CitaPagina";

/** Cuántos requisitos trae el perfil (el conteo de la pestaña). */
export const cuentaPerfil = (p: Perfil) =>
  p.experiencia.length + p.personalClave.length + p.equipamiento.length + p.exigencias.length + p.factores.length + p.marcas.length;

const TIPO_GARANTIA: Record<string, string> = {
  fiel_cumplimiento: "De fiel cumplimiento", adelanto: "Por adelanto", comercial: "Comercial", prestaciones_accesorias: "Por prestaciones accesorias",
  otra: "Otra garantía",
};
const PARA: Record<string, string> = { general: "Para todos", mype: "Para micro y pequeñas empresas", consorcio: "Para consorcios" };

function Cita({ ocid, cita }: { ocid: string; cita: CitaDocumento | null }) {
  return cita && (cita.pagina != null || cita.documentoUrl) ? <CitaPagina ocid={ocid} cita={cita} corto className="shrink-0" /> : null;
}

/** Un renglón de una lista del perfil: el texto, lo que lo precisa debajo y la página a la derecha. */
function Renglon({ ocid, cita, children, sub }: { ocid: string; cita: CitaDocumento | null; children: ReactNode; sub?: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-dato leading-relaxed text-ink">{children}</p>
        {sub && <div className="mt-1 text-rotulo leading-relaxed text-mute">{sub}</div>}
      </div>
      <Cita ocid={ocid} cita={cita} />
    </li>
  );
}

function Lista({ titulo, ayuda, children, vacio }: { titulo: string; ayuda?: ReactNode; children: ReactNode[]; vacio?: string }) {
  if (!children.length && !vacio) return null;
  return (
    <BloqueDetalle titulo={titulo} ayuda={ayuda}>
      {children.length ? <ul>{children}</ul> : <p className="text-dato text-mute">{vacio}</p>}
    </BloqueDetalle>
  );
}

const cantidadDe = (x: { cantidad: number | null; unidad: string | null }) =>
  x.cantidad == null ? null : x.unidad && /sol/i.test(x.unidad) ? soles(x.cantidad) : `${numero(x.cantidad)}${x.unidad ? ` ${x.unidad}` : ""}`;

export function SeccionPerfil({ c }: { c: Detalle }) {
  const p = c.perfilContratista!;
  const totalFactores = p.factores.reduce((s, f) => s + (f.puntajeMaximo ?? 0), 0);
  // La frase de arriba sale de los datos, no del resumen del lector (que junta lo de cada tramo leído y habla de la lectura).
  const exp = p.experiencia.find((x) => x.para !== "mype" && cantidadDe(x)) ?? p.experiencia.find((x) => cantidadDe(x));
  const expMype = p.experiencia.find((x) => x.para === "mype" && cantidadDe(x) && x !== exp);
  const precio = p.factores.find((f) => /precio|econ/i.test(f.factor ?? ""));
  const entrega = p.plazos.find((x) => x.dias != null && /entrega|ejecuci/i.test(x.que ?? ""));
  const frase = [
    exp && `Pedían una experiencia de ${cantidadDe(exp)}${expMype ? ` (${cantidadDe(expMype)} a las micro y pequeñas empresas)` : ""}`,
    p.exigencias.length > 0 && `con ${plural(p.exigencias.length, "exigencia particular", "exigencias particulares")}`,
    p.marcas.length > 0 && `con ${plural(p.marcas.length, "marca nombrada", "marcas nombradas")}`,
    precio?.puntajeMaximo != null && totalFactores > 0 && `el precio daba ${numero(precio.puntajeMaximo)} de ${numero(totalFactores)} puntos`,
    entrega && `la entrega era en ${plural(entrega.dias!, "día", "días")}`,
  ].filter(Boolean).join(", ");
  const datos: DatoClave[] = [
    {
      etiqueta: "Cuantía",
      valor: p.cuantia?.estado === "reservada" ? "Reservada: no se dio a conocer" : p.cuantia?.valor != null ? soles(p.cuantia.valor) : null,
    },
    { etiqueta: "Sistema de contratación", valor: p.sistema ? oracion(p.sistema.toLowerCase()) : null },
    { etiqueta: "Financiamiento", valor: p.financiamiento ? oracion(p.financiamiento.toLowerCase()) : null },
    {
      etiqueta: "Adelantos",
      valor: p.adelantos
        ? [p.adelantos.directoPct != null && `directo de ${numero(p.adelantos.directoPct)} %`, p.adelantos.materialesPct != null && `para materiales de ${numero(p.adelantos.materialesPct)} %`]
            .filter(Boolean).join(" y ") || null
        : null,
    },
  ].filter((d) => d.valor != null);
  return (
    <>
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿De dónde sale este perfil?">
            <span className="block">
              De {p.integradas ? "las bases integradas" : "las bases"} del proceso, leídas por un modelo abierto con un extractor a medida: cada
              requisito trae la página donde está y la frase que lo dice. Ábrela para comprobarlo.
            </span>
            <span className="mt-2 block">
              Sirve para mirar si lo que se pidió calza con lo que se compró y si dejaba competir: una experiencia muy alta, una marca sin
              equivalente o un requisito que sólo cumple uno son cosas que revisar, no pruebas de nada.
            </span>
          </Ayuda>
        }
      >
        Lo que las bases le pedían a quien quisiera ganar: experiencia, documentos, cómo se puntuaba y qué se exigía al firmar.
      </CabeceraPestana>
      <div className="space-y-5 rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
        {frase && <EnUnaFrase>{frase}.</EnUnaFrase>}
        {datos.length > 0 && <DatosClave items={datos} />}

        <Lista
          titulo="Experiencia que se pedía"
          ayuda={<Ayuda titulo="¿Qué es la experiencia del postor?">Lo que el postor debía acreditar haber vendido o hecho antes, casi siempre un monto facturado en un plazo. A las micro y pequeñas empresas se les puede pedir menos.</Ayuda>}
          vacio="Las bases no traen un requisito de experiencia legible."
        >
          {p.experiencia.map((x, i) => (
            <Renglon
              key={`exp-${i}`}
              ocid={c.ocid}
              cita={x.cita}
              sub={[
                [x.para && PARA[x.para], x.anios != null && `en los últimos ${plural(x.anios, "año", "años")}`].filter(Boolean).join(", "),
                x.acreditacion && `Se acredita con: ${x.acreditacion}`,
              ].filter(Boolean).map((s) => oracion(String(s))).join(". ") || undefined}
            >
              {cantidadDe(x) ? <><b>{cantidadDe(x)}</b>{x.requisito ? `: ${x.requisito}` : ""}</> : x.requisito ?? "Requisito sin detalle"}
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Personal clave">
          {p.personalClave.map((x, i) => (
            <Renglon key={`pc-${i}`} ocid={c.ocid} cita={x.cita} sub={[x.profesion, x.experiencia].filter(Boolean).join(". ") || undefined}>
              <Dato icono={Users} nombre="Cargo">{x.cantidad != null && x.cantidad > 1 ? `${numero(x.cantidad)} ` : ""}{x.cargo ?? "Cargo sin nombre"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Equipamiento">
          {p.equipamiento.map((x, i) => (
            <Renglon key={`eq-${i}`} ocid={c.ocid} cita={x.cita}>
              <Dato icono={Wrench} nombre="Equipo">{x.cantidad != null ? `${numero(x.cantidad)} ` : ""}{x.equipo ?? "Equipo sin nombre"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Marcas exigidas">
          {p.marcas.map((x, i) => (
            <Renglon key={`m-${i}`} ocid={c.ocid} cita={x.cita} sub={x.admiteEquivalente === false ? "Sin admitir equivalente" : x.admiteEquivalente ? "Admite equivalente" : undefined}>
              <Dato icono={Tag} nombre="Marca">{x.marca ?? "Marca sin nombre"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Exigencias particulares">
          {p.exigencias.map((x, i) => (
            <Renglon key={`ex-${i}`} ocid={c.ocid} cita={x.cita}>
              <Dato icono={BadgeCheck} nombre="Exigencia">{x.exigencia ?? "Exigencia sin detalle"}</Dato>
            </Renglon>
          ))}
        </Lista>

        {p.factores.length > 0 && (
          <BloqueDetalle titulo="Cómo se puntuaba" ayuda={<Ayuda titulo="¿Qué son los factores de evaluación?">Lo que daba puntos entre las ofertas que cumplían. Si el precio pesa poco, otras cosas pueden decidir quién gana.</Ayuda>}>
            <ul>
              {p.factores.map((x, i) => (
                <Renglon key={`f-${i}`} ocid={c.ocid} cita={x.cita}>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span>{x.factor ?? "Factor sin nombre"}</span>
                    {x.puntajeMaximo != null && (
                      <b className="tabular-nums">
                        {plural(x.puntajeMaximo, "punto", "puntos")}
                        {totalFactores > 0 ? ` de ${numero(totalFactores)}` : ""}
                      </b>
                    )}
                  </span>
                  {x.puntajeMaximo != null && totalFactores > 0 && (
                    <span className="mt-1 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-paperEdge" aria-hidden>
                      <span className="block h-full rounded-full bg-serie-1" style={{ width: `${Math.min(100, (100 * x.puntajeMaximo) / totalFactores)}%` }} />
                    </span>
                  )}
                </Renglon>
              ))}
            </ul>
          </BloqueDetalle>
        )}

        <Lista titulo="Documentos para que se admita la oferta">
          {p.documentosAdmision.map((x, i) => (
            <Renglon key={`da-${i}`} ocid={c.ocid} cita={x.cita}>
              <Dato icono={ClipboardList} nombre="Documento">{x.documento ?? "Documento sin nombre"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Lo que el ganador debía presentar para firmar">
          {p.documentosContrato.map((x, i) => (
            <Renglon key={`dc-${i}`} ocid={c.ocid} cita={x.cita}>
              <Dato icono={FileCheck2} nombre="Documento">{x.documento ?? "Documento sin nombre"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Plazos">
          {p.plazos.map((x, i) => (
            <Renglon key={`pl-${i}`} ocid={c.ocid} cita={x.cita}>
              <Dato icono={CalendarClock} nombre="Plazo">{x.dias != null ? <><b>{plural(x.dias, "día", "días")}</b>{x.que ? `: ${x.que}` : ""}</> : x.que ?? "Plazo sin detalle"}</Dato>
            </Renglon>
          ))}
        </Lista>

        <Lista titulo="Garantías y penalidades">
          {[
            ...p.garantias.map((x, i) => (
              <Renglon key={`g-${i}`} ocid={c.ocid} cita={x.cita}>
                <Dato icono={ShieldCheck} nombre="Garantía">{TIPO_GARANTIA[x.tipo ?? ""] ?? "Garantía"}{x.porcentaje != null ? ` del ${numero(x.porcentaje)} %` : ""}</Dato>
              </Renglon>
            )),
            ...p.penalidades.map((x, i) => (
              <Renglon key={`pe-${i}`} ocid={c.ocid} cita={x.cita} sub={x.topePct != null ? `Tope: ${numero(x.topePct)} % del monto contratado` : undefined}>
                <Dato icono={Scale} nombre="Penalidad">{x.descripcion ?? (x.tipo === "mora" ? "Penalidad por mora" : "Penalidad")}</Dato>
              </Renglon>
            )),
          ]}
        </Lista>

        {(p.formaDePago || p.controversias) && (
          <BloqueDetalle titulo="Pago y controversias">
            <div className="space-y-2 text-dato leading-relaxed text-ink">
              {p.formaDePago && <p><b>Pago:</b> {p.formaDePago}</p>}
              {p.controversias && <p><b>Controversias:</b> {p.controversias}</p>}
            </div>
          </BloqueDetalle>
        )}
      </div>
      <FuenteDato
        fuente={`${p.documento ?? (p.integradas ? "Bases integradas" : "Bases")} del SEACE, leídas el ${p.leido ?? "día de la lectura"}`}
        enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })}
        className="mt-2"
      />
    </>
  );
}
