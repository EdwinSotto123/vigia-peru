import { FileSearch, FileText, Landmark, MapPin, Users, Wallet } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { Indicadores, type Indicador } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { hallazgosContratos, hallazgosPersonas } from "@/components/inicio/hallazgos";
import { CajaResumen, HallazgosClave, ListaMas, RejillaResumen, elegirHallazgos, type FilaMas } from "@/components/inicio/ResumenFicha";
import { QuienGobiernaRegion } from "./GobiernosRegion";
import { TIPOS, getResumenContratos } from "@/lib/contratos";
import { getCorrupcionRegion } from "@/lib/corrupcion";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getRegionBudget } from "@/lib/mef-cache";
import { PARAMS_SOLOS, getPersonas } from "@/lib/personas";
import type { Region } from "@/lib/regiones";
import { GastoRegion, anioConGasto } from "./bloquesRegion";

/**
 * El Inicio de la ficha de una región (/region/[id], primera pestaña), armado en el SERVIDOR, en UNA pantalla de
 * escritorio (pedido del dueño del 2026-11-13), con la forma de las demás fichas (components/inicio/ResumenFicha.tsx):
 *
 *   las cifras: sus contratos, con antecedentes del ganador, su presupuesto y las personas contratadas
 *   ┌ Señales para revisar ┐ ┌ Quién la gobierna ──┐ ┌ Ver más ─────────────────┐
 *   │ las tres que más     │ │ gobernador, partido,│ │ contratos, en qué gasta  │
 *   │ pesan                │ │ mandato y sus        │ │ (panel), personas,      │
 *   │                      │ │ municipalidades      │ │ control, gobiernos…     │
 *   └──────────────────────┘ └──────────────────────┘ └─────────────────────────┘
 *
 * Antes: «Qué se encontró», «Dinero» y la tabla entera de la Contraloría y la Procuraduría (cientos de informes) uno
 * debajo del otro: 3.6 pantallas de escritorio y 7.9 de celular. La tabla está ahora en su pestaña «Control». Los enlaces
 * de contratos van a la pestaña Contratos de esta ficha. El panel de zona del mapa sigue con su versión de cliente
 * (components/inicio/InicioRegion.tsx).
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
  const anio = anioConGasto(mef);
  const gasto = mef && anio ? mef : null;
  const p = personas?.resumen ?? null;
  const l = resumen?.porLectura;
  const publicados = l?.publicado ?? 0;

  const cifras: Indicador[] = [
    {
      valor: resumen ? numero(resumen.total) : null,
      etiqueta: "contratos desde 2015",
      contexto: resumen ? (publicados ? plural(publicados, "con dictamen de Vigía", "con dictamen de Vigía") : "ninguno leído todavía") : undefined,
      href: contratos(),
    },
    {
      valor: resumen?.porCruces ? numero(resumen.porCruces.con) : null,
      etiqueta: "con antecedentes del ganador",
      contexto: resumen?.porCruces ? `de ${numero(resumen.total)}` : undefined,
      href: resumen?.porCruces?.con ? contratos({ cruces: "con" }) : undefined,
    },
    {
      valor: anio ? solesCompacto(anio.pim) : null,
      etiqueta: anio ? `presupuesto ${anio.year}` : "presupuesto",
      contexto: anio && anio.pim > 0 ? `${porcentaje((anio.devengado / anio.pim) * 100)} ya gastado (devengado)` : "Sin dato del MEF",
    },
    {
      valor: p ? numero(p.personas) : null,
      etiqueta: "personas contratadas",
      contexto: p ? `${solesCompacto(p.monto)} en órdenes de servicio` : undefined,
      href: p?.filas ? enPersonas() : undefined,
    },
  ];

  const hallazgos = elegirHallazgos([
    hallazgosContratos(resumen, contratos, { unidad: "En los contratos de sus entidades" }),
    hallazgosPersonas(p, enPersonas, PARAMS_SOLOS, { sinSenales: [] }),
  ]);

  const porTipo = resumen
    ? TIPOS.map((t) => ({ etiqueta: t.label, n: resumen.porTipo[t.value] ?? 0 }))
        .filter((t) => t.n > 0)
        .sort((a, b) => b.n - a.n)
    : [];
  const mayorGasto = gasto?.topGenericas?.length ? [...gasto.topGenericas].sort((a, b) => b.pim - a.pim)[0] : null;
  const pp = corrupcion?.procuraduria;
  const filas: FilaMas[] = [
    resumen
      ? {
          clave: "contratos",
          icono: FileText,
          titulo: "Sus contratos",
          // Sin cifra: su número ya es la primera cifra de arriba (y el de su pestaña).
          // recorte: los dos tipos con más contratos; todos, en la pestaña Contratos (su filtro «Tipo»)
          texto: porTipo.length ? `Más ${porTipo.slice(0, 2).map((t) => `${t.etiqueta.toLowerCase()} (${numero(t.n)})`).join(" y ")}` : "Desde 2015",
          href: contratos(),
        }
      : { clave: "contratos", icono: FileText, titulo: "Sus contratos", texto: "El servicio de contratos no respondió ahora", sinRespuesta: true, href: ruta },
    ...(gasto && anio
      ? [
          {
            clave: "gasto",
            icono: Wallet,
            titulo: `En qué gasta (${anio.year})`,
            // Su presupuesto ya es una cifra de arriba: aquí, en qué se va la parte mayor.
            cifra: mayorGasto && anio.pim > 0 ? porcentaje((mayorGasto.pim / anio.pim) * 100) : null,
            texto: mayorGasto ? `en ${tituloNatural(mayorGasto.nombre)}` : undefined,
            panel: {
              titulo: `En qué gasta ${r.nombre} (${anio.year})`,
              descripcion: "Del MEF: el presupuesto modificado (PIM) de todas las entidades del departamento, por tipo de gasto, y la parte ya gastada (devengado).",
              contenido: <GastoRegion mef={gasto} />,
            },
          },
        ]
      : []),
    ...(p && p.filas > 0
      ? [
          {
            clave: "personas",
            icono: Users,
            titulo: "Personas contratadas",
            // Cuántas y cuánto ya son una cifra de arriba: aquí, cuántas con una señal grave.
            texto: p.alta > 0 ? `${numero(p.alta)} con una señal grave` : "Sin señales graves",
            tono: p.alta > 0 ? ("alta" as const) : undefined,
            href: enPersonas(),
          },
        ]
      : []),
    corrupcion
      ? {
          clave: "control",
          icono: FileSearch,
          titulo: "Control y casos judiciales",
          texto: `${plural(corrupcion.informes.total, "informe de control", "informes de control")}${pp ? `, ${plural(pp.en_ejecucion, "caso con sentencia firme", "casos con sentencia firme")}` : ""}`,
          href: `${ruta}?seccion=control`,
        }
      : { clave: "control", icono: FileSearch, titulo: "Control y casos judiciales", texto: "El servicio no respondió ahora", sinRespuesta: true, href: ruta },
    { clave: "gobiernos", icono: Landmark, titulo: "Quién la gobernó", texto: "Desde 2015, y sus provincias y distritos", href: `${ruta}?seccion=gobiernos` },
    { clave: "territorio", icono: MapPin, titulo: "Provincias y distritos", texto: "Cada uno con su alcalde y sus contratos", href: `${ruta}?seccion=territorio` },
  ];

  return (
    <div className="space-y-4">
      <h2 className="sr-only">Resumen de la región</h2>
      <Indicadores items={cifras} />
      <RejillaResumen>
        <CajaResumen
          titulo="Señales para revisar"
          flush
          ayuda={
            <Ayuda titulo="¿Qué señales son?">
              <span className="block">
                Las tres que más pesan entre los contratos de las entidades de {r.nombre} y las personas que contrataron: lo grave
                primero. Cada fila abre esa lista ya filtrada, con la evidencia de cada caso.
              </span>
              <span className="mt-2 block">Son cruces de datos públicos: indicios para revisar, no acusaciones.</span>
            </Ayuda>
          }
          enlace={resumen?.porCruces?.con ? { href: contratos({ cruces: "con" }), texto: "Todos los antecedentes" } : undefined}
        >
          <HallazgosClave filas={hallazgos} vacio="Sin señales en los contratos de sus entidades ni en las personas que contrataron." />
        </CajaResumen>
        <QuienGobiernaRegion ubigeo={r.ubigeo} ruta={ruta} />
        <CajaResumen titulo="Ver más" flush className="lg:col-span-2 xl:col-span-1">
          <ListaMas filas={filas} columnas={2} />
        </CajaResumen>
      </RejillaResumen>
    </div>
  );
}

/** La espera del Inicio: la forma de sus cifras y de sus tres cajas (nunca «Cargando…» con la cara de «sin dato»). */
export function InicioRegionEsqueleto() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-24 rounded-xl" />
      <RejillaResumen>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </RejillaResumen>
    </div>
  );
}
