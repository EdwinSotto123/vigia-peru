"use client";

import { useEffect, useState } from "react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave } from "@/components/patrones/Detalle";
import { Skeleton } from "@/components/ui/Skeleton";
import { baseApiNavegador } from "@/lib/api-client";
import { getCorrupcionRegion, rutaCorrupcion, type Corrupcion } from "@/lib/corrupcion";
import type { ResumenContratos } from "@/lib/contratos";
import type { RegionBudgetSummary } from "@/lib/mef";
import { Banderas, BloqueInicio, RejillaInicio, SinDato } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";
import { ContenidoPersonas } from "./ContenidoPersonas";
import { PARAMS_SOLOS, type PaginaPersonas, type ResumenPersonas } from "@/lib/personas";
import { GastoRegion, anioConGasto, datosContratosRegion } from "@/components/regiones/bloquesRegion";

/**
 * Inicio de una zona en el mapa (pestaña "Inicio" del panel de zona): en qué gasta (MEF), sus contratos y las banderas
 * levantadas, con las mismas piezas que la ficha de la región (components/regiones/bloquesRegion.tsx). Se pide desde el
 * navegador porque el panel ya es de cliente; la ficha /region/[id] arma el suyo en el servidor (InicioRegionFicha).
 *
 * `undefined` = cargando: un esqueleto con la forma del bloque. `null` = el servicio no respondió: se dice, sin inventar
 * ceros. Antes «Casos de corrupción» se pintaba «Cargando…» en la misma caja gris de «sin dato».
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
  const anio = anioConGasto(mef);
  // La espera, con la forma de lo que viene (nunca el «Sin dato» gris mientras tanto).
  const cargando = <Skeleton className="h-32 rounded-xl" />;
  const l = resumen?.porLectura;
  const leidos = (l?.publicado ?? 0) + (l?.revision ?? 0);

  return (
    <RejillaInicio>
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
        ) : mef && anio ? (
          <GastoRegion mef={mef} />
        ) : (
          <SinDato>{mefDept ? "Sin dato del MEF: el servicio no respondió." : "El MEF publica el presupuesto por departamento."}</SinDato>
        )}
      </BloqueInicio>

      <BloqueInicio titulo="Sus contratos" enlace={{ href: contratos(), texto: "Ver los contratos" }}>
        {resumen === undefined ? cargando : resumen ? <DatosClave items={datosContratosRegion(resumen, contratos)} /> : <SinDato>Sin dato: el servicio de contratos no respondió.</SinDato>}
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
        {resumen === undefined ? cargando : <Banderas porRiesgo={resumen?.porRiesgo} porCruces={resumen?.porCruces} href={contratos} conRiesgo={leidos > 0} />}
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

      {corrupcion === undefined ? (
        <BloqueInicio ancho titulo="Casos de corrupción">
          <div className="space-y-3" aria-hidden>
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </BloqueInicio>
      ) : (
        <CasosCorrupcion datos={corrupcion} ruta={rutaCorrupcion.region(ubigeo)} ambito="region" nombreRegion={nombre} />
      )}
    </RejillaInicio>
  );
}
