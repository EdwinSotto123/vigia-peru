"use client";

import type { ReactNode } from "react";
import { Banknote, Gauge, Wallet } from "lucide-react";
import { Ayuda, AyudaTermino, EnUnaFrase } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { listaY, numero, plural, porcentaje } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { PersonName, esPersonaNatural } from "../../Redact";
import { fechaDossier, montoDossier, puntajeVisible, type ConteoSeveridad, type EstadoCorrida } from "../dossier";
import { cifrasDelProceso, conArticulo, enFrase, mayusculaInicial, queSeContrato, type SenalRelato } from "./historia";

/**
 * El veredicto del informe, arriba de todo y en todas las pestañas (pedido del usuario del 2026-11-05: contar una
 * historia; primero el veredicto en una frase). Reemplaza a las cuatro cifras sueltas y a la tarjeta «El análisis
 * encontró N señales», que se leían como dos bloques apilados: ahora es UNA frase armada con los DATOS (no con el texto
 * del modelo) y, debajo, las cifras que la sostienen.
 *
 *   «El Ejército Peruano compró «dos (02) reservorios…» a RM LOGISTIC S.A.C., el único postor, por S/ 212,000: justo el
 *    valor referencial. El análisis encontró 4 señales (2 altas y 2 medias); lo más grave: oferta igual al valor
 *    referencial y único postor con oferta alta.»
 *
 * El tono es el de la señal más grave. El puntaje sólo aparece junto a las señales que lo explican (§10.4).
 */
export function FraseDossier({
  conv,
  ganador,
  nGanadores,
  senales,
  conteo,
  score,
  corrida,
  perfil,
}: {
  conv: any;
  ganador: any;
  nGanadores: number;
  /** Las señales del relato, ya en orden de gravedad (`senalesDelRelato`). */
  senales: SenalRelato[];
  conteo: ConteoSeveridad;
  score: number | null;
  corrida: EstadoCorrida;
  perfil?: string | null;
}) {
  const entidad = conv.entidad ? conArticulo(tituloNatural(String(conv.entidad).replace(/\s+/g, " ").trim())) : "la entidad";
  const { verbo, que } = queSeContrato(conv.objeto, perfil);
  const { referencial, adjudicado, variacion } = cifrasDelProceso(conv, ganador);
  const nPostores = typeof conv.n_postores === "number" && conv.n_postores > 0 ? conv.n_postores : null;
  const natural = esPersonaNatural(ganador?.ruc);
  // La persona natural va en vidrio (su apellido), como en la identidad.
  const nombreGanador: ReactNode = !ganador?.nombre ? null : natural ? <PersonName name={ganador.nombre} orden="sunat" /> : ganador.nombre;

  // ─── La primera oración: quién le compró qué a quién, por cuánto ───
  const otros = nGanadores > 1 ? ` y a ${plural(nGanadores - 1, "ganador más", "ganadores más")} en otros ítems` : "";
  // `n_postores` es lo que el registro OCDS llama «tenderers»: los que se registraron, no los que ofertaron (en la ficha,
  // «15 participantes, 2 ofertas»). Por eso «entre 15 participantes» y no «entre 15 postores».
  const postores = nPostores === 1 && nGanadores <= 1 ? ", el único participante" : nPostores && nPostores > 1 ? `, entre ${numero(nPostores)} participantes` : "";
  const frenteAlReferencial =
    variacion === null
      ? ""
      : Math.abs(variacion) < 0.1
        ? ": justo el valor referencial"
        : `, ${porcentaje(Math.abs(variacion), { decimales: 1 })} ${variacion > 0 ? "sobre" : "bajo"} el valor referencial`;
  // Lo que sigue al nombre del ganador: el inciso de los postores cierra con coma sólo si después viene el monto.
  const cola =
    otros + postores + (adjudicado !== null ? `${postores ? "," : ""} por ${montoDossier(adjudicado)}${frenteAlReferencial}` : "");
  // «… a RM LOGISTIC S.A.C.» sin nada después ya cierra con su punto.
  const cierre = !cola && /[.…]$/.test(String(ganador?.nombre ?? "").trim()) ? "" : ".";
  // Sin objeto registrado no se escriben unas comillas vacías: «le compró a X», «contrató a X», «convocó un proceso».
  const primera: ReactNode = nombreGanador ? (
    <>
      {mayusculaInicial(entidad)}{" "}
      {que ? (
        <>
          {verbo} «{que}» {verbo === "compró" ? "a" : "con"}
        </>
      ) : verbo === "compró" ? (
        "le compró a"
      ) : (
        "contrató a"
      )}{" "}
      {nombreGanador}
      {cola}
      {cierre}
    </>
  ) : (
    <>
      {mayusculaInicial(entidad)} convocó {que ? <>«{que}»</> : "un proceso"}
      {referencial !== null && ` por un valor referencial de ${montoDossier(referencial)}`}; el registro todavía
      no publica la buena pro.
    </>
  );

  // ─── La segunda: qué encontró el análisis y lo más grave, por nombre ───
  const niveles = (["alta", "media", "baja"] as const).filter((k) => conteo[k] > 0);
  const PALABRA = { alta: ["alta", "altas"], media: ["media", "medias"], baja: ["baja", "bajas"] } as const;
  const graves = Array.from(new Map(senales.map((s) => [s.regla, s])).values()).slice(0, 2);
  const segunda: ReactNode =
    conteo.total > 0 ? (
      <>
        El análisis encontró{" "}
        {niveles.length === 1
          ? `${conteo.total === 1 ? "una señal" : `${numero(conteo.total)} señales`} ${PALABRA[niveles[0]][conteo.total === 1 ? 0 : 1]}`
          : `${plural(conteo.total, "señal", "señales")} (${listaY(niveles.map((k) => `${numero(conteo[k])} ${PALABRA[k][conteo[k] === 1 ? 0 : 1]}`))})`}
        {graves.length > 0 &&
          `${conteo.total === 1 ? ": " : niveles[0] === "baja" ? "; lo principal: " : "; lo más grave: "}${listaY(graves.map((s) => enFrase(s.etiqueta)))}`}
        .
      </>
    ) : corrida.completa ? (
      <>
        El análisis terminó sin señales: ninguna regla de contratación disparó.{" "}
        <Ayuda titulo="¿Qué quiere decir sin señales?">
          Se evaluaron las reglas de contratación y se escribió el dictamen, y ninguna regla disparó una señal. No es un
          certificado: es lo que permitieron ver los datos públicos de este proceso.
        </Ayuda>
      </>
    ) : (
      <>
        El análisis no terminó completo{corrida.faltan.length > 0 && ` (faltó ${corrida.faltan.join(" y ")})`}: que no aparezcan
        señales no quiere decir que no las haya.{" "}
        <Ayuda titulo="¿Qué quiere decir incompleto?">
          Una o más revisiones del análisis no llegaron a correr. Que no aparezcan señales no quiere decir que el contrato no las
          tenga.
        </Ayuda>
      </>
    );

  // La fecha que ancla la historia: la buena pro; si no hay, la firma; si no, la convocatoria (como las cifras de antes).
  const cuando = conv.fecha_buena_pro
    ? { etiqueta: "buena pro el", valor: conv.fecha_buena_pro }
    : conv.fecha_contrato
      ? { etiqueta: "firma del contrato el", valor: conv.fecha_contrato }
      : conv.fecha_publicacion
        ? { etiqueta: "convocatoria del", valor: conv.fecha_publicacion }
        : null;
  const cifra = "font-semibold tabular-nums text-ink";
  const tono = conteo.alta > 0 ? "alta" : conteo.media > 0 ? "media" : conteo.baja > 0 ? "baja" : "neutro";

  return (
    <EnUnaFrase
      tono={tono}
      datos={
        <>
          <Dato icono={Banknote} nombre="Adjudicado">
            {adjudicado !== null ? (
              <>
                <strong className={cifra}>{montoDossier(adjudicado)}</strong> adjudicado
              </>
            ) : (
              "Sin buena pro publicada"
            )}{" "}
            <AyudaTermino clave="adjudicacion" />
          </Dato>
          <Dato icono={Wallet} nombre="Valor referencial">
            {referencial !== null ? (
              <>
                <strong className={cifra}>{montoDossier(referencial)}</strong> valor referencial
              </>
            ) : (
              "Sin valor referencial publicado"
            )}{" "}
            <AyudaTermino clave="valor-referencial" />
          </Dato>
          {cuando && (
            <Dato tipo="fecha">
              {cuando.etiqueta} <strong className={cifra}>{fechaDossier(cuando.valor, true)}</strong>
            </Dato>
          )}
          {nPostores && (
            <Dato tipo="personas">
              <strong className={cifra}>{numero(nPostores)}</strong> {nPostores === 1 ? "participante" : "participantes"}
            </Dato>
          )}
          {puntajeVisible(score) !== null && (
            <Dato icono={Gauge} nombre="Puntaje de riesgo">
              puntaje <strong className={cifra}>{puntajeVisible(score)}</strong> de 100{" "}
              <Ayuda titulo="¿Qué es el puntaje?">
                Suma el peso de cada señal, de 0 a 100: riesgo alto desde {CORTE_ALTA}, medio desde {CORTE_MEDIA}. Una señal es
                un patrón que disparó una regla de contratación, con la norma y la evidencia que lo sostienen: una pista para
                comprobar, no una acusación.
              </Ayuda>
            </Dato>
          )}
        </>
      }
      pie={conteo.total > 0 && !corrida.completa ? `Análisis incompleto${corrida.faltan.length ? `: faltó ${corrida.faltan.join(" y ")}` : ""}.` : undefined}
    >
      {primera} {segunda}
    </EnUnaFrase>
  );
}
