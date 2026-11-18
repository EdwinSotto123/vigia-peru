import { Suspense } from "react";
import { Briefcase, Building2, FileSearch, FileText, Flag, HardHat, Landmark, MapPin, Network, UserRoundSearch, Users, Wallet, Repeat } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { DatosClave } from "@/components/patrones/Detalle";
import { FuenteDato } from "@/components/patrones/Estructura";
import { Indicadores, type Indicador } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmpresasLigadas, FUENTE_GOBIERNO, TIPOS_CAPTURA, datosQuienGobierna } from "@/components/entidad/CapturaEntidad";
import { AyudaQuienDecide, ListaFuncionarios, datosQuienDecide, otrosFuncionarios } from "@/components/entidad/QuienDecide";
import { getEstructuraEntidad, getGastoEntidad, type ConteosEntidad, type NepotismoEntidad } from "@/lib/api-client";
import { getCorrupcionEntidad } from "@/lib/corrupcion";
import type { ResumenContratos } from "@/lib/contratos";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { getResumenObras } from "@/lib/obras";
import { getPersonas, PARAMS_EN_FICHA } from "@/lib/personas";
import { getPoderEntidad, getPoderGrafoEntidad } from "@/lib/poder";
import { rutaRegion } from "@/lib/regiones";
import { TIPOS_OBRA } from "@/lib/cruces";
import { NepotismoInicio } from "./NepotismoInicio";
import { hallazgosContratos, hallazgosObras, hallazgosPersonas } from "./hallazgos";
import { CajaResumen, HallazgosClave, ListaMas, RejillaResumen, elegirHallazgos, type FilaMas } from "./ResumenFicha";

/**
 * Inicio de una entidad (/entidad/[ruc], primera pestaña), en UNA pantalla de escritorio (pedido del dueño del
 * 2026-11-13). Sus banderas van en la cabecera de la ficha; aquí:
 *
 *   las cifras de la ficha (contratos, antecedentes, órdenes, presupuesto: cada una abre su lista)
 *   ┌ Señales para revisar ─────────────┐ ┌ Quién la gobierna ───────────────┐
 *   │ las tres que más pesan, de sus     │ │ partido, autoridad, período, quién│
 *   │ contratos, su gente y sus obras    │ │ aprueba sus contratos y lo ocupa  │
 *   └────────────────────────────────────┘ └───────────────────────────────────┘
 *   ┌ Ver más ───────────────────────────────────────────────────────────────────┐
 *   │ una fila por pestaña con su cifra clave (compras, personas, obras, gasto,  │
 *   │ control) y, en un panel al costado, lo que no tiene pestaña: las empresas  │
 *   │ ligadas a la gestión, los parientes que le venden, sus altos funcionarios, │
 *   │ dónde comprobarlo (los registros oficiales)                                │
 *   └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Antes: «Qué se encontró», «Dinero» y «Control» uno debajo del otro, con la lista de banderas de sus contratos, la de
 * sus personas, la de sus obras, la tabla de empresas ligadas, la de parientes, en qué gasta y los informes de la
 * Contraloría: 4.8 pantallas de escritorio y ~10 de celular, y casi todo estaba también en su pestaña (auditoría del
 * 2026-11-13). Las señales que ya son banderas de la cabecera (la captura, el nepotismo) no se repiten aquí.
 */
export function InicioEntidad({
  ruc,
  ruta,
  cifras,
  resumen,
  conteos,
  region,
  ubigeo,
  regionDenuncias,
  nepotismo,
  fuentes,
}: {
  ruc: string;
  ruta: string;
  /** Las cifras de la ficha (`Indicadores`). */
  cifras: Indicador[];
  resumen: ResumenContratos | null;
  /** Ya no se usa aquí (va en la cifra de sus contratos): se acepta para no romper la llamada. */
  enCola?: number;
  /** Cuántas filas tiene cada pestaña (GET /entidades/:ruc/conteos); null si no respondió. */
  conteos: ConteosEntidad | null;
  /** Su departamento, por nombre ("Lima"). */
  region: string | null;
  /** Su ubigeo ("150101"): los dos primeros dígitos son su región. */
  ubigeo: string | null;
  /** El nombre de su región como lo usa /app/denuncias, si se reconoce. */
  regionDenuncias?: string;
  /** Parientes declarados en la DJI que son locadores de esta entidad: el panel de su fila de «Ver más». */
  nepotismo: NepotismoEntidad | null;
  /** Ya no se usa aquí (lo explica la pestaña Cuánto gasta): se acepta para no romper la llamada. */
  fueraDelMef?: boolean;
  /** De dónde salen sus datos y dónde comprobarlos en cada registro oficial (el panel «Dónde comprobarlo»). */
  fuentes?: Fuentes;
}) {
  return (
    <div className="space-y-4">
      <h2 className="sr-only">Resumen de la entidad</h2>
      <Indicadores items={cifras} />
      <Suspense fallback={<EsqueletoResumen />}>
        <Resumen
          ruc={ruc}
          ruta={ruta}
          resumen={resumen}
          conteos={conteos}
          region={region}
          ubigeo={ubigeo}
          regionDenuncias={regionDenuncias}
          nepotismo={nepotismo}
          fuentes={fuentes}
        />
      </Suspense>
    </div>
  );
}

/** Mientras llega: la forma de las tres cajas (nunca «Sin dato» provisional). */
export function EsqueletoResumen() {
  return (
    <div className="space-y-4" aria-hidden>
      <RejillaResumen className="xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="h-60 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </RejillaResumen>
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}

async function Resumen({
  ruc,
  ruta,
  resumen,
  conteos,
  region,
  ubigeo,
  regionDenuncias,
  nepotismo,
  fuentes,
}: {
  ruc: string;
  ruta: string;
  resumen: ResumenContratos | null;
  conteos: ConteosEntidad | null;
  region: string | null;
  ubigeo: string | null;
  regionDenuncias?: string;
  nepotismo: NepotismoEntidad | null;
  fuentes?: Fuentes;
}) {
  // Todo a la vez (el poder también lo pide la cabecera: Next hace un solo `fetch`).
  const [gasto, corrupcion, personas, poder, grafo, estructura, obras] = await Promise.all([
    getGastoEntidad(ruc),
    getCorrupcionEntidad(ruc),
    getPersonas({ entidad: ruc, size: 0 }),
    getPoderEntidad(ruc),
    getPoderGrafoEntidad(ruc),
    getEstructuraEntidad(ruc),
    getResumenObras(ruc),
  ]);
  const enSeccion = (seccion: string, f: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ seccion, ...f })}`;
  const contratos = (f: Record<string, string> = {}) => enSeccion("contratos", { vista: "contratos", ...f });
  const enPersonas = (f: Record<string, string> = {}) => enSeccion("personas", f);
  const r = personas?.resumen ?? null;
  const dep = ubigeo?.slice(0, 2) || corrupcion?.departamento || null;

  // Las tres señales que más pesan, una de cada fuente primero. La captura y el nepotismo son banderas de la cabecera: no
  // se repiten. Las de la obra de cada contrato van con sus obras.
  const hallazgos = elegirHallazgos([
    hallazgosContratos(resumen, contratos, { sinTipos: [...TIPOS_CAPTURA, ...TIPOS_OBRA] }),
    hallazgosPersonas(r, enPersonas, PARAMS_EN_FICHA),
    hallazgosObras(obras, ruta),
  ]);

  const gobierna = [...datosQuienGobierna(poder), ...datosQuienDecide(estructura)];
  const otros = otrosFuncionarios(estructura);

  // «Ver más»: cada pestaña con la cifra que la resume, y en un panel lo que no tiene pestaña propia.
  const totalGasto = (gasto?.funciones ?? []).reduce((s, f) => s + f.pim, 0);
  const mayorRubro = [...(gasto?.funciones ?? [])].sort((a, b) => b.pim - a.pim)[0];
  const o = obras?.obras;
  const inv = obras?.inversiones;
  const conTipos = resumen ? Object.entries(resumen.porTipo).filter(([, n]) => (n ?? 0) > 0).length : 0;
  const filas: FilaMas[] = [
    ...(conteos?.compras != null || resumen
      ? [
          {
            clave: "compras",
            icono: FileText,
            titulo: "Sus compras",
            // Sin cifra: su número ya está en la pestaña y en las cifras de arriba.
            texto: conTipos ? "Procesos, órdenes, catálogo y menores" : "Procesos, órdenes y contratos menores",
            href: enSeccion("contratos"),
          },
        ]
      : []),
    ...(r && r.filas > 0
      ? [
          {
            clave: "personas",
            icono: Users,
            titulo: "Personas contratadas",
            // Cuántas ya lo dice la pestaña: aquí, cuánto se les pagó.
            cifra: solesCompacto(r.monto),
            texto: r.alta > 0 ? `${numero(r.alta)} con una señal grave` : `En ${plural(r.ordenes, "orden", "órdenes")} de servicio`,
            tono: r.alta > 0 ? ("alta" as const) : undefined,
            href: enPersonas(),
          },
        ]
      : []),
    ...(o?.total || inv?.total
      ? [
          {
            clave: "obras",
            icono: HardHat,
            titulo: "Obras e inversiones",
            cifra: numero(o?.total || inv?.total || 0),
            texto: o?.total ? plural(o.alta, "obra con una bandera grave", "obras con una bandera grave") : plural(inv?.total ?? 0, "inversión en Invierte.pe", "inversiones en Invierte.pe"),
            tono: o?.alta ? ("alta" as const) : undefined,
            href: enSeccion("obras"),
          },
        ]
      : []),
    ...(totalGasto > 0 && gasto
      ? [
          {
            clave: "gasto",
            icono: Wallet,
            titulo: `En qué gasta${gasto.anio ? ` (${gasto.anio})` : ""}`,
            // Su presupuesto ya es una cifra de arriba: aquí, en qué se va la parte mayor.
            cifra: mayorRubro ? porcentaje((mayorRubro.pim / totalGasto) * 100) : null,
            texto: mayorRubro ? `en ${tituloNatural(mayorRubro.nombre)}` : undefined,
            href: enSeccion("presupuesto"),
          },
        ]
      : []),
    corrupcion
      ? {
          clave: "control",
          icono: FileSearch,
          titulo: "Informes de la Contraloría",
          cifra: numero(corrupcion.informes.total),
          texto: corrupcion.informes.total ? `${numero(corrupcion.informes.penal)} con responsabilidad penal presunta` : "Ninguno con responsabilidad en su buscador",
          tono: corrupcion.informes.penal > 0 ? ("media" as const) : undefined,
          href: enSeccion("control"),
        }
      : { clave: "control", icono: FileSearch, titulo: "Informes de la Contraloría", texto: "El servicio no respondió ahora", sinRespuesta: true, href: ruta },
    ...(poder?.n_captura && grafo?.empresas?.length
      ? [
          {
            clave: "ligadas",
            icono: Network,
            titulo: "Empresas ligadas a la gestión",
            cifra: numero(poder.n_empresas),
            texto: `${solesCompacto(poder.monto_captura)} en ${plural(poder.n_captura, "contrato", "contratos")}`,
            panel: {
              titulo: "Empresas ligadas a la gestión",
              descripcion: "Financiaron o le vendieron a la campaña del partido que la gobierna, o un socio trabaja en la entidad. Sólo empresas (RUC 20).",
              contenido: <EmpresasLigadas poder={poder} grafo={grafo} entidadRuc={ruc} href={contratos} />,
            },
          },
        ]
      : []),
    ...(nepotismo && nepotismo.total > 0 && nepotismo.detalle?.length
      ? [
          {
            clave: "parientes",
            icono: UserRoundSearch,
            titulo: "Parientes de funcionarios que le venden",
            // Sin cifra: es la bandera «Posible nepotismo» de la cabecera; aquí, sus casos.
            texto: `${plural(nepotismo.total, "caso", "casos")}, del funcionario al pariente`,
            panel: {
              titulo: "Parientes de funcionarios que le venden",
              descripcion: "Un funcionario los declaró como parientes en su Declaración Jurada de Intereses y figuran como locadores de la entidad. Del pariente se tapa un apellido.",
              contenido: <NepotismoInicio nepotismo={nepotismo} href={enPersonas} sinMarco />,
            },
          },
        ]
      : []),
    ...(otros.length
      ? [
          {
            clave: "funcionarios",
            icono: Building2,
            titulo: "Sus altos funcionarios",
            cifra: numero(otros.length),
            texto: "Del organigrama oficial, con su cargo",
            panel: { titulo: "Sus altos funcionarios", descripcion: "Quienes hoy ocupan sus cargos de dirección, según el organigrama oficial.", contenido: <ListaFuncionarios lista={otros} corte={estructura?.corte} /> },
          },
        ]
      : []),
    // Lo que se repite en la entidad, por familias: concertación, compras partidas, familia y política, sanciones.
    { clave: "patrones", icono: Repeat, titulo: "Antecedentes y patrones", texto: "Lo que se repite: concertación, compras partidas, familia y sanciones", href: enSeccion("patrones") },
    { clave: "proveedores", icono: Briefcase, titulo: "Quiénes le venden", texto: "Sus proveedores, con sus antecedentes", href: `/app/empresas?entidad=${ruc}` },
    // Los registros oficiales, su región (con la Procuraduría, que publica por departamento) y sus obras denunciadas, en un
    // panel: antes eran dos tarjetas de enlaces en una columna lateral y, después, tres renglones al pie.
    {
      clave: "comprobar",
      icono: Landmark,
      titulo: "Dónde comprobarlo",
      texto: "Sus registros oficiales y su región",
      panel: {
        titulo: "Dónde comprobarlo",
        descripcion: fuentes ? `Fuente: ${fuentes.fuente}.` : undefined,
        contenido: (
          <ListaMas
            filas={[
              ...(fuentes?.enlaces ?? [])
                .filter((e): e is { texto: string; href: string } => !!e && !!e.href)
                .map((e) => ({ clave: e.href, icono: Landmark, titulo: e.texto, href: e.href, externo: true })),
              ...(dep ? [{ clave: "region", icono: MapPin, titulo: `La ficha de ${region ?? "su región"}`, texto: "Con los casos de la Procuraduría Anticorrupción", href: rutaRegion(dep) }] : []),
              ...(regionDenuncias
                ? [{ clave: "denuncias", icono: Flag, titulo: `Obras denunciadas en ${regionDenuncias}`, texto: "Lo que reporta la gente", href: `/app/denuncias?region=${encodeURIComponent(regionDenuncias)}` }]
                : []),
            ]}
          />
        ),
      },
    },
  ];

  return (
    <>
      {/* Las señales, más anchas: desde ~34rem cada fila lleva su barra al lado y mide la mitad. */}
      <RejillaResumen className="xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CajaResumen
          titulo="Señales para revisar"
          flush
          ayuda={
            <Ayuda titulo="¿Qué señales son?">
              <span className="block">
                Las tres que más pesan entre sus contratos, las personas que contrató y sus obras: lo grave primero. Cada fila abre esa
                lista ya filtrada, con la evidencia de cada caso.
              </span>
              <span className="mt-2 block">
                Son cruces de datos públicos: indicios para revisar, no acusaciones. Sus banderas (arriba, junto al nombre) no se
                repiten aquí.
              </span>
            </Ayuda>
          }
          enlace={resumen?.porCruces?.con ? { href: contratos({ cruces: "con" }), texto: "Todos los antecedentes" } : undefined}
        >
          <HallazgosClave filas={hallazgos} vacio="Sin señales en sus contratos, en las personas que contrató ni en sus obras." />
        </CajaResumen>
        {gobierna.length > 0 && (
          <CajaResumen
            titulo={poder?.partido ? "Quién la gobierna" : "Quién decide"}
            ayuda={<AyudaQuienDecide corte={estructura?.corte} />}
            enlace={{ href: enSeccion("organizacion"), texto: "Su organización" }}
          >
            <DatosClave items={gobierna} />
            {poder?.partido && <FuenteDato fuente={FUENTE_GOBIERNO.fuente} href={FUENTE_GOBIERNO.href} className="mt-2" />}
          </CajaResumen>
        )}
      </RejillaResumen>
      <CajaResumen titulo="Ver más" flush>
        <ListaMas filas={filas} columnas={3} />
      </CajaResumen>
    </>
  );
}

/** De dónde salen los datos de la ficha (en palabras) y un enlace por registro oficial donde comprobarlos. */
export interface Fuentes {
  fuente: string;
  enlaces: ({ texto: string; href: string } | null | false | undefined)[];
}
