"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { EstadoVacio } from "@/components/patrones";
import { numero, solesCompacto } from "@/lib/formato";
import { normalizar } from "@/lib/partidos";
import type { GobiernoDePartido } from "@/lib/partidosApi";
import { cn } from "@/lib/utils";

/**
 * TODOS los gobiernos que un partido ganó en un período (antes, las 15 entidades con más contratos): región,
 * provincia o distrito, quién lo encabezó, sus procesos adjudicados (CONOSCE) y sus contratos en la base de Vigía.
 * Se filtran por nivel y por nombre, y se ordenan por lo adjudicado, los procesos o el nombre; de a 20. Cada fila
 * abre la ficha de su entidad (la de más procesos de ese gobierno).
 */

const NIVELES = [
  { valor: "", etiqueta: "Todos los niveles" },
  { valor: "regional", etiqueta: "Regiones" },
  { valor: "provincial", etiqueta: "Provincias" },
  { valor: "distrital", etiqueta: "Distritos" },
] as const;
const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };
const ORDENES = [
  { valor: "monto", etiqueta: "Más adjudicado" },
  { valor: "procesos", etiqueta: "Más procesos" },
  { valor: "nombre", etiqueta: "Nombre, de la A a la Z" },
] as const;

const COLUMNAS: Columna[] = [
  { clave: "gobierno", titulo: "Gobierno", ancho: "minmax(0,1.6fr)" },
  { clave: "procesos", titulo: "Procesos", ancho: "96px", alinear: "der" },
  { clave: "monto", titulo: "Adjudicado", ancho: "120px", alinear: "der", desde: "md" },
  { clave: "vigia", titulo: "En Vigía", ancho: "112px", alinear: "der", desde: "lg" },
];

const CAMPO =
  "h-10 rounded-full border border-line bg-paper px-3.5 text-[14px] text-ink transition-colors duration-rapido hover:bg-paperSoft focus:border-granate";

export function GobiernosPartido({ gobiernos, partido }: { gobiernos: GobiernoDePartido[]; partido: string }) {
  const [q, setQ] = useState("");
  const [nivel, setNivel] = useState<string>("");
  const [orden, setOrden] = useState<string>("monto");

  const filas = useMemo(() => {
    const buscado = normalizar(q);
    const lista = gobiernos.filter(
      (g) => (!nivel || g.nivel === nivel) && (!buscado || normalizar([g.lugar, g.provincia, g.region, g.autoridad].filter(Boolean).join(" ")).includes(buscado)),
    );
    lista.sort((a, b) =>
      orden === "nombre" ? (a.lugar ?? "").localeCompare(b.lugar ?? "", "es") : orden === "procesos" ? b.procesos - a.procesos : b.montoAdjudicadoPen - a.montoAdjudicadoPen,
    );
    return lista.map(filaDe);
  }, [gobiernos, q, nivel, orden]);

  const cuenta = (n: string) => gobiernos.filter((g) => !n || g.nivel === n).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-auto sm:min-w-[14rem] sm:flex-1 lg:max-w-sm">
          <span className="sr-only">Buscar un gobierno por lugar o autoridad</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar un lugar o autoridad…"
            className={cn(CAMPO, "w-full pl-9")}
          />
        </label>
        <label>
          <span className="sr-only">Nivel de gobierno</span>
          <select value={nivel} onChange={(e) => setNivel(e.target.value)} className={cn(CAMPO, nivel && "border-granate font-semibold text-granate")}>
            {NIVELES.map((n) => (
              <option key={n.valor} value={n.valor} disabled={n.valor !== "" && cuenta(n.valor) === 0}>
                {n.etiqueta} ({numero(cuenta(n.valor))})
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto">
          <span className="sr-only">Ordenar por</span>
          <select value={orden} onChange={(e) => setOrden(e.target.value)} className={CAMPO}>
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filas.length === 0 ? (
        <EstadoVacio compacto titulo="Ningún gobierno coincide">Prueba con otro nombre de lugar o quita el nivel.</EstadoVacio>
      ) : (
        <TablaPaginada columnas={COLUMNAS} filas={filas} tam={20} nombre="gobiernos" etiqueta={`Gobiernos de ${partido} en el período`} />
      )}
    </div>
  );
}

function filaDe(g: GobiernoDePartido): Fila {
  const donde = g.nivel === "distrital" ? [g.provincia, g.region] : g.nivel === "provincial" ? [g.region] : [];
  return {
    id: `${g.nivel}-${g.ubigeo}`,
    href: g.ruc ? `/entidad/${g.ruc}` : undefined,
    celdas: {
      gobierno: (
        <CeldaPrincipal
          titulo={g.lugar ?? g.ubigeo}
          meta={[NIVEL[g.nivel], donde.filter(Boolean).join(", ") || null, g.autoridad ? `Autoridad: ${g.autoridad}` : null]}
        />
      ),
      procesos: <CeldaNumero>{g.procesos > 0 ? numero(g.procesos) : <span className="font-sans text-mute">0</span>}</CeldaNumero>,
      monto: <CeldaNumero>{g.montoAdjudicadoPen > 0 ? solesCompacto(g.montoAdjudicadoPen) : <span className="font-sans text-mute">—</span>}</CeldaNumero>,
      vigia: (
        <CeldaNumero sub={g.contratos > 0 ? `${numero(g.leidos)} leídos` : undefined}>
          {g.contratos > 0 ? `${numero(g.contratos)} contratos` : <span className="font-sans text-mute">—</span>}
        </CeldaNumero>
      ),
    },
  };
}
