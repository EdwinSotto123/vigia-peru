"use client";

import { useEffect, useState } from "react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Skeleton } from "@/components/ui/Skeleton";
import { Indicadores } from "@/components/listado";
import { baseApiNavegador } from "@/lib/api-client";
import { getCorrupcionRegion, rutaCorrupcion, type Corrupcion } from "@/lib/corrupcion";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
import { plural, porcentaje, solesCompacto } from "@/lib/formato";
import type { RegionBudgetSummary } from "@/lib/mef";
import { Banderas, BarrasGasto, BloqueInicio, Fichas, SinDato } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { ContenidoPersonas } from "./ContenidoPersonas";
import { PARAMS_SOLOS, type PaginaPersonas, type ResumenPersonas } from "@/lib/personas";

/**
 * Inicio de una región en el mapa (pestaña "Inicio" del panel de zona): en qué gasta (MEF), sus contratos y las
 * banderas levantadas, con los mismos bloques que la entidad y el partido. Se pide desde el navegador (el panel ya es
 * de cliente); `undefined` = cargando, `null` = el servicio no respondió (se dice, sin inventar ceros).
 */
export function InicioRegion({
  ubigeo,
  nombre,
  mefDept,
}: {
  ubigeo: string;
  nombre: string;
  /** Departamento como lo nombra el MEF ("PUNO"); sin él no hay presupuesto (provincias y distritos). */
  mefDept: string | null;
}) {
  const [mef, setMef] = useState<RegionBudgetSummary | null | undefined>(mefDept ? undefined : null);
  const [resumen, setResumen] = useState<ResumenContratos | null | undefined>(undefined);
  const [corrupcion, setCorrupcion] = useState<Corrupcion | null | undefined>(undefined);
  const [personas, setPersonas] = useState<ResumenPersonas | null | undefined>(undefined);
  const dep = ubigeo.length === 2 ? ubigeo : null;

  useEffect(() => {
    if (!dep) return;
    let vivo = true;
    setPersonas(undefined);
    fetch(`${baseApiNavegador()}/personas?dep=${dep}&size=0`)
      .then((r) => (r.ok ? (r.json() as Promise<PaginaPersonas>) : null))
      .then((d) => vivo && setPersonas(d?.resumen ?? null))
      .catch(() => vivo && setPersonas(null));
    return () => { vivo = false; };
  }, [dep]);

  useEffect(() => {
    let vivo = true;
    setCorrupcion(undefined);
    getCorrupcionRegion(ubigeo).then((d) => vivo && setCorrupcion(d));
    return () => { vivo = false; };
  }, [ubigeo]);

  useEffect(() => {
    if (!mefDept) return;
    let vivo = true;
    fetch(`/api/mef/region/${encodeURIComponent(mefDept)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && setMef(d))
      .catch(() => vivo && setMef(null));
    return () => { vivo = false; };
  }, [mefDept]);

  useEffect(() => {
    let vivo = true;
    setResumen(undefined);
    fetch(`${baseApiNavegador()}/contratos/resumen?ubigeo=${encodeURIComponent(ubigeo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && setResumen(d))
      .catch(() => vivo && setResumen(null));
    return () => { vivo = false; };
  }, [ubigeo]);

  const contratos = (f: Record<string, string> = {}) => `/app/contratos?${new URLSearchParams({ ubigeo, ...f })}`;
  const anio = mef?.byYear?.length ? mef.byYear[mef.byYear.length - 1] : null;
  const cargando = <Skeleton className="h-32 rounded-xl" />;

  const l = resumen?.porLectura;
  const datos: DatoClave[] = resumen
    ? [
        { etiqueta: "Desde 2015", valor: plural(resumen.total, "contrato", "contratos") },
        {
          etiqueta: "Por tipo",
          valor: <Fichas items={TIPOS.map((t) => ({ etiqueta: t.label, n: resumen.porTipo[t.value] ?? 0, href: contratos({ tipo: t.value }) }))} />,
        },
        {
          etiqueta: "¿Lo leyó Vigía?",
          valor: l ? (
            <Fichas
              items={[
                { etiqueta: "Leídos", n: (l.publicado ?? 0) + (l.revision ?? 0), href: contratos({ lectura: "publicado" }), destacada: true },
                { etiqueta: "Leyéndose", n: l.leyendo ?? 0, href: contratos({ lectura: "leyendo" }) },
                { etiqueta: "Aún no", n: l.sin_leer ?? 0, href: contratos({ lectura: "sin_leer" }) },
              ]}
            />
          ) : null,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <BloqueInicio
        titulo={anio ? `En qué gasta ${nombre} (${anio.year})` : `En qué gasta ${nombre}`}
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            Del MEF: el presupuesto modificado (PIM) de todas las entidades del departamento, por tipo de gasto, y la parte
            ya gastada (devengado).
          </Ayuda>
        }
      >
        {mef === undefined ? (
          cargando
        ) : mef && anio && (mef.topGenericas?.length ?? 0) > 0 ? (
          <div className="space-y-4">
            <Indicadores
              apilado
              items={[
                { valor: solesCompacto(anio.pim), etiqueta: "de presupuesto" },
                { valor: porcentaje(anio.pim > 0 ? (anio.devengado / anio.pim) * 100 : 0), etiqueta: "ya gastado", contexto: solesCompacto(anio.devengado) },
              ]}
            />
            <BarrasGasto rubros={mef.topGenericas!} total={anio.pim} />
          </div>
        ) : (
          <SinDato>{mefDept ? "Sin dato del MEF: el servicio no respondió." : "El MEF publica el presupuesto por departamento."}</SinDato>
        )}
      </BloqueInicio>

      <BloqueInicio titulo="Sus contratos" enlace={{ href: contratos(), texto: "Ver los contratos" }}>
        {resumen === undefined ? cargando : resumen ? <DatosClave items={datos} /> : <SinDato>Sin dato: el servicio de contratos no respondió.</SinDato>}
      </BloqueInicio>

      <BloqueInicio
        titulo="Banderas levantadas"
        ayuda={
          <Ayuda titulo="¿Qué es una bandera?">
            El riesgo que encontró Vigía al leer un contrato y los antecedentes de quien lo ganó. Son motivos para revisar,
            no prueban una irregularidad. Cada fila abre esos contratos.
          </Ayuda>
        }
        enlace={{ href: contratos({ cruces: "con" }), texto: "Contratos con antecedentes" }}
      >
        {resumen === undefined ? cargando : <Banderas porRiesgo={resumen?.porRiesgo} porCruces={resumen?.porCruces} href={contratos} />}
      </BloqueInicio>

      {dep && (
        <BloqueInicio
          titulo="Personas contratadas"
          ayuda={
            <Ayuda titulo="¿Quiénes son?">
              Las personas a las que las entidades de {nombre} pagaron por órdenes de servicio (OECE), con lo que otros registros
              públicos dicen de cada una. Una señal no prueba nada.
            </Ayuda>
          }
          enlace={{ href: `/app/personas?dep=${dep}`, texto: "Ver a las personas" }}
        >
          {personas === undefined ? cargando : (
            <ContenidoPersonas r={personas} P={PARAMS_SOLOS} href={(f) => `/app/personas?${new URLSearchParams({ dep, ...f })}`} />
          )}
        </BloqueInicio>
      )}

      <CasosCorrupcion datos={corrupcion} ruta={rutaCorrupcion.region(ubigeo)} ambito="region" nombreRegion={nombre} />
    </div>
  );
}
