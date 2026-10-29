"use client";

import { useCallback, useMemo, useState } from "react";
import { CeldaNumero, CeldaPrincipal, type Columna } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ArbolTabla, type NodoArbol } from "@/components/grafo/ArbolTabla";
import { BarraArbol, type FiltroArbol } from "@/components/grafo/BarraArbol";
import { detalleEntidad } from "@/components/grafo/DetalleEntidad";
import { entidadLigera } from "@/components/grafo/EntidadesPoder";
import { AyudaIndicios, CeldaTasa, ChipsIndicio } from "@/components/grafo/indicios";
import { TIPO_CRUCE } from "@/lib/cruces";
import { coincide, numero, paraBuscar, plural, solesCompacto } from "@/lib/formato";
import { indiciosDe, nivelTxt, sumarConteos, TIPOS_CAPTURA } from "@/lib/grafo";
import { tituloNatural } from "@/lib/landing";
import type { PoderEntidad } from "@/lib/poder";

/**
 * Dónde gobierna un partido (/app/poder/<partido>): sus entidades agrupadas por departamento. Cada departamento es una
 * fila con sus totales —cuántas de sus entidades tienen contratos con indicio («11 de 11»), cuántos contratos, el monto
 * y los indicios con su conteo— que se abre en el lugar; adentro, cada entidad con su autoridad y sus indicios, y su
 * panel con sus contratos con indicio. Con buscador (entidad, autoridad, lugar) y filtros (departamento, nivel, tipo de
 * indicio, con o sin indicio): se listan TODAS, también las que no tienen indicios.
 *
 * Antes era un radial que sólo contaba entidades por departamento, todo en granate: la captura aparecía recién al
 * tocar, con letra girada de ~9 px, y al abrir un departamento se cortaba en 28 sin avisar.
 */

const COLUMNAS: Columna[] = [
  { clave: "entidad", titulo: "Departamento o entidad", ancho: "minmax(0,1.7fr)" },
  { clave: "tasa", titulo: "Entidades con indicio", ancho: "minmax(8.5rem,0.7fr)", desde: "md", apilar: true },
  { clave: "contratos", titulo: "Contratos con indicio", ancho: "8.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Contratos" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der", desde: "lg", apilar: "con-rotulo" },
  // Debajo de xl, bajo el nombre (`apilar`): antes en el celular no se veía ningún indicio.
  { clave: "indicios", titulo: "Indicios, en contratos", ancho: "minmax(0,1fr)", desde: "xl", apilar: true, ayuda: <AyudaIndicios /> },
];

const conIndicio = (e: PoderEntidad) => (e.n_captura ?? 0) > 0;
const SIN_DEP = "Sin departamento";

/** El lugar dentro de su departamento (el grupo ya lo dice): "Pichari, La Convención". */
const lugarEnDep = (e: PoderEntidad) =>
  (e.nivel === "distrital" ? [e.distrito, e.provincia] : e.nivel === "provincial" ? [e.provincia] : [])
    .filter((x): x is string => !!x)
    .map((x) => tituloNatural(x))
    .join(", ");

export function GrafoPartidoRegiones({ partido, entidades }: { partido: string; entidades: PoderEntidad[] }) {
  const [consulta, setConsulta] = useState("");
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const onConsulta = useCallback((v: string) => setConsulta(v), []);
  const q = paraBuscar(consulta);

  // Lo que no cambia al filtrar: los departamentos con sus totales (de TODAS sus entidades) y el texto de búsqueda.
  const base = useMemo(() => {
    const texto = new Map(entidades.map((e) => [e.entidad_ruc, paraBuscar([e.entidad, e.autoridad, e.distrito, e.provincia, e.departamento].filter(Boolean).join(" "))]));
    const porDep = new Map<string, PoderEntidad[]>();
    for (const e of entidades) {
      const d = e.departamento || SIN_DEP;
      const arr = porDep.get(d) ?? [];
      arr.push(e);
      porDep.set(d, arr);
    }
    const deps = [...porDep.entries()]
      .map(([dep, ents]) => ({
        dep,
        ents: [...ents].sort((a, b) => (b.n_captura ?? 0) - (a.n_captura ?? 0) || a.entidad.localeCompare(b.entidad, "es")),
        tot: sumarConteos(ents),
      }))
      .sort((a, b) => b.tot.n_captura - a.tot.n_captura || b.tot.total - a.tot.total || a.dep.localeCompare(b.dep, "es"));
    return { texto, deps };
  }, [entidades]);

  // Cada filtro de la fila, como predicado; el conteo de cada opción se calcula con los DEMÁS filtros puestos.
  const pasa = useCallback(
    (e: PoderEntidad, sin?: string) =>
      (!q || coincide(base.texto.get(e.entidad_ruc) ?? "", q)) &&
      (sin === "departamento" || !elegidos.departamento || (e.departamento || SIN_DEP) === elegidos.departamento) &&
      (sin === "nivel" || !elegidos.nivel || e.nivel === elegidos.nivel) &&
      (sin === "tipo" || !elegidos.tipo || indiciosDe(e).some((i) => i.tipo === elegidos.tipo)) &&
      (sin === "indicio" || !elegidos.indicio || (elegidos.indicio === "con" ? conIndicio(e) : !conIndicio(e))),
    [q, elegidos, base],
  );

  const { arbol, coinciden } = useMemo(() => {
    let n = 0;
    const out: NodoArbol[] = [];
    for (const { dep, ents, tot } of base.deps) {
      const hijos = ents.filter((e) => pasa(e)).map(hoja);
      if (!hijos.length) continue;
      n += hijos.length;
      out.push({
        id: `d:${dep}`,
        celdas: {
          entidad: (
            <CeldaPrincipal
              titulo={dep === SIN_DEP ? dep : tituloNatural(dep)}
              meta={[<Dato key="e" tipo="entidad">{plural(tot.total, "entidad que gobierna", "entidades que gobierna")}</Dato>]}
            />
          ),
          tasa: <CeldaTasa con={tot.conIndicio} de={tot.total} />,
          contratos: <CeldaNumero>{numero(tot.n_captura)}</CeldaNumero>,
          monto: <CeldaNumero>{tot.n_captura > 0 ? solesCompacto(tot.monto_captura) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
          indicios: tot.desglose ? <ChipsIndicio x={tot} /> : undefined,
        },
        hijos,
      });
    }
    return { arbol: out, coinciden: n };
  }, [base, pasa]);

  const filtros: FiltroArbol[] = useMemo(() => {
    const cuenta = (clave: string, valor: (e: PoderEntidad) => string | string[]) => {
      const m = new Map<string, number>();
      for (const e of entidades) {
        if (!pasa(e, clave)) continue;
        const v = valor(e);
        for (const x of Array.isArray(v) ? v : [v]) m.set(x, (m.get(x) ?? 0) + 1);
      }
      return m;
    };
    const cDep = cuenta("departamento", (e) => e.departamento || SIN_DEP);
    const cNiv = cuenta("nivel", (e) => e.nivel);
    const cTipo = cuenta("tipo", (e) => indiciosDe(e).map((i) => i.tipo));
    const cInd = cuenta("indicio", (e) => (conIndicio(e) ? "con" : "sin"));
    return [
      {
        clave: "departamento",
        etiqueta: "Departamento",
        todas: "Todos los departamentos",
        opciones: [...base.deps].sort((a, b) => a.dep.localeCompare(b.dep, "es")).map((d) => ({ valor: d.dep, etiqueta: d.dep === SIN_DEP ? d.dep : tituloNatural(d.dep), n: cDep.get(d.dep) ?? 0 })),
      },
      {
        clave: "nivel",
        etiqueta: "Nivel de gobierno",
        todas: "Todos los niveles",
        opciones: ["regional", "provincial", "distrital"].map((v) => ({ valor: v, etiqueta: nivelTxt(v), n: cNiv.get(v) ?? 0 })),
      },
      {
        clave: "tipo",
        etiqueta: "Tipo de indicio",
        todas: "Todo tipo de indicio",
        opciones: TIPOS_CAPTURA.map((t) => ({ valor: t.tipo, etiqueta: TIPO_CRUCE[t.tipo]?.corto ?? t.tipo, n: cTipo.get(t.tipo) ?? 0 })),
      },
      {
        clave: "indicio",
        etiqueta: "Con o sin contratos con indicio",
        todas: "Con y sin indicio",
        opciones: [
          { valor: "con", etiqueta: "Con contratos con indicio", n: cInd.get("con") ?? 0 },
          { valor: "sin", etiqueta: "Sin contratos con indicio", n: cInd.get("sin") ?? 0 },
        ],
      },
    ];
  }, [entidades, base, pasa]);

  const filtrando = !!q || Object.values(elegidos).some(Boolean);

  return (
    <div className="space-y-3">
      <BarraArbol
        buscar={{ placeholder: "Buscar una entidad, autoridad o lugar…", etiqueta: `Buscar entre las entidades de ${tituloNatural(partido)}` }}
        consulta={consulta}
        onConsulta={onConsulta}
        filtros={filtros}
        elegidos={elegidos}
        onElegir={(k, v) => setElegidos((e) => ({ ...e, [k]: v }))}
        resultado={`${numero(coinciden)} de ${numero(entidades.length)} entidades`}
        onQuitar={() => {
          setConsulta("");
          setElegidos({});
        }}
      />
      {arbol.length === 0 ? (
        <p className="py-1.5 text-dato text-mute" role="status">
          Ninguna entidad coincide con la búsqueda o los filtros.
        </p>
      ) : (
        <ArbolTabla
          key={filtrando ? "filtrado" : "todo"}
          columnas={COLUMNAS}
          nodos={arbol}
          etiqueta={`Entidades de ${tituloNatural(partido)} por departamento`}
          todoAbierto={filtrando}
        />
      )}
    </div>
  );
}

function hoja(e: PoderEntidad): NodoArbol {
  const lugar = lugarEnDep(e);
  return {
    id: e.entidad_ruc,
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={tituloNatural(e.entidad)}
          meta={[
            lugar && <Dato key="l" tipo="lugar">{lugar}</Dato>,
            // Autoridad electa: se muestra completa (docs/PRIVACIDAD.md).
            <Dato key="a" tipo="cargo" nombre="Autoridad">{e.autoridad ? tituloNatural(e.autoridad) : "Sin dato"}</Dato>,
          ]}
        />
      ),
      contratos: <CeldaNumero>{conIndicio(e) ? numero(e.n_captura) : <span className="font-sans text-mute">0</span>}</CeldaNumero>,
      monto: conIndicio(e) ? <CeldaNumero>{solesCompacto(e.monto_captura)}</CeldaNumero> : undefined,
      indicios: <ChipsIndicio x={e} />,
    },
    detalle: detalleEntidad(entidadLigera(e)),
  };
}
