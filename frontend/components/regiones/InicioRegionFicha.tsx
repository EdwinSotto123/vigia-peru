import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave } from "@/components/patrones/Detalle";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banderas, BloqueInicio, LineasSinDato, SubseccionInicio } from "@/components/inicio/BloquesInicio";
import { CasosCorrupcion } from "@/components/inicio/CasosCorrupcion";
import { ContenidoPersonas } from "@/components/inicio/ContenidoPersonas";
import { getResumenContratos } from "@/lib/contratos";
import { getCorrupcionRegion, rutaCorrupcion } from "@/lib/corrupcion";
import { getRegionBudget } from "@/lib/mef-cache";
import { PARAMS_SOLOS, getPersonas } from "@/lib/personas";
import type { Region } from "@/lib/regiones";
import { GastoRegion, anioConGasto, datosContratosRegion } from "./bloquesRegion";

/**
 * El Inicio de la ficha de una región (/region/[id], primera pestaña), armado en el SERVIDOR con los mismos endpoints que
 * antes pedía el navegador uno por uno (MEF, resumen de contratos, Contraloría y Procuraduría, personas): llega entero,
 * sin «Cargando…» pintado igual que «sin dato». Con el orden de las demás fichas (entidad, partido): qué se encontró →
 * dinero → control, y lo que no tiene dato al final, en una línea cada uno.
 *
 * Los enlaces de contratos van a la pestaña Contratos de esta misma ficha (antes sacaban a /app/contratos?ubigeo=).
 * El panel de zona del mapa sigue con su versión de cliente (components/inicio/InicioRegion.tsx): comparten las piezas.
 */
export async function InicioRegionFicha({ r, ruta }: { r: Region; ruta: string }) {
  const dep = r.ubigeo;
  const [mef, resumen, corrupcion, personas] = await Promise.all([
    r.mefDept ? getRegionBudget(r.mefDept).catch(() => null) : Promise.resolve(null),
    getResumenContratos({ ubigeo: r.ubigeo }),
    getCorrupcionRegion(r.ubigeo),
    getPersonas({ dep, size: 0 }),
  ]);
  const contratos = (f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion: "contratos", ...f })}`;
  const enPersonas = (f: Record<string, string> = {}) => `/app/personas?${new URLSearchParams({ dep, ...f })}`;
  const l = resumen?.porLectura;
  const leidos = (l?.publicado ?? 0) + (l?.revision ?? 0);
  const gasto = mef && anioConGasto(mef) ? mef : null;
  const p = personas?.resumen ?? null;

  const sinDato: { titulo: string; motivo: string }[] = [];
  if (!gasto) sinDato.push({ titulo: "En qué gasta", motivo: r.mefDept ? "Sin dato: el MEF no respondió o no trae su reparto por tipo de gasto." : "Sin dato del MEF para esta región." });
  if (!resumen) sinDato.push({ titulo: "Sus contratos", motivo: "Sin dato: el servicio de contratos no respondió." });
  if (!p) sinDato.push({ titulo: "Personas contratadas", motivo: "Sin dato: el servicio de personas no respondió." });
  else if (!p.filas) sinDato.push({ titulo: "Personas contratadas", motivo: "Sus entidades no registran órdenes de servicio a personas." });

  // Qué se encontró: las banderas de sus contratos y las de las personas que contratan sus entidades.
  const hallazgos = [
    resumen && (
      <BloqueInicio key="contratos" nivel={3} titulo="En sus contratos" enlace={{ href: contratos({ cruces: "con" }), texto: "Ver los que tienen antecedentes" }}>
        <Banderas porRiesgo={resumen.porRiesgo} porCruces={resumen.porCruces} href={contratos} conRiesgo={leidos > 0} />
      </BloqueInicio>
    ),
    p && p.filas > 0 && (
      <BloqueInicio
        key="personas"
        nivel={3}
        titulo="En las personas contratadas"
        ayuda={
          <Ayuda titulo="¿Quiénes son?">
            Las personas a las que las entidades de {r.nombre} pagaron por órdenes de servicio (OECE), con lo que otros registros
            públicos dicen de cada una. Una señal no prueba nada.
          </Ayuda>
        }
        enlace={{ href: enPersonas(), texto: "Ver a las personas" }}
      >
        <ContenidoPersonas r={p} P={PARAMS_SOLOS} href={enPersonas} />
      </BloqueInicio>
    ),
  ].filter(Boolean);

  // Dinero: en qué gasta (MEF) y sus contratos, lado a lado desde lg.
  const dinero = [
    gasto && (
      <BloqueInicio
        key="gasto"
        nivel={3}
        titulo="En qué gasta"
        ayuda={
          <Ayuda titulo="¿De dónde sale?">
            Del MEF: el presupuesto modificado (PIM) de todas las entidades del departamento, por tipo de gasto, y la parte ya
            gastada (devengado).
          </Ayuda>
        }
      >
        <GastoRegion mef={gasto} />
      </BloqueInicio>
    ),
    resumen && (
      <BloqueInicio key="contratos" nivel={3} titulo="Sus contratos" enlace={{ href: contratos(), texto: "Ver los contratos" }}>
        <DatosClave items={datosContratosRegion(resumen, contratos)} />
      </BloqueInicio>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-10">
      {hallazgos.length > 0 && (
        <SubseccionInicio
          titulo="Qué se encontró"
          descripcion={`Cruces de datos públicos en los contratos de ${r.nombre} y en las personas que contratan sus entidades: indicios para revisar, no acusaciones.`}
          ayuda={
            <Ayuda titulo="¿Qué es una bandera?">
              <span className="block">
                El riesgo que encontró Vigía al leer un contrato y lo que otros registros públicos dicen de quien lo ganó (o de
                quien recibió una orden): sanciones, aportes de campaña, socios, parientes declarados…
              </span>
              <span className="mt-2 block">Cada fila abre esos contratos o esas personas, ya filtrados, con la evidencia de cada uno.</span>
            </Ayuda>
          }
        >
          {hallazgos}
        </SubseccionInicio>
      )}

      {dinero.length > 0 && (
        <SubseccionInicio titulo="Dinero" descripcion={`En qué gasta ${r.nombre} según el MEF y lo que contratan sus entidades.`}>
          <div className="grid items-start gap-4 lg:grid-cols-2">{dinero}</div>
        </SubseccionInicio>
      )}

      {/* Control: la Procuraduría (lo comprobado, por sede: casi siempre el departamento) y la Contraloría. */}
      <CasosCorrupcion datos={corrupcion} ruta={rutaCorrupcion.region(r.ubigeo)} ambito="region" nombreRegion={r.nombre} />

      <LineasSinDato items={sinDato} />
    </div>
  );
}

/** La espera del Inicio: la forma de sus dos subsecciones (nunca «Cargando…» con la cara de «sin dato»). */
export function InicioRegionEsqueleto() {
  return (
    <div className="space-y-10" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
