"use client";

/**
 * Pestaña «Proveedor y red» del informe, cargada con `next/dynamic` al abrirla (PanelesDossier). Cuenta una historia en
 * vez de apilar bloques (pedido del usuario del 2026-11-05: «veo que solo apilamos y demás sin dar orden o contar una
 * historia»):
 *
 *   En una frase   quién es, cuánto le ganó al Estado y a esta entidad, qué pesa sobre él y lo más fuerte de su red.
 *   1. Quién es                   lo que dicen los registros (SUNAT, RNP, OECE, CONOSCE), con enlace a su ficha.
 *   2. Con quién está vinculado   lo que encontró la red, la red en carriles y, a pedido, cada persona y empresa, quién
 *                                 firma en la entidad y la política de cada persona.
 *   3. Contra quién compitió      cada postor y qué pasó con su oferta, en una tabla.
 *   4. Otros contratos            lo que ganó antes, en una tabla con su enlace.
 *   Al final, plegado: lo que escribió el agente (su lectura; lo de arriba sale de los registros).
 *
 * Con el padrón SUNAT en la base, la «falta de información SUNAT» que el agente dejaba como señal no se muestra.
 */

import Link from "next/link";
import { Building2, Landmark, Vote } from "lucide-react";
import { Capitulo, IndiceRelato } from "@/components/patrones";
import { rutaEmpresa } from "@/lib/empresas";
import { setRedactNames } from "../../Redact";
import { montoDossier } from "../dossier";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { EmpresaAdjudicaCard } from "./EmpresaAdjudicaCard";
import { FichaProveedor } from "./FichaProveedor";
import { OtrosContratosSection } from "./OtrosContratosSection";
import { EstructuraEntidadSection } from "./EstructuraEntidadSection";
import { AnalisisPostoresSection } from "./AnalisisPostoresSection";
import { PersonNetworkSection } from "./PersonNetworkSection";
import { PersonaVinculacionesPanel, personasConHallazgo } from "./PersonaVinculacionesPanel";
import { RedProveedor } from "./RedProveedor";
import { buildRelationshipGraphData } from "./RelationshipGraph.layout";
import { SeccionSegura } from "./SeccionSegura";
import { FraseProveedor } from "./red/FraseProveedor";
import { LoQueEscribioElAgente } from "./red/LoQueEscribioElAgente";
import { Pliegue } from "./red/Pliegue";
import { filasCompetencia, filasOtrosContratos, haySunat, hechosProveedor, vinculoMasFuerte } from "./red/proveedor";

export function PanelProveedor({ result, conv, ganador, banderasArr, nombresPrivados }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const r = result as any;
  const exp = r.expediente_proveedor ?? null;
  const web = result.web_research ?? null;
  const person = result.person_network ?? null;
  const ctx = r.person_network_context;
  const ep = r.entity_personnel;
  const ocid: string | null = result.ocid ?? conv?.ocid ?? null;
  const entidad = r.entidad ?? conv?.entidad;
  const entidadRuc: string | null = r.entidad_ruc ?? (typeof conv?.entidad === "object" ? conv?.entidad?.ruc : null) ?? conv?.entidad_ruc ?? ctx?.entidad_contratante?.ruc ?? null;

  const sunatEnBase = haySunat(exp, web?.empresa);
  const hechos = hechosProveedor(result, ganador);
  const vinculo = vinculoMasFuerte(result, sunatEnBase);
  const ciiuNoCoincide = (banderasArr ?? []).some((b) => String(b?.regla ?? "") === "ciiu_vs_objeto");

  const hayEstructura = (ctx?.autoridades_entidad?.n_autoridades_encontradas || 0) > 0 || (ep?.funcionarios_designados?.length || 0) > 0;
  const nPolitica = ctx?.datos_peru_por_persona ? personasConHallazgo(ctx).length : 0;
  // Sin la red de personas, el grafo se arma igual con el contexto (la entidad, sus funcionarios, los postores rivales).
  const grafoSinPersona = !person && ctx ? buildRelationshipGraphData(null, web, ganador, ctx) : null;
  const hayRed = !!person || !!grafoSinPersona || hayEstructura || !!ctx?.datos_peru_por_persona;
  const competencia = filasCompetencia(result, ocid);
  const otros = filasOtrosContratos(result, ocid, entidadRuc);
  const hayQuien = !!exp || !!web?.empresa;
  // Sin expediente ni agente web no se consultó ningún historial: «no se encontraron otros contratos» sería falso.
  const hayHistorial = !!exp || !!web;
  const rucProveedor: string | null = hechos?.ruc ?? ganador?.ruc ?? null;
  const ruc20 = !!rucProveedor && /^20\d{9}$/.test(rucProveedor);

  const capitulos = [
    hayQuien && { id: "proveedor-quien", titulo: "Quién es" },
    hayRed && { id: "proveedor-red", titulo: "Con quién está vinculado" },
    competencia.filas.length > 0 && { id: "proveedor-competencia", titulo: "Contra quién compitió" },
    hayHistorial && { id: "proveedor-contratos", titulo: "Otros contratos" },
  ].filter(Boolean) as { id: string; titulo: string }[];
  const n = (id: string) => capitulos.findIndex((c) => c.id === id) + 1;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {hechos && (
          <SeccionSegura nombre="el resumen del proveedor">
            <FraseProveedor h={hechos} vinculo={vinculo} redCorrio={!!person} ciiuNoCoincide={ciiuNoCoincide} desdeRegistros={!!exp} />
          </SeccionSegura>
        )}
        {!web && !person && !exp && (
          <AvisoSeccion titulo="La investigación del proveedor no corrió en este análisis" icono={<Building2 size={16} aria-hidden />}>
            {result.web_research_raw || result.person_network_raw ? "Respondió, pero su resultado no se pudo leer. " : ""}
            Lo que aparece abajo sale de los registros públicos que sí se consultaron.
          </AvisoSeccion>
        )}
        <IndiceRelato capitulos={capitulos} />
      </div>

      {hayQuien && (
        <Capitulo n={n("proveedor-quien")} id="proveedor-quien" titulo="Quién es" bajada="Lo que dicen los registros públicos: el padrón de la SUNAT, el RNP, el OECE y el CONOSCE.">
          <SeccionSegura nombre="la ficha del proveedor">
            {exp ? (
              <FichaProveedor exp={exp} nombre={ganador?.nombre ?? web?.empresa?.razon_social} entidadRuc={entidadRuc} />
            ) : (
              <EmpresaAdjudicaCard empresa={web.empresa} />
            )}
          </SeccionSegura>
        </Capitulo>
      )}

      {hayRed && (
        <Capitulo
          n={n("proveedor-red")}
          id="proveedor-red"
          titulo="Con quién está vinculado"
          bajada="Las personas detrás del proveedor, sus otras empresas y lo que las une con la entidad y con los otros postores."
        >
          <div className="space-y-4">
            <SeccionSegura nombre="la red de personas">
              {person ? (
                <PersonNetworkSection person={person} web={web} proveedor={ganador} ctx={ctx} sunatEnBase={sunatEnBase} />
              ) : grafoSinPersona ? (
                <RedProveedor person={null} web={web} proveedor={ganador} ctx={ctx} />
              ) : null}
            </SeccionSegura>
            {hayEstructura && (
              <Pliegue
                titulo="Quién dirige y firma en la entidad"
                icono={<Landmark size={16} />}
                detalle="Las autoridades electas (JNE) y los funcionarios de confianza designados en el período actual."
              >
                <SeccionSegura nombre="la estructura de la entidad">
                  <EstructuraEntidadSection autoridades={ctx?.autoridades_entidad} entityPersonnel={ep} entidad={entidad} />
                </SeccionSegura>
              </Pliegue>
            )}
            {ctx?.datos_peru_por_persona && (
              <Pliegue
                titulo="Aportes, candidaturas y visitas de cada persona"
                icono={<Vote size={16} />}
                cuenta={nPolitica}
                detalle="El titular, sus socios, quienes firmaron el acta y el comité, cruzados con la ONPE, el JNE, las personas expuestas políticamente y el registro de visitas."
              >
                <SeccionSegura nombre="las vinculaciones políticas">
                  <PersonaVinculacionesPanel ctx={ctx} />
                </SeccionSegura>
              </Pliegue>
            )}
          </div>
        </Capitulo>
      )}

      {competencia.filas.length > 0 && (
        <Capitulo
          n={n("proveedor-competencia")}
          id="proveedor-competencia"
          titulo="Contra quién compitió"
          bajada={
            competencia.conActa
              ? "Cada postor y qué pasó con su oferta, según el acta de buena pro que leyó Vigía, con sus patrones de competencia."
              : "Los postores del registro OCDS y sus patrones de competencia. El acta de este proceso todavía no se leyó: no se sabe quién ofertó."
          }
        >
          <SeccionSegura nombre="el análisis de competencia">
            <AnalisisPostoresSection
              data={result.analisis_postores}
              ocidActual={ocid}
              filas={competencia.filas}
              conActa={competencia.conActa}
              valorReferencial={competencia.valorReferencial}
            />
          </SeccionSegura>
        </Capitulo>
      )}

      {hayHistorial && (
        <Capitulo
          n={n("proveedor-contratos")}
          id="proveedor-contratos"
          titulo="Otros contratos"
          bajada={
            ruc20 ? (
              <>
                Lo que ganó antes en el Estado, según el CONOSCE (los más recientes).{" "}
                <Link href={rutaEmpresa(rucProveedor!, "ventas")} prefetch={false} className="font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                  Todas sus ventas al Estado, en su ficha
                </Link>
              </>
            ) : (
              "Lo que ganó antes en el Estado, según el CONOSCE y lo que encontró el agente en la web."
            )
          }
        >
          <SeccionSegura nombre="los otros contratos">
            <OtrosContratosSection filas={otros} relacion={web?.relacion_proveedor_entidad} fmtMoney={montoDossier} />
          </SeccionSegura>
        </Capitulo>
      )}

      <SeccionSegura nombre="lo que escribió el agente">
        <LoQueEscribioElAgente web={web} person={person} sunatEnBase={sunatEnBase} />
      </SeccionSegura>
    </div>
  );
}
