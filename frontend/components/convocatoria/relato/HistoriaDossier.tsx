"use client";

import { useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { CapitulosRelato, irAPestana, type CapituloRelato } from "@/components/patrones";
import { fechaDossier, montoDossier, contarSeveridades } from "../dossier";
import { hoyLima, numero, plural, porcentaje } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { setRedactNames } from "../../Redact";
import type { PanelDossierProps, TabKey } from "../sections/PanelesDossier";
import { ConteoSenales } from "../sections/ConteoSenales";
import { SeccionSegura } from "../sections/SeccionSegura";
import { DeDondeSale, LoQueDice } from "./AnalisisYFuentes";
import { EstadoInconsistente } from "./EstadoInconsistente";
import {
  cifrasDelProceso,
  conArticulo,
  mayusculaInicial,
  mismoNombre,
  pasoDeRegla,
  senalesDelRelato,
  senalesPorPaso,
  type SenalRelato,
} from "./historia";
import { LineaProceso, type PasoProceso } from "./LineaProceso";
import { ENLACE_RELATO, PorQueLlama } from "./PorQueLlama";
import { contextoDeSenales } from "../senal/directorio";
import { NombreProveedor, QuienGano } from "./QuienGano";

/**
 * «La historia», la primera pestaña del informe (pedido del usuario del 2026-11-05: «veo que solo apilamos y demás sin dar
 * orden o contar una historia»). El veredicto en una frase va arriba de las pestañas (FraseDossier); aquí, el relato en
 * capítulos numerados que se leen de a uno («divídelo por subsecciones, menos scroll»), de lo que pasó a la evidencia:
 *
 *   1. Qué pasó: la cronología del proceso con cada señal PEGADA al paso donde se ve (tabla regla → paso en ./historia).
 *   2. Por qué llama la atención: las señales por gravedad y por tema, con su evidencia y su norma.
 *   3. Quién ganó y con quién compite: el ganador, lo que dicen de él los registros y los demás postores.
 *   4. Lo que dice el análisis: el resumen ejecutivo del dictamen.
 *   5. De dónde sale cada dato: documentos, ítems, prensa, cómo se hizo y los registros cruzados.
 *
 * Las demás pestañas (Señales, Dictamen, Ítems y mercado, Proveedor y red, Documentos, Prensa, Cómo se hizo) quedan para
 * quien quiere el detalle entero: cada capítulo lleva a la suya. Se dibuja en el servidor (es la pestaña inicial).
 */
export function HistoriaDossier(p: PanelDossierProps) {
  // Como en cada pestaña: las personas privadas se registran otra vez justo antes de redactar (ver ResultadoView).
  setRedactNames(p.nombresPrivados);
  const { result, conv, ganador, ganadores, banderasArr } = p;
  // Sin la función de ResultadoView (no debería pasar), se cambia de pestaña igual, sin bajar a ella.
  const abrirTab = p.abrirTab ?? ((t: TabKey, _ancla?: string) => irAPestana(t, "tab"));
  const verEvidencia = () => abrirTab("resumen", "senales");
  // De quién habla cada señal (el ganador, la entidad y cada empresa que el dictamen nombra): lo usa su panel lateral.
  const ctxSenales = useMemo(() => contextoDeSenales(result, ganador), [result, ganador]);
  const perfil: string | null = result.compliance?.perfil ?? null;

  const senales = useMemo(() => senalesDelRelato(banderasArr), [banderasArr]);
  const conteo = useMemo(() => contarSeveridades(banderasArr), [banderasArr]);
  const nPostores = typeof conv.n_postores === "number" && conv.n_postores > 0 ? conv.n_postores : null;
  const pasos = pasosDelProceso({ result, conv, ganador, ganadores, senales, nPostores });

  const tono = conteo.alta > 0 ? "alta" : conteo.media > 0 ? "media" : conteo.total > 0 ? "baja" : undefined;
  const capitulos: CapituloRelato[] = [
    {
      id: "relato-que-paso",
      titulo: "Qué pasó",
      bajada: "Los pasos del proceso, con las fechas del registro del OECE y los días entre uno y otro. Cada señal va en el paso donde se ve.",
      contenido: (
        <>
          <SeccionSegura nombre="la cronología del proceso">
            <LineaProceso pasos={pasos} ctx={ctxSenales} perfil={perfil} />
          </SeccionSegura>
          {result.estado_real?.estado_inconsistente && (
            <SeccionSegura nombre="el aviso de estado">
              <EstadoInconsistente er={result.estado_real} className="mt-4" />
            </SeccionSegura>
          )}
        </>
      ),
    },
    {
      id: "relato-por-que",
      titulo: conteo.total > 0 ? "Por qué llama la atención" : "Qué encontró el análisis",
      conteo: conteo.total,
      tono,
      bajada:
        conteo.total > 0
          ? "Cada señal con lo que se encontró y la norma que la sostiene. Filtra por gravedad o por tema. Una señal es una pista para comprobar, no una acusación."
          : undefined,
      accion: conteo.total > 0 ? <ConteoSenales conteo={conteo} /> : undefined,
      contenido: (
        <SeccionSegura nombre="las señales del relato">
          <PorQueLlama senales={senales} contexto={p.contexto} noVerificables={p.noVerificables} corrida={p.corrida} verEvidencia={verEvidencia} ctx={ctxSenales} perfil={perfil} nombresPrivados={p.nombresPrivados} />
        </SeccionSegura>
      ),
    },
    {
      id: "relato-quien",
      titulo: "Quién ganó",
      tituloLargo: "Quién ganó y con quién compite",
      bajada: "Lo que dicen del ganador los registros públicos y quiénes más se presentaron.",
      accion: (
        <button type="button" onClick={() => abrirTab("proveedor")} className={ENLACE_RELATO}>
          Proveedor y red <ChevronRight size={14} aria-hidden />
        </button>
      ),
      contenido: (
        <SeccionSegura nombre="quién ganó">
          <QuienGano result={result} ganador={ganador} ganadores={ganadores} nPostores={nPostores} />
        </SeccionSegura>
      ),
    },
    {
      id: "relato-analisis",
      titulo: "El análisis",
      tituloLargo: "Lo que dice el análisis",
      bajada: "El resumen del dictamen que se escribió con toda esta evidencia.",
      contenido: (
        <SeccionSegura nombre="el resumen del dictamen">
          <LoQueDice
            dict={p.dict}
            corrida={p.corrida}
            modelo={result.dictamen?.gen_meta?.model ?? null}
            abrirTab={abrirTab}
            conv={conv}
            ganador={ganador}
            nPostores={nPostores}
            conteo={conteo}
          />
        </SeccionSegura>
      ),
    },
    {
      id: "relato-fuentes",
      titulo: "Las fuentes",
      tituloLargo: "De dónde sale cada dato",
      bajada: "Cada cifra sale de un registro público: aquí está cada parte del detalle y su fuente.",
      contenido: (
        <SeccionSegura nombre="las fuentes">
          <DeDondeSale
            result={result}
            conv={conv}
            corrida={p.corrida}
            ocidContrato={p.ocidContrato}
            nDocs={p.nDocs}
            nItems={p.nItems}
            nEvents={p.nEvents}
            abrirTab={abrirTab}
          />
        </SeccionSegura>
      ),
    },
  ];

  return <CapitulosRelato capitulos={capitulos} etiqueta="Capítulos de la historia" />;
}

// ─── La cronología del proceso ────────────────────────────────────────────────



/**
 * Los pasos del proceso, con lo que dicen los datos del análisis (registro OCDS, el acta y el contrato leídos), en orden:
 * antes de convocar (sólo si una señal cae ahí), la convocatoria, las ofertas, la buena pro, la firma, la ejecución (sólo
 * con señales o con la obra en INFOBRAS) y el fin del plazo del contrato. Un paso que no consta (sin buena pro, sin
 * contrato) va hueco. Al final, cada señal se pega a su paso (`senalesPorPaso`).
 */
function pasosDelProceso({
  result,
  conv,
  ganador,
  ganadores,
  senales,
  nPostores,
}: {
  result: PanelDossierProps["result"];
  conv: any;
  ganador: any;
  ganadores: any[];
  senales: SenalRelato[];
  nPostores: number | null;
}): PasoProceso[] {
  const lecturas = (result as any).lecturas_documentos ?? {};
  const acta = lecturas.acta?.salida ?? null;
  const contrato = lecturas.contrato?.salida ?? null;
  const consultas = lecturas.consultas?.salida ?? null;
  const lugarActa = result.document_analysis?.lugar_fecha_acta ?? null;
  const causal = (result as any).causal_directa_invocada;
  const sup = (result as any).supervision_obra;
  const obra = (result as any).obra_ejecucion;
  const hayObra = ((sup?.enlazada && sup.obras) || (obra?.enlazada && obra.obras) || []).length > 0;
  const entidad = conv.entidad ? conArticulo(tituloNatural(String(conv.entidad).replace(/\s+/g, " ").trim())) : "la entidad";
  const { referencial, adjudicado, variacion } = cifrasDelProceso(conv, ganador);
  const objetivos = new Set(senales.map((s) => pasoDeRegla(s.regla)));
  const pasos: PasoProceso[] = [];
  const oraciones = (xs: (string | null | undefined | false)[]) => {
    // Cada pedazo sin su punto final («S.A.C.», «17 jul.»): el punto lo pone la unión, una sola vez.
    const t = xs
      .filter((x): x is string => Boolean(x))
      .map((x) => mayusculaInicial(x.trim().replace(/\.+$/, "")))
      .filter(Boolean)
      .join(". ");
    return t ? `${t}.` : undefined;
  };

  // Antes de convocar: sólo si una señal pasa ahí (visitas previas, compras partidas).
  if (objetivos.has("antes")) {
    pasos.push({ clave: "antes", cuando: "Antes de la convocatoria", titulo: "Antes de convocar" });
  }

  // La convocatoria: qué procedimiento, por cuánto y con cuántos ítems; la causal si fue directa; las consultas a las bases.
  const nItems = typeof conv.n_items === "number" && conv.n_items > 0 ? conv.n_items : null;
  const nConsultas = typeof consultas?.n_consultas === "number" ? consultas.n_consultas : null;
  pasos.push({
    clave: "convocatoria",
    fecha: conv.fecha_publicacion ?? null,
    cuando: conv.fecha_publicacion ? undefined : "Sin fecha en el registro",
    titulo: `${mayusculaInicial(entidad)} publicó la convocatoria`,
    detalle: oraciones([
      [conv.tipo_proceso, referencial !== null && `valor referencial de ${montoDossier(referencial)}`, nItems && plural(nItems, "ítem", "ítems")]
        .filter(Boolean)
        .join(", "),
      causal?.match && `Contratación directa, literal ${String(causal.causal_letra ?? "").toUpperCase()}: ${causal.descripcion ?? "sin descripción"}`,
      nConsultas === 0
        ? "Nadie hizo consultas ni observaciones a las bases"
        : nConsultas
          ? `${plural(nConsultas, "consulta u observación", "consultas u observaciones")} a las bases`
          : null,
    ]),
  });

  // Las ofertas: cuántos se presentaron (y quiénes, si son pocos) en el plazo del registro.
  const fechaOfertas: string | null = conv.fecha_fin ?? conv.fecha_inicio ?? null;
  const participantes: any[] = ((result.postores || []) as any[]).filter((x) => x?.nombre);
  const quienes = participantes.length > 0 ? participantes : Array.isArray(acta?.postores) ? acta.postores.filter((x: any) => x?.nombre) : [];
  const n = nPostores ?? (quienes.length || null);
  if (fechaOfertas || n || objetivos.has("ofertas")) {
    // «RM LOGISTIC S.A.C.» ya cierra con punto: no se le agrega otro.
    const punto = /[.…]$/.test(String(quienes[quienes.length - 1]?.nombre ?? "").trim()) ? "" : ".";
    const nombres: ReactNode =
      quienes.length > 0 && quienes.length <= 3 ? (
        <>
          {quienes.map((q: any, i: number) => (
            <span key={`${q.ruc ?? q.nombre}-${i}`}>
              {i > 0 && (i === quienes.length - 1 ? " y " : ", ")}
              <NombreProveedor nombre={String(q.nombre)} ruc={q.ruc} />
            </span>
          ))}
          {punto}
        </>
      ) : quienes.length > 3 ? (
        "Sus nombres y ofertas, en «Quién ganó y con quién compite»."
      ) : null;
    const ventana =
      conv.fecha_inicio && conv.fecha_fin && conv.fecha_inicio !== conv.fecha_fin
        ? `La presentación se abrió el ${fechaDossier(conv.fecha_inicio, true)} y cerró en esta fecha. `
        : "";
    pasos.push({
      clave: "ofertas",
      fecha: fechaOfertas,
      cuando: fechaOfertas ? undefined : "Sin fecha en el registro",
      // `n_postores` son los registrados del OCDS (los que ofertaron pueden ser menos: la ficha dice «15 participantes, 2
      // ofertas»): «se registraron», como en la cabecera, y no «se presentaron 15 postores».
      titulo: n === 1 ? "Se registró un solo participante" : n ? `Se registraron ${numero(n)} participantes` : "Presentación de ofertas",
      detalle:
        ventana || nombres ? (
          <>
            {ventana}
            {nombres}
          </>
        ) : undefined,
    });
  }

  // La buena pro: a quién y por cuánto, frente al referencial; el puntaje y dónde se firmó el acta, si se leyó.
  // El puntaje es el del ganador que se nombra (con varios ganadores, el acta trae uno por ítem): por RUC o por nombre.
  // (Un RUC 10 puede venir tapado distinto en el acta y en el registro: por eso también por nombre.)
  const mismo = (x: any) => (!!ganador?.ruc && x?.ruc === ganador.ruc) || mismoNombre(x?.nombre, ganador?.nombre);
  const ganadorEnActa = Array.isArray(acta?.postores) ? acta.postores.find((x: any) => x?.ganador === true && mismo(x)) : null;
  if (ganador?.nombre) {
    const frente =
      variacion === null
        ? null
        : Math.abs(variacion) < 0.1
          ? "igual al valor referencial"
          : `${porcentaje(Math.abs(variacion), { decimales: 1 })} ${variacion > 0 ? "sobre" : "bajo"} el valor referencial`;
    pasos.push({
      clave: "buena_pro",
      fecha: conv.fecha_buena_pro ?? null,
      cuando: conv.fecha_buena_pro ? undefined : "Sin fecha en el registro",
      destacado: true,
      titulo: (
        <>
          Buena pro para <NombreProveedor nombre={String(ganador.nombre)} ruc={ganador.ruc} />
          {ganadores.length > 1 && ` y ${plural(ganadores.length - 1, "ganador más", "ganadores más")}`}
        </>
      ),
      detalle: oraciones([
        adjudicado !== null && `Por ${montoDossier(adjudicado)}${frente ? `, ${frente}` : ""}`,
        ganadorEnActa?.puntaje != null && Number.isFinite(Number(ganadorEnActa.puntaje)) && // Los puntos que el comité le dio a la oferta en el acta (pueden pasar de 100 con las bonificaciones de ley): no
        // es el puntaje de riesgo de Vigía, que va de 0 a 100. Antes decía «Puntaje 105», junto a un «puntaje 100 de 100».
        `Su oferta obtuvo ${numero(Number(ganadorEnActa.puntaje))} puntos en la evaluación del comité`,
        lugarActa?.lugar && `Acta firmada en ${tituloNatural(String(lugarActa.lugar))}${lugarActa.hora ? `, a las ${lugarActa.hora}` : ""}`,
      ]),
    });
  } else {
    pasos.push({ clave: "buena_pro", cuando: "Todavía no consta", titulo: "Sin buena pro publicada", falta: true });
  }

  // La firma del contrato: el número, el monto y el plazo, si se leyó el contrato. Con varios ganadores el contrato
  // leído es UNO de ellos (el registro trae uno por ítem): se dice, para que su monto no se lea como el total.
  const fechaFirma: string | null = conv.fecha_contrato ?? contrato?.fecha_suscripcion ?? null;
  const varios = ganadores.length > 1;
  if (fechaFirma) {
    pasos.push({
      clave: "firma",
      fecha: fechaFirma,
      titulo: varios ? "Se firmaron los contratos" : "Se firmó el contrato",
      detalle: oraciones([
        [
          contrato?.numero_contrato && `${varios ? "Uno de ellos, el contrato" : "Contrato"} ${contrato.numero_contrato}`,
          Number(contrato?.monto_contratado) > 0 && `por ${montoDossier(contrato.monto_contratado)}`,
          Number(contrato?.plazo_dias) > 0 && `con ${plural(Number(contrato.plazo_dias), "día", "días")} de plazo`,
        ]
          .filter(Boolean)
          .join(", "),
        // Una firma anterior a la convocatoria no se ordena por fecha (rompería el relato): se dice en su paso.
        conv.fecha_publicacion && fechaFirma.slice(0, 10) < String(conv.fecha_publicacion).slice(0, 10) && "Según el registro, la firma es anterior a la convocatoria",
      ]),
    });
  } else if (ganador?.nombre) {
    pasos.push({ clave: "firma", cuando: "Todavía no consta", titulo: "Sin contrato firmado en el registro", falta: true });
  }

  // La ejecución: sin fecha en el registro; sólo con señales de esa etapa o con la obra enlazada a INFOBRAS.
  if (objetivos.has("ejecucion") || hayObra) {
    pasos.push({
      clave: "ejecucion",
      cuando: "Después de la firma",
      titulo: hayObra ? "La ejecución de la obra" : "La ejecución",
      detalle: hayObra ? "Su avance y sus pagos en INFOBRAS están en la pestaña de la obra." : undefined,
    });
  }

  // El fin del plazo del contrato leído: vence o venció (hoy en Lima).
  const fin = typeof contrato?.fecha_fin === "string" && /^\d{4}-\d{2}-\d{2}/.test(contrato.fecha_fin) ? contrato.fecha_fin.slice(0, 10) : null;
  if (fin && fechaFirma) {
    pasos.push({
      clave: "plazo",
      fecha: fin,
      titulo: `${fin > hoyLima() ? "Vence" : "Venció"} el plazo ${varios ? "de ese contrato" : "del contrato"}`,
      detalle: contrato?.fecha_inicio ? `El plazo corre desde el ${fechaDossier(contrato.fecha_inicio, true)}, según el contrato.` : "Según el contrato.",
    });
  }

  // Cada señal, pegada a su paso (o al presente más cercano, si el suyo no consta).
  const presentes = new Set(pasos.filter((x) => !x.falta).map((x) => x.clave));
  const porPaso = senalesPorPaso(senales, presentes);
  return pasos.map((paso) => ({ ...paso, chips: porPaso.get(paso.clave) ?? [] }));
}
