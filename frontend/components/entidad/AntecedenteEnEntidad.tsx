"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Briefcase, SearchX } from "lucide-react";
import { MuestraSerie } from "@/components/charts/BarraSegmentada";
import { ColumnasAnio } from "@/components/charts/ColumnasAnio";
import { EstadoCarga, usePoder } from "@/components/grafo/vista";
import { Buscador, CeldaFecha, CeldaNumero, CeldaPrincipal, CLASE_ENLACE_CELDA, CuentaGrupo, Tabla, TablaPaginada, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { MARGEN_LISTA, Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  TAM_PATRONES,
  rutaAntecedenteEntidad,
  rutaContratosAntecedente,
  type AntecedenteDeEntidad,
  type ContratoDelAntecedente,
  type ContratosDelAntecedente,
} from "@/lib/patrones";
import { rutaContrato } from "@/lib/rutas";
import { cn } from "@/lib/utils";

/**
 * Lo que cuenta la ficha de UN antecedente en una entidad, debajo de sus cifras (pedido del usuario del 2026-11-18: «lo veo
 * sin forma»; antes eran los cinco proveedores que más lo repetían y «Los 6 contratos de más peso», recortados):
 *
 *   1. Año por año: cuántos de sus contratos lo tienen, por la fecha de la buena pro, los de señal alta abajo.
 *   2. Quiénes los ganaron: TODOS los proveedores, del que más contratos tiene al que menos, con su barra; con buscador.
 *   3. Sus contratos: TODOS, paginados, con buscador (objeto, código o empresa) y «sólo de señal alta»; cada fila abre
 *      su ficha en «Antecedentes», donde está la evidencia.
 *
 * Se pide al elegirlo en el índice (sólo se monta el elegido): armado en el servidor para los 44 antecedentes de EsSalud,
 * la página cargaba todas sus listas.
 */
export function AntecedenteEnEntidad({ ruc, tipo, nombre, contratos, graves }: { ruc: string; tipo: string; nombre: string; contratos: number; graves: number }) {
  const carga = usePoder<AntecedenteDeEntidad>(rutaAntecedenteEntidad(ruc, tipo));
  // Una lista a la vez (2026-11-18: apiladas, «quiénes» y «sus contratos» hacían 3 pantallas). Estado local: cambiar de lista
  // con un enlace volvía a pedir al servidor la ficha entera de la entidad.
  const [lista, setLista] = useState<"quienes" | "contratos">("quienes");
  return (
    <div className="space-y-6">
      <EstadoCarga carga={carga} columnas={COLUMNAS_PROVEEDORES}>
        {(d) => (
          <>
            <AnioPorAnio d={d} nombre={nombre} />
            <ElegirLista
              actual={lista}
              alElegir={setLista}
              opciones={[
                { clave: "quienes", etiqueta: "Quiénes ganaron esos contratos", conteo: d.empresas },
                { clave: "contratos", etiqueta: "Sus contratos", conteo: contratos },
              ]}
            />
            {lista === "quienes" && <QuienesLoTienen d={d} nombre={nombre} />}
          </>
        )}
      </EstadoCarga>
      {lista === "contratos" && <SusContratos ruc={ruc} tipo={tipo} nombre={nombre} contratos={contratos} graves={graves} />}
    </div>
  );
}

/** El conmutador de la lista que se ve (mismo aspecto que `Vistas` secundaria, sin navegar). */
function ElegirLista<T extends string>({ actual, alElegir, opciones }: { actual: T; alElegir: (v: T) => void; opciones: { clave: T; etiqueta: string; conteo: number }[] }) {
  return (
    <div role="tablist" aria-label="Qué lista ver" className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-paperSoft p-1 [scrollbar-width:none]">
      {opciones.map((o) => {
        const on = o.clave === actual;
        return (
          <button
            key={o.clave}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => alElegir(o.clave)}
            className={cn(
              "inline-flex min-h-[36px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-meta font-semibold transition-colors duration-rapido",
              on ? "border border-line bg-paper text-ink shadow-sm" : "text-inkSoft hover:text-ink",
            )}
          >
            {o.etiqueta}
            <span className="font-mono tabular-nums text-mute">{numero(o.conteo)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Un bloque de la ficha: su título (h4) con su conteo en pastilla, lo de la derecha (leyenda, contexto) y su contenido. */
function Bloque({ titulo, cuenta, extra, children }: { titulo: string; cuenta?: number; extra?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 id={id} className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
          {titulo}
          {cuenta != null && <CuentaGrupo>{numero(cuenta)}</CuentaGrupo>}
        </h4>
        {extra}
      </div>
      {children}
    </section>
  );
}

// ─── 1. Año por año ──────────────────────────────────────────────────────────────

function AnioPorAnio({ d, nombre }: { d: AntecedenteDeEntidad; nombre: string }) {
  const anios = d.porAnio ?? [];
  // Con un solo año no hay serie que leer: las cifras de arriba ya lo dicen.
  if (anios.length < 2) return null;
  const conAltas = anios.some((a) => a.graves > 0);
  return (
    <Bloque
      titulo="Año por año"
      extra={
        // La leyenda: el mismo color de cada parte de la columna (el gráfico la deja a quien lo usa).
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-rotulo text-inkSoft" aria-label="Leyenda">
          {conAltas && (
            <li className="inline-flex items-center gap-1.5">
              <MuestraSerie i={0} /> De señal alta
            </li>
          )}
          <li className="inline-flex items-center gap-1.5">
            <MuestraSerie i={1} /> Media o baja
          </li>
        </ul>
      }
    >
      <ColumnasAnio
        anios={anios.map((a) => ({
          anio: a.anio,
          a: a.graves,
          b: Math.max(0, a.contratos - a.graves),
          detalleA: plural(a.graves, "contrato", "contratos"),
          detalleB: plural(Math.max(0, a.contratos - a.graves), "contrato", "contratos"),
        }))}
        etiquetaA="De señal alta"
        etiquetaB="Media o baja"
        formato="numero"
        etiqueta={`Contratos con «${nombre}» por año de la buena pro`}
      />
      {d.sinFecha > 0 && (
        <p className="text-rotulo text-mute">
          {d.sinFecha === 1 ? "1 contrato sin fecha de buena pro no entra" : `${numero(d.sinFecha)} contratos sin fecha de buena pro no entran`} en el
          gráfico; sí en la lista de abajo.
        </p>
      )}
    </Bloque>
  );
}

// ─── 2. Quiénes los ganaron ──────────────────────────────────────────────────────

const COLUMNAS_PROVEEDORES: Columna[] = [
  { clave: "proveedor", titulo: "Proveedor", ancho: "minmax(0,1fr)" },
  { clave: "contratos", titulo: "Contratos", ancho: "6rem", alinear: "der" },
  { clave: "graves", titulo: "De señal alta", ancho: "6.5rem", alinear: "der", desde: "md", igual: { frases: { Ninguno: "Ninguno de señal alta" } } },
  { clave: "monto", titulo: "Suman", ancho: "6.5rem", alinear: "der", desde: "md" },
];

/** Sólo un RUC 20 se enlaza y se busca: una persona natural llega tapada (sin RUC a la vista ni nombre buscable). */
const esEmpresa = (ruc: string | null | undefined) => !!ruc && /^20\d{9}$/.test(ruc);

function QuienesLoTienen({ d, nombre }: { d: AntecedenteDeEntidad; nombre: string }) {
  const proveedores = d.proveedores ?? [];
  const repiten = proveedores.filter((x) => x.contratos > 1).length;
  const filas = useMemo<Fila[]>(
    () =>
      proveedores.map((x, i) => {
        const texto = x.proveedor ? tituloNatural(x.proveedor) : esEmpresa(x.ruc) ? `RUC ${x.ruc}` : "Persona natural";
        return {
          // Nunca el RUC en el DOM como id (puede ser una persona).
          id: `proveedor-${i}`,
          buscable: esEmpresa(x.ruc) ? `${texto} ${x.ruc}` : undefined,
          textos: { graves: x.graves ? numero(x.graves) : "Ninguno" },
          magnitudes: { contratos: x.contratos },
          celdas: {
            proveedor: (
              <span className="block min-w-0 truncate text-dato font-medium text-ink" title={texto}>
                {esEmpresa(x.ruc) ? (
                  <Link href={`/empresa/${x.ruc}?seccion=antecedentes`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                    {texto}
                  </Link>
                ) : (
                  texto
                )}
              </span>
            ),
            contratos: <CeldaNumero>{numero(x.contratos)}</CeldaNumero>,
            graves: <CeldaNumero>{x.graves ? numero(x.graves) : <span className="font-sans text-mute">Ninguno</span>}</CeldaNumero>,
            monto: <CeldaNumero>{solesCompacto(x.monto)}</CeldaNumero>,
          },
        };
      }),
    [proveedores],
  );
  if (!proveedores.length) return null;
  return (
    <Bloque
      titulo="Quiénes ganaron esos contratos"
      cuenta={d.empresas || proveedores.length}
      extra={
        <p className="text-rotulo tabular-nums text-mute">
          {repiten > 0 ? `${numero(repiten)} lo ${repiten === 1 ? "repite" : "repiten"}: dos contratos o más` : "Cada uno con un contrato"}
          {d.empresas > proveedores.length ? `; aquí los ${numero(proveedores.length)} con más contratos` : ""}
        </p>
      }
    >
      <TablaPaginada
        columnas={COLUMNAS_PROVEEDORES}
        filas={filas}
        etiqueta={`Proveedores con «${nombre}» en esta entidad`}
        nombre="proveedores"
        tam={10}
        medida="contenedor"
        densidad="compacta"
        controles="abajo"
        buscar={{ placeholder: "Buscar una empresa por su nombre o RUC…", etiqueta: "Buscar entre los proveedores" }}
      />
    </Bloque>
  );
}

// ─── 3. Sus contratos ────────────────────────────────────────────────────────────

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "contrato", titulo: "Contrato y quién lo ganó", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Monto", ancho: "6.5rem", alinear: "der" },
  { clave: "fecha", titulo: "Buena pro", ancho: "6.5rem", alinear: "der", desde: "md" },
];

function filaContrato(x: ContratoDelAntecedente): Fila {
  const objeto = x.objeto ? tituloNatural(x.objeto) : `Proceso ${x.codigo ?? x.ocid}`;
  const quien = x.proveedor ? tituloNatural(x.proveedor) : "Sin nombre en el registro";
  return {
    id: x.ocid,
    href: rutaContrato(x.ocid, "ficha", { seccion: "antecedentes" }),
    etiqueta: `Abrir el contrato: ${objeto}`,
    magnitudes: { monto: x.monto },
    celdas: {
      contrato: (
        <CeldaPrincipal
          textoCompleto={objeto}
          titulo={
            <>
              <Severidad bandera={x.severidad ?? "baja"} formato="punto" className="mr-1.5 align-[-1px]" />
              {objeto}
            </>
          }
          meta={[
            ...(x.codigo ? [<Dato key="c" tipo="codigo" mono>{x.codigo}</Dato>] : []),
            <Dato key="p" icono={Briefcase} nombre="Lo ganó">
              {quien}
            </Dato>,
          ]}
        />
      ),
      monto: <CeldaNumero>{x.monto != null ? solesCompacto(x.monto) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      fecha: <CeldaFecha fecha={x.fecha} />,
    },
  };
}

function SusContratos({ ruc, tipo, nombre, contratos, graves }: { ruc: string; tipo: string; nombre: string; contratos: number; graves: number }) {
  const [q, setQ] = useState("");
  const [altas, setAltas] = useState(false);
  const [page, setPage] = useState(1);
  const consulta = q.trim().length >= 3 ? q.trim() : undefined;
  const carga = usePoder<ContratosDelAntecedente>(rutaContratosAntecedente(ruc, tipo, page, consulta, altas ? "alta" : undefined));
  const d = carga.datos;
  const total = d?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAM_PATRONES));
  const filtrando = !!consulta || altas;
  const control = (subir: boolean) =>
    total > TAM_PATRONES ? (
      <div className="flex justify-end">
        <Paginacion actual={page} paginas={paginas} total={total} tam={TAM_PATRONES} navegacion="interna" onChange={setPage} cargando={carga.cargando} nombre="contratos" subir={subir} />
      </div>
    ) : null;
  return (
    <Bloque
      titulo="Sus contratos"
      cuenta={contratos}
      extra={<p className="text-rotulo text-mute">Lo grave primero y, dentro, lo de más monto</p>}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Buscador
          placeholder="Buscar por objeto, código o empresa…"
          etiqueta={`Buscar en los contratos con «${nombre}»`}
          valor={q}
          min={3}
          cargando={carga.cargando && !!consulta}
          onBuscar={(v) => {
            setQ(v);
            setPage(1);
          }}
          className="sm:flex-[1_1_18rem]"
        />
        {graves > 0 && graves < contratos && (
          <button
            type="button"
            aria-pressed={altas}
            onClick={() => {
              setAltas((x) => !x);
              setPage(1);
            }}
            className={cn(
              "inline-flex h-10 w-fit items-center gap-1.5 rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
              altas ? "border-granate/60 bg-paper text-ink shadow-[inset_0_-2px_0_0_theme(colors.granate.DEFAULT)]" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
            )}
          >
            <Severidad bandera="alta" formato="punto" />
            Sólo de señal alta
            <span className="font-mono tabular-nums text-mute">{numero(graves)}</span>
          </button>
        )}
        {filtrando && d && (
          <span className="text-meta tabular-nums text-mute" aria-live="polite">
            {numero(total)} de {numero(contratos)}
          </span>
        )}
      </div>
      <div data-paginado className={cn(MARGEN_LISTA, "space-y-3")}>
        {control(false)}
        <div aria-busy={carga.cargando} className={cn("transition-opacity duration-rapido", carga.cargando && d && "opacity-60")}>
          {!d && carga.cargando ? (
            <TablaSkeleton columnas={COLUMNAS_CONTRATOS} filas={6} />
          ) : !d || carga.error ? (
            <VacioEnLinea icono={<SearchX size={16} />} accion={<button type="button" onClick={carga.reintentar} className="text-meta font-semibold text-granate underline underline-offset-2">Reintentar</button>}>
              No pudimos traer sus contratos ahora.
            </VacioEnLinea>
          ) : d.data.length === 0 ? (
            <VacioEnLinea icono={<SearchX size={16} />}>
              {consulta ? `Ningún contrato coincide con «${consulta}».` : page > 1 ? "Esta página ya no tiene contratos." : "Ningún contrato con este filtro."}
            </VacioEnLinea>
          ) : (
            <Tabla columnas={COLUMNAS_CONTRATOS} filas={d.data.map(filaContrato)} etiqueta={`Contratos de la entidad con «${nombre}»`} medida="contenedor" densidad="compacta" />
          )}
        </div>
        {control(true)}
      </div>
    </Bloque>
  );
}
