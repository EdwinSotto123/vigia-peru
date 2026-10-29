"use client";

import { useMemo } from "react";
import { Building2, Landmark, Map as MapaIcono, Network, Vote } from "lucide-react";
import { Ayuda, BloqueDetalle, CabeceraPestana, CuerpoDetalle, DatosClave, PieDetalle, Pestanas } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type FiltroLocal, type OrdenLocal } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AyudaIndicios, CeldaTasa, ChipsIndicio, ListaIndicios } from "@/components/grafo/indicios";
import { EntidadesPoder } from "@/components/grafo/EntidadesPoder";
import { ExploradorTerritorio } from "./ExploradorTerritorio";
import { ExploradorDependencia } from "./ExploradorDependencia";
import { MapaInstituciones } from "./MapaInstituciones";
import { TIPO_CRUCE } from "@/lib/cruces";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { indiciosDe, parte, TIPOS_CAPTURA, VISTAS_PODER } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import { clavePartido, type PoderPartido } from "@/lib/poder";

/**
 * Las vistas del mapa de poder (/app/poder) en las pestañas del kit: la elegida va a la URL (`?vista=`), responden a
 * las flechas del teclado, se deslizan en una fila en el celular y cada una se monta (y pide sus datos) la primera vez
 * que se abre. Antes eran botones propios que montaban las cuatro vistas a la vez y obligaban al servidor a hacer cinco
 * consultas aunque nadie abriera los árboles.
 *
 *   Partidos           el ranking, por la PARTE de sus entidades con contratos con indicio (no por tamaño)
 *   Entidades          los municipios y gobiernos regionales con más contratos con indicio, de cualquier partido
 *   Territorio         región → provincia → distrito, con los totales en cada fila
 *   Gobierno Nacional  sector → pliego → unidad ejecutora (presupuesto MEF), con los autónomos marcados
 *   Instituciones      las que más contratan de cada rama del Estado
 *
 * Recibe datos planos (la lista de partidos), nunca funciones: la página es un Server Component.
 */

export function PoderVista({ partidos, activa, entidadesConIndicio }: { partidos: PoderPartido[]; activa?: string; entidadesConIndicio: number }) {
  return (
    <Pestanas
      param="vista"
      activa={activa}
      etiqueta="Vistas del mapa de poder"
      pestanas={[
        { clave: "partidos", etiqueta: VISTAS_PODER.partidos, conteo: partidos.length, icono: <Vote size={15} aria-hidden />, contenido: <RankingPartidos partidos={partidos} /> },
        {
          clave: "entidades",
          etiqueta: VISTAS_PODER.entidades,
          // El h2 de la pestaña: «con más contratos con indicio», no «más capturadas» (que afirmaba como hecho un indicio).
          titulo: "Entidades con más contratos con indicio",
          conteo: entidadesConIndicio,
          icono: <Building2 size={15} aria-hidden />,
          contenido: <EntidadesPoder total={entidadesConIndicio} />,
        },
        { clave: "territorio", etiqueta: VISTAS_PODER.territorio, icono: <MapaIcono size={15} aria-hidden />, contenido: <ExploradorTerritorio /> },
        { clave: "nacional", etiqueta: VISTAS_PODER.nacional, icono: <Network size={15} aria-hidden />, contenido: <ExploradorDependencia /> },
        { clave: "instituciones", etiqueta: VISTAS_PODER.instituciones, icono: <Landmark size={15} aria-hidden />, contenido: <MapaInstituciones /> },
      ]}
    />
  );
}

// ─── Partidos ────────────────────────────────────────────────────────────────

/** Con menos entidades, un solo municipio mueve el porcentaje: esos partidos van al final del orden por porcentaje. */
const MINIMO_TASA = 5;

const COLUMNAS: Columna[] = [
  { clave: "partido", titulo: "Partido", ancho: "minmax(0,1.5fr)" },
  {
    clave: "tasa",
    titulo: "Entidades con indicio",
    ancho: "minmax(7.5rem,0.75fr)",
    ayuda: (
      <Ayuda titulo="¿Qué es «entidades con indicio»?">
        <span className="block">
          De las entidades que gobierna el partido (alcaldías y gobiernos regionales, periodo vigente, JNE), cuántas tienen al
          menos un contrato ganado por una empresa ligada a él.
        </span>
        <span className="mt-1.5 block">
          El orden por porcentaje deja al final a los partidos que gobiernan menos de {MINIMO_TASA} entidades: con una o dos,
          un solo municipio los lleva a 0 o a 100 %.
        </span>
      </Ayuda>
    ),
  },
  { clave: "contratos", titulo: "Contratos con indicio", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Contratos" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  // Debajo de xl, bajo el nombre (`apilar`): antes en el celular no se veía ningún indicio.
  { clave: "indicios", titulo: "Indicios, en contratos", ancho: "minmax(0,1.15fr)", desde: "xl", apilar: true, ayuda: <AyudaIndicios /> },
];

const FILTROS: FiltroLocal[] = [
  {
    clave: "tamano",
    etiqueta: "Cuántas entidades gobierna",
    corta: "Cuántas entidades gobierna",
    opciones: [
      { valor: "grande", etiqueta: "10 o más entidades" },
      { valor: "mediano", etiqueta: `De ${MINIMO_TASA} a 9 entidades` },
      { valor: "chico", etiqueta: `Menos de ${MINIMO_TASA} entidades` },
    ],
  },
  {
    clave: "tipo",
    etiqueta: "Tipo de indicio",
    corta: "Tipo de indicio",
    opciones: TIPOS_CAPTURA.map((t) => ({ valor: t.tipo, etiqueta: TIPO_CRUCE[t.tipo]?.corto ?? t.tipo })),
  },
];

const ORDENES: OrdenLocal[] = [
  { valor: "tasa", etiqueta: "Más entidades con indicio (%)", clave: "tasa", dir: "desc" },
  { valor: "contratos", etiqueta: "Más contratos con indicio", clave: "contratos", dir: "desc" },
  { valor: "monto", etiqueta: "Más monto con indicio", clave: "monto", dir: "desc" },
  { valor: "entidades", etiqueta: "Gobierna más entidades", clave: "entidades", dir: "desc" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z", clave: "nombre", dir: "asc" },
];

const tamanoDe = (n: number) => (n >= 10 ? "grande" : n >= MINIMO_TASA ? "mediano" : "chico");

function RankingPartidos({ partidos }: { partidos: PoderPartido[] }) {
  const filas = useMemo(
    () =>
      // El orden de base (el del porcentaje): los comparables primero, y a igual porcentaje el que gobierna más.
      [...partidos]
        .sort(
          (a, b) =>
            Number(b.n_entidades >= MINIMO_TASA) - Number(a.n_entidades >= MINIMO_TASA) ||
            parte(b.n_entidades_con_captura, b.n_entidades) - parte(a.n_entidades_con_captura, a.n_entidades) ||
            b.n_entidades - a.n_entidades ||
            b.n_captura - a.n_captura,
        )
        .map(filaPartido),
    [partidos],
  );
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Por qué este orden?">
            <span className="block">
              Por la parte de sus entidades con contratos con indicio: así se compara un partido que gobierna 300 entidades con
              uno que gobierna 10. Ordenarlos por cuántos contratos tienen sólo dice cuál gobierna más.
            </span>
            <span className="mt-1.5 block">
              Los que gobiernan menos de {MINIMO_TASA} entidades van al final de este orden. Puedes ordenar también por contratos,
              por monto o por nombre, y filtrar por cuántas entidades gobiernan.
            </span>
          </Ayuda>
        }
      >
        Qué parte de las entidades que gobierna cada partido tiene contratos ganados por empresas ligadas a él.
      </CabeceraPestana>
      <TablaFiltrable
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Partidos, por la parte de sus entidades con contratos con indicio"
        nombre="partidos"
        tam={25}
        densidad="compacta"
        buscar={{ placeholder: "Buscar un partido…", etiqueta: "Buscar un partido" }}
        filtros={FILTROS}
        ordenes={ORDENES}
      />
    </div>
  );
}

function filaPartido(p: PoderPartido): FilaFiltrable {
  const nombre = tituloNatural(p.partido);
  const con = p.n_entidades_con_captura;
  const de = p.n_entidades;
  const departamentos = plural(p.n_departamentos, "departamento", "departamentos");
  return {
    id: p.partido,
    buscable: `${p.partido} ${nombre}`,
    valores: { tamano: tamanoDe(de), tipo: indiciosDe(p).map((i) => i.tipo) },
    claves: {
      tasa: de >= MINIMO_TASA ? parte(con, de) : null,
      contratos: p.n_captura,
      monto: p.monto_captura,
      entidades: de,
      nombre,
    },
    celdas: {
      partido: <CeldaPrincipal titulo={nombre} meta={[<Dato key="d" tipo="lugar">{departamentos}</Dato>]} />,
      tasa: <CeldaTasa con={con} de={de} />,
      contratos: <CeldaNumero>{numero(p.n_captura)}</CeldaNumero>,
      monto: <CeldaNumero>{p.n_captura > 0 ? solesCompacto(p.monto_captura) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
      indicios: <ChipsIndicio x={p} />,
    },
    detalle: {
      titulo: nombre,
      etiqueta: `Ver el resumen de ${nombre}: ${numero(con)} de ${numero(de)} entidades con indicio`,
      descripcion: (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Dato tipo="entidad">{plural(de, "entidad que gobierna", "entidades que gobierna")}</Dato>
          <Dato tipo="lugar">{departamentos}</Dato>
        </span>
      ),
      contenido: (
        <CuerpoDetalle>
          <Indicadores
            apilado
            items={[
              { valor: `${numero(con)} de ${numero(de)}`, etiqueta: "entidades con indicio", contexto: `${porcentaje(parte(con, de) * 100)} de las que gobierna` },
              { valor: numero(p.n_captura), etiqueta: "contratos con indicio", contexto: p.n_captura > 0 ? `${solesCompacto(p.monto_captura)} en esos contratos` : "ninguno con estos cruces" },
            ]}
          />
          <DatosClave items={[{ etiqueta: "Empresas ligadas", valor: p.n_empresas > 0 ? `${numero(p.n_empresas)} distintas` : "Ninguna" }]} />
          <BloqueDetalle titulo="Indicios" ayuda={<AyudaIndicios />}>
            <ListaIndicios x={p} />
          </BloqueDetalle>
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <EnlaceAccion href={`/app/poder/${clavePartido(p.partido)}`} flecha prefetch={false}>
              Ver dónde gobierna
            </EnlaceAccion>
          }
        />
      ),
    },
  };
}
