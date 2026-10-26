"use client";

import { useMemo } from "react";
import { CabeceraPestana, Nota } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable, type FiltroLocal, type OrdenLocal } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { TIPO_CRUCE } from "@/lib/cruces";
import { numero, solesCompacto } from "@/lib/formato";
import { indiciosDe, nivelTxt, TIPOS_CAPTURA } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import type { PoderEntidad } from "@/lib/poder";
import { AyudaIndicios, ChipsIndicio } from "./indicios";
import { detalleEntidad, lugarDe, type EntidadPoderLigera } from "./DetalleEntidad";
import { EstadoCarga, usePoder } from "./vista";

/**
 * Las entidades con contratos con indicio, de cualquier partido (/app/poder, pestaña «Entidades»): la lista completa,
 * con buscador (entidad, partido, autoridad, lugar), filtros y orden; cada fila abre su panel. Antes eran las 15
 * primeras, sin «ver todas», bajo el título «Entidades más capturadas», que afirmaba como hecho lo que es un indicio.
 */

const COLUMNAS: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "contratos", titulo: "Contratos con indicio", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Contratos" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  { clave: "indicios", titulo: "Indicios, en contratos", ancho: "minmax(0,1.1fr)", desde: "xl", ayuda: <AyudaIndicios /> },
];

const ORDENES: OrdenLocal[] = [
  { valor: "contratos", etiqueta: "Más contratos con indicio", clave: "contratos", dir: "desc" },
  { valor: "monto", etiqueta: "Más monto con indicio", clave: "monto", dir: "desc" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z", clave: "nombre", dir: "asc" },
];

/** Una fila del mapa de poder como la entidad del panel. */
export const entidadLigera = (e: PoderEntidad): EntidadPoderLigera => ({
  ruc: e.entidad_ruc,
  nombre: e.entidad,
  nivel: e.nivel,
  departamento: e.departamento,
  provincia: e.provincia,
  distrito: e.distrito,
  partido: e.partido,
  autoridad: e.autoridad,
  cargo_gob: e.cargo_gob,
  periodoInicio: e.periodoInicio,
  periodoFin: e.periodoFin,
  n_captura: e.n_captura ?? 0,
  monto_captura: e.monto_captura ?? 0,
  n_financiaron: e.n_financiaron,
  n_vendieron: e.n_vendieron,
  n_socio: e.n_socio,
  n_empresas: e.n_empresas,
});

export function EntidadesPoder({ total }: { total: number }) {
  const carga = usePoder<{ data: PoderEntidad[] }>("/poder/entidades");
  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={<AyudaIndicios titulo="¿Qué cuenta «con indicio»?" />}>
        Las alcaldías y gobiernos regionales con más contratos ganados por empresas ligadas al partido que las gobierna.
      </CabeceraPestana>
      <EstadoCarga carga={carga} columnas={COLUMNAS}>
        {(d) => <Lista entidades={d.data ?? []} total={total} />}
      </EstadoCarga>
    </div>
  );
}

function Lista({ entidades, total }: { entidades: PoderEntidad[]; total: number }) {
  const filas = useMemo(() => entidades.map(fila), [entidades]);
  const filtros = useMemo<FiltroLocal[]>(() => {
    const unicos = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "es"));
    return [
      { clave: "departamento", etiqueta: "Departamento", corta: "Departamento", opciones: unicos(entidades.map((e) => e.departamento)).map((d) => ({ valor: d, etiqueta: tituloNatural(d) })) },
      { clave: "nivel", etiqueta: "Nivel de gobierno", corta: "Nivel", opciones: ["regional", "provincial", "distrital"].map((n) => ({ valor: n, etiqueta: nivelTxt(n) })) },
      { clave: "partido", etiqueta: "Partido que la gobierna", corta: "Partido", opciones: unicos(entidades.map((e) => e.partido)).map((p) => ({ valor: p, etiqueta: tituloNatural(p) })) },
      { clave: "tipo", etiqueta: "Tipo de indicio", corta: "Tipo de indicio", opciones: TIPOS_CAPTURA.map((t) => ({ valor: t.tipo, etiqueta: TIPO_CRUCE[t.tipo]?.corto ?? t.tipo })) },
    ];
  }, [entidades]);
  return (
    <div className="space-y-3">
      {/* Una API que todavía corta la lista: se dice cuántas faltan, no se presenta como la lista entera. */}
      {total > entidades.length && (
        <Nota>
          Se ven las {numero(entidades.length)} con más contratos con indicio, de {numero(total)}. Las demás están en la página de
          cada partido y en la pestaña Territorio.
        </Nota>
      )}
      <TablaFiltrable
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Entidades con contratos con indicio"
        nombre="entidades"
        tam={25}
        densidad="compacta"
        buscar={{ placeholder: "Buscar una entidad, partido, autoridad o lugar…", etiqueta: "Buscar una entidad" }}
        filtros={filtros}
        ordenes={ORDENES}
      />
    </div>
  );
}

function fila(e: PoderEntidad): FilaFiltrable {
  const nombre = tituloNatural(e.entidad);
  const lugar = lugarDe(e);
  return {
    id: e.entidad_ruc,
    // Autoridad electa: se busca y se muestra completa (docs/PRIVACIDAD.md).
    buscable: [e.entidad, e.partido, e.autoridad, e.departamento, e.provincia, e.distrito].filter(Boolean).join(" "),
    valores: { departamento: e.departamento, nivel: e.nivel, partido: e.partido, tipo: indiciosDe(e).map((i) => i.tipo) },
    claves: { contratos: e.n_captura, monto: e.monto_captura, nombre },
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={nombre}
          meta={[
            lugar && <Dato key="l" tipo="lugar">{lugar}</Dato>,
            <Dato key="p" tipo="partido">{tituloNatural(e.partido)}</Dato>,
          ]}
        />
      ),
      contratos: <CeldaNumero>{numero(e.n_captura)}</CeldaNumero>,
      monto: <CeldaNumero>{solesCompacto(e.monto_captura)}</CeldaNumero>,
      indicios: <ChipsIndicio x={e} />,
    },
    detalle: detalleEntidad(entidadLigera(e)),
  };
}
