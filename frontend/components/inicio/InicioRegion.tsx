"use client";

import { useEffect, useState } from "react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Skeleton } from "@/components/ui/Skeleton";
import { baseApiNavegador } from "@/lib/api-client";
import { getCorrupcionRegion, type Corrupcion } from "@/lib/corrupcion";
import { TIPOS, type ResumenContratos } from "@/lib/contratos";
import { numero, plural, solesCompacto } from "@/lib/formato";
import type { RegionBudgetSummary } from "@/lib/mef";
import { Banderas, BarrasGasto, BloqueInicio, SinDato } from "./BloquesInicio";
import { CasosCorrupcion } from "./CasosCorrupcion";

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
          valor: TIPOS.map((t) => [t.label, resumen.porTipo[t.value] ?? 0] as const).filter(([, n]) => n > 0).map(([e, n]) => `${e} ${numero(n)}`).join(" · ") || null,
        },
        {
          etiqueta: "¿Lo leyó Vigía?",
          valor: l ? `${numero((l.publicado ?? 0) + (l.revision ?? 0))} leídos · ${numero(l.leyendo ?? 0)} leyéndose · ${numero(l.sin_leer ?? 0)} aún no` : null,
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
          <>
            <p className="mb-3 text-[13.5px] text-inkSoft">
              {solesCompacto(anio.pim)} de presupuesto, {solesCompacto(anio.devengado)} ya gastado.
            </p>
            <BarrasGasto rubros={mef.topGenericas!} total={anio.pim} />
          </>
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

      <CasosCorrupcion datos={corrupcion} ambito="region" nombreRegion={nombre} mostrarEntidad visibles={4} />
    </div>
  );
}
