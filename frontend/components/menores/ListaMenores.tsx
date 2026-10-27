import Link from "next/link";
import type { ReactNode } from "react";
import { FileSignature, FileText, ListFilter, Store } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { BarraFiltros, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type FiltroSecundario, type Fila, type Parametros } from "@/components/listado";
import { enSeccion } from "@/components/contratos/filtros";
import {
  BanderasAntecedentes,
  BloqueInhabilitacion,
  CeldaFechaCompra,
  EstadoCompra,
  ListaCargando,
  PERSONAS_PROVEEDOR,
  PaginadorHayMas,
  SinAntecedentes,
  antecedenteInhabilitado,
  datoFecha,
  filtroRuc,
  hrefConFiltro,
  hrefPagina,
  opcionesDe,
  type Antecedente,
} from "@/components/ordenes/ListaOrdenes";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { enlaceProveedor } from "@/lib/empresas";
import { fecha as fechaLarga, fechaCorta, oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  ANTECEDENTES_MENOR,
  MONTOS_MENOR,
  OBJETOS_MENOR,
  P_MEN,
  claveRegion,
  urlContratoMenor,
  urlRequerimiento,
  type ContratoMenor,
  type MenoresPagina,
} from "@/lib/menores";

/**
 * Lista de CONTRATOS MENORES (≤8 UIT) del SEACE (sección propia y, con filtro, ficha de empresa/entidad). Cada contrato
 * abre su panel con el requerimiento/TDR y el contrato en PDF (servidos por proxy de nuestra API).
 *
 * Fila de todo listado (§14.1): estado (chip) · qué se contrató, con entidad, proveedor, bien o servicio y código ·
 * antecedentes del proveedor (SUNAT y Tribunal de Contrataciones) · monto · suscrito. «Hasta 8 UIT, sin concurso» no
 * va en cada fila: lo son todos, por definición (lo dicen el título y su ⓘ); sí el monto que pasa ese tope. Las piezas
 * compartidas con Órdenes viven en components/ordenes.
 */

const FUENTE = "el SEACE";

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "112px", desde: "md", apilar: true },
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.8fr)" },
  {
    clave: "antecedentes", titulo: "Antecedentes del proveedor", corto: "Antecedentes", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué antecedentes se revisan aquí?">
        <span className="block">
          Lo que dice la SUNAT del proveedor: si hoy figura de baja o en suspensión, si es «no habido» (la SUNAT no lo ubica)
          o «no hallado» (no lo encontró al notificarlo), o si firmó con menos de 6 meses de haber empezado sus actividades.
        </span>
        <span className="mt-2 block">Y si el Tribunal de Contrataciones lo tenía inhabilitado el día en que firmó.</span>
        <span className="mt-2 block">Son datos para revisar, no prueban una irregularidad.</span>
      </Ayuda>
    ),
  },
  {
    clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Hasta cuánto es un contrato menor?">
        Hasta 8 UIT: S/ 44,000 en 2026 y S/ 42,800 en 2025 (la UIT de cada año). «Cerca del tope» es el 90 % o más de ese
        monto; uno que lo pasa puede ser un error de carga o una compra que debía ir por un proceso.
      </Ayuda>
    ),
  },
  { clave: "fecha", titulo: "Suscrito", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

/**
 * La barra de los contratos menores, por pregunta: a la vista el alcance (año, región), los antecedentes del proveedor y
 * si tiene el requerimiento; en «Filtros», qué (bien, servicio…), quién (entidad, proveedor, persona o empresa) y cuánto.
 * Cada opción con su conteo (la API cuenta cada filtro con los demás puestos). En la ficha de una empresa no van los
 * filtros del proveedor: es uno solo.
 */
export async function BarraMenoresGeneral({
  pagina,
  regiones = [],
  parametros = {},
  entidadNombre = null,
}: {
  pagina: Promise<MenoresPagina | null>;
  regiones?: string[];
  parametros?: Parametros;
  /** El nombre de la entidad filtrada, si la página lo buscó (para el chip cuando ningún contrato cumple los filtros). */
  entidadNombre?: string | null;
}) {
  const p = await pagina;
  const anios = p?.anios ?? [];
  const f = p?.facetas ?? null;
  const filas = p?.data ?? [];
  // Un solo proveedor (su ficha, o el filtro): sin los filtros del proveedor. Los chips de entidad y proveedor salen de
  // los parámetros de la lista general; las fichas no los pasan (ahí la entidad o el proveedor es la ficha misma).
  const deUnProveedor = p?.ancla === "proveedor";
  const entidad = parametros[P_MEN.entidad];
  const proveedor = parametros[P_MEN.proveedor];
  const nombreEntidad = entidad ? filas.find((m) => m.entidadRuc === entidad)?.entidad ?? entidadNombre : null;
  const nombreProveedor = proveedor ? filas.find((m) => m.proveedorRuc === proveedor)?.proveedor : null;
  const conteoRegion = (r: string) => (f?.region ? f.region[claveRegion(r)] ?? 0 : null);
  const filtros: FiltroSecundario[] = [
    ...enSeccion("Qué", { param: P_MEN.objeto, etiqueta: "Bien o servicio", todas: "Todo", opciones: opcionesDe(OBJETOS_MENOR, f?.objeto) }),
    ...enSeccion(
      "Quién",
      ...filtroRuc(P_MEN.entidad, "Entidad", "Toda entidad", entidad, nombreEntidad),
      ...filtroRuc(P_MEN.proveedor, "Proveedor", "Todo proveedor", proveedor, nombreProveedor),
      ...(deUnProveedor ? [] : [{ param: P_MEN.persona, etiqueta: "Tipo de proveedor", todas: "Personas y empresas", opciones: opcionesDe(PERSONAS_PROVEEDOR, f?.persona) }]),
    ),
    ...enSeccion("Cuánto", { param: P_MEN.monto, etiqueta: "Monto", todas: "Cualquier monto", opciones: opcionesDe(MONTOS_MENOR, f?.monto) }),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: P_MEN.q, placeholder: "Buscar por descripción, entidad, proveedor o código…", etiqueta: "Buscar en los contratos menores", min: 3 }}
      visibles={[
        { param: P_MEN.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a), conteo: f?.anio ? f.anio[String(a)] ?? 0 : null })) },
        ...(regiones.length
          ? [{ param: P_MEN.region, etiqueta: "Región", corta: "Región", todas: "Todo el país", opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r), conteo: conteoRegion(r) })) }]
          : []),
        ...(deUnProveedor
          ? []
          : [{ param: P_MEN.antecedente, etiqueta: "Antecedentes del proveedor", corta: "Antecedentes", todas: "Todos", opciones: opcionesDe(ANTECEDENTES_MENOR, f?.antecedente) }]),
        // Una sola opción: el kit lo dibuja como chip que se prende y se apaga, no como desplegable de una línea.
        {
          param: P_MEN.conReq, etiqueta: "Con requerimiento", corta: "Requerimiento", todas: "Todos",
          opciones: [{ valor: "si", etiqueta: "Con requerimiento (TDR)", conteo: f?.conReq ? f.conReq.si ?? 0 : null }],
        },
      ]}
      filtros={filtros}
      orden={{ param: P_MEN.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguos" }] }}
      // El estado del contrato llega sólo por enlace (casi todos dicen «Culminado»: un desplegable no distinguiría nada),
      // pero si viene se nombra y se puede quitar; antes filtraba sin que la barra lo dijera.
      chips={parametros[P_MEN.estado] ? [{ clave: P_MEN.estado, texto: `Estado: ${parametros[P_MEN.estado]}`, params: [P_MEN.estado] }] : []}
    />
  );
}

/** Mientras llega la página de contratos menores. */
export function ListaMenoresCargando() {
  return <ListaCargando texto="Cargando los contratos menores…" columnas={COLUMNAS} />;
}

// ─── Antecedentes del proveedor en la SUNAT ─────────────────────────────────────

/**
 * Un antecedente SUNAT: el `tipo` del catálogo de cruces (lib/cruces) cuando existe, el chip de la celda (corto y sin
 * género: el proveedor puede ser una persona o una empresa), lo que significa y la frase del panel (`titulo`).
 */
type AntecedenteSunat = Antecedente & { titulo: string };

/**
 * Las banderas SUNAT del proveedor (indicio, no acusación), con las mismas reglas que las del ganador de un contrato
 * (migraciones 116 y 118) y que el filtro «Antecedentes del proveedor» de la API: de baja o en suspensión (estado), no
 * habido o no hallado (condición) y firmar a menos de 180 días de iniciar actividades. Antes era un «⚠ proveedor» que no
 * decía cuál.
 */
function antecedentesSunat(m: ContratoMenor): AntecedenteSunat[] {
  const out: AntecedenteSunat[] = [];
  const estado = (m.provEstado ?? "").trim().toUpperCase();
  if (estado && estado !== "ACTIVO") {
    if (estado.startsWith("BAJA")) {
      out.push({
        tipo: "dada_de_baja", severidad: "media", chip: "De baja (SUNAT)", titulo: "De baja en la SUNAT",
        explica: `Hoy figura así en la SUNAT (${oracion(m.provEstado!)}). Es su estado actual: la SUNAT no publica desde cuándo, así que no se afirma que contratara estando de baja.`,
      });
    } else if (estado.startsWith("SUSPENSION")) {
      out.push({ tipo: "suspendida", severidad: "baja", chip: "En suspensión (SUNAT)", titulo: "En suspensión temporal", explica: "Hoy figura en suspensión temporal de actividades en la SUNAT." });
    } else {
      out.push({ tipo: "estado_sunat", severidad: "baja", chip: `${oracion(m.provEstado!)} (SUNAT)`, titulo: `${oracion(m.provEstado!)} en la SUNAT`, explica: "Su estado en la SUNAT no es «activo»." });
    }
  }
  const condicion = (m.provCondicion ?? "").trim().toUpperCase();
  if (condicion.startsWith("NO HABIDO")) {
    out.push({ tipo: "no_habida", severidad: "media", chip: "No habido (SUNAT)", titulo: "No habido", explica: "Hoy figura como «no habido» en la SUNAT: no lo ubica en su domicilio fiscal." });
  } else if (condicion.startsWith("NO HALLADO")) {
    out.push({ tipo: "no_hallado", severidad: "baja", chip: "No hallado (SUNAT)", titulo: "No hallado", explica: "La SUNAT no lo encontró en su domicilio fiscal al notificarlo (condición «no hallado»)." });
  }
  const dias = m.provDiasAlGanar;
  if (dias != null && dias >= 0 && dias < 180) {
    const meses = Math.floor(dias / 30);
    const cuando = meses === 0 ? "en su primer mes" : `a los ${meses} ${meses === 1 ? "mes" : "meses"}`;
    out.push({
      tipo: "recien_fundada_medio_ano", severidad: "media",
      chip: meses === 0 ? "Menos de 1 mes de actividad" : `${meses} ${meses === 1 ? "mes" : "meses"} de actividad`,
      titulo: "Firmó con menos de 6 meses de actividad",
      explica: `Firmó este contrato ${cuando} de iniciar actividades en la SUNAT${m.provDesde ? ` (el ${fechaLarga(m.provDesde)})` : ""}. No prueba nada por sí solo.`,
    });
  }
  return out;
}

// ─── La lista ─────────────────────────────────────────────────────────────────

/**
 * Sin ningún contrato menor (y sin filtros): por qué puede no haber. Cada ficha puede decir lo suyo (`vacia`). Sin la
 * llamita: sale en la ficha de una entidad o de una empresa (§2.3).
 */
const SIN_MENORES = (
  <EstadoVacio compacto conLlamita={false} titulo="Sin contratos menores registrados">
    El módulo de contratos menores del SEACE (hasta 8 UIT) es facultativo y se usa desde 2025: no todas las compras chicas
    pasan por él.
  </EstadoVacio>
);

export async function ListaMenores({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia = SIN_MENORES,
}: {
  pagina: Promise<MenoresPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  /** Lo que se muestra si no hay ninguno sin filtros puestos (no es lo mismo que «ninguno con estos filtros»). */
  vacia?: ReactNode;
}) {
  const pagina = await p;
  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar los contratos menores"
        // `<a>` y no `<Link>`: reintentar es pedir la misma página otra vez al servidor, con los mismos filtros.
        accion={<a href={hrefPagina(ruta, parametros, P_MEN.page, actual)} className={CLASE_ACCION_LISTA}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos. Si se repite, elige un año o acorta la búsqueda.
      </EstadoError>
    );
  }
  if (!pagina.data.length) {
    // Una página que ya no existe (la lista cambió o se escribió a mano): hay contratos, sólo que no tantos.
    if (actual > 1) {
      return (
        <EstadoVacio
          compacto
          titulo="Esta página de la lista ya no tiene contratos"
          accion={<Link href={hrefPagina(ruta, parametros, P_MEN.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
        />
      );
    }
    // Sólo cuentan los filtros de esta lista (no la pestaña, la vista ni el orden): sin ninguno, no hay datos, y decir
    // «con estos filtros» (Cambia el año…) mandaba a buscar un filtro que nadie puso.
    const filtrada = Object.entries(P_MEN).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param]);
    return filtrada ? <EstadoVacio compacto titulo="Ningún contrato menor con estos filtros">Cambia el año o la búsqueda, o quita un filtro.</EstadoVacio> : <>{vacia}</>;
  }
  // «Ver sólo los de esta entidad / de este proveedor»: sólo en la lista general (en una ficha la lista ya está anclada)
  // y para una empresa (el RUC 10 de una persona lleva su DNI: no va en un enlace).
  const enGeneral = ruta === "/app/contratos";
  const filas: Fila[] = pagina.data.map((m, i) => {
    const entidad = m.entidad ? tituloNatural(m.entidad) : null;
    const proveedor = m.proveedor ? tituloNatural(m.proveedor) : null;
    const descripcion = m.descripcion ? oracion(m.descripcion) : "Sin descripción";
    const objeto = objetoTxt(m.objeto);
    const cotiza = m.cotizaDesde && m.cotizaHasta ? `${fechaCorta(m.cotizaDesde)} – ${fechaCorta(m.cotizaHasta)}` : null;
    const sunat = antecedentesSunat(m);
    // Las banderas de la fila: lo de la SUNAT y, si el Tribunal lo tenía inhabilitado al firmar, eso (lo más grave).
    const antecedentes: Antecedente[] = [...(m.inhabilitacion ? [antecedenteInhabilitado(m.inhabilitacion, "Inhabilitado al firmar")] : []), ...sunat];
    const estado = <EstadoCompra estado={m.estado} />;
    // La ficha del proveedor (empresas, RUC 20): donde está lo que dice la SUNAT. No desde su propia ficha.
    const ficha = enlaceProveedor(m.proveedorRuc);
    const fichaProveedor = ficha && !ruta.startsWith(ficha.split("?")[0]) ? ficha : null;
    const soloEntidad = enGeneral && m.entidadRuc && parametros[P_MEN.entidad] !== m.entidadRuc
      ? hrefConFiltro(ruta, parametros, P_MEN.page, { [P_MEN.entidad]: m.entidadRuc }) : null;
    const soloProveedor = enGeneral && /^20\d{9}$/.test(m.proveedorRuc ?? "") && parametros[P_MEN.proveedor] !== m.proveedorRuc
      ? hrefConFiltro(ruta, parametros, P_MEN.page, { [P_MEN.proveedor]: m.proveedorRuc! }) : null;
    const items: (DatoClave | null)[] = [
      { etiqueta: "Qué se contrató", valor: descripcion },
      objeto ? { etiqueta: "Bien o servicio", valor: objeto } : null,
      { etiqueta: "Entidad", valor: entidad },
      { etiqueta: "Proveedor", valor: proveedor },
      m.provTipo ? { etiqueta: "Tipo de proveedor", valor: oracion(m.provTipo) } : null,
      m.provActividad ? { etiqueta: "Giro del proveedor", valor: oracion(m.provActividad) } : null,
      m.provDesde ? { etiqueta: "Proveedor desde", valor: fechaCorta(m.provDesde), mono: true } : null,
      datoFecha("Suscrito", m.fecha, FUENTE),
      {
        etiqueta: "Monto",
        valor: m.monto != null ? (m.sobreTope && m.tope ? `${soles(m.monto)}, más que el tope de 8 UIT de ese año (${soles(m.tope)})` : soles(m.monto)) : null,
        mono: true,
      },
      m.codigo ? { etiqueta: "Código", valor: m.codigo, mono: true } : null,
      m.estadoProceso ? { etiqueta: "Estado del proceso", valor: m.estadoProceso } : null,
      cotiza ? { etiqueta: "Pudo cotizarse", valor: cotiza, mono: true, ayuda: <AyudaTermino clave="cotizacion" /> } : null,
    ];
    return {
      id: `${m.id}`,
      celdas: {
        estado,
        contrato: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              objeto && <Dato key="objeto" tipo="tipo" nombre="Bien o servicio">{objeto}</Dato>,
              m.codigo && <Dato key="cod" tipo="codigo" nombre="Código del proceso" mono>{m.codigo}</Dato>,
            ]}
          />
        ),
        // Un proveedor que no está en el padrón cargado de la SUNAT no se pudo revisar: «Sin dato», no «Ninguno».
        antecedentes: antecedentes.length ? (
          <BanderasAntecedentes antecedentes={antecedentes} etiqueta="Antecedentes del proveedor" />
        ) : (
          <SinAntecedentes sinDato={m.provEstado == null && m.provCondicion == null && m.provDesde == null} />
        ),
        // Más que el tope de 8 UIT de su año: no debería existir un contrato menor así (o el monto está mal cargado).
        monto: <CeldaNumero sub={m.sobreTope ? "más de 8 UIT" : undefined}>{m.monto != null ? soles(m.monto) : "Sin dato"}</CeldaNumero>,
        fecha: <CeldaFechaCompra fecha={m.fecha} fuente={FUENTE} />,
      },
      detalle: {
        titulo: m.codigo ? `Contrato menor ${m.codigo}` : "Contrato menor",
        etiqueta: `Ver el detalle del contrato ${m.codigo ?? i}`,
        descripcion: entidad ?? undefined,
        contenido: (
          <CuerpoDetalle>
            <ChipsDetalle>
              {estado}
              {antecedentes.length > 0 && <BanderasAntecedentes antecedentes={antecedentes} etiqueta="Antecedentes del proveedor" todas />}
            </ChipsDetalle>
            <DatosClave items={items.filter(Boolean) as DatoClave[]} />
            {m.inhabilitacion && <BloqueInhabilitacion i={m.inhabilitacion} cuando={m.fecha ? `Firmó este contrato el ${fechaLarga(m.fecha)}` : "Firmó este contrato"} />}
            {sunat.length > 0 && (
              <BloqueDetalle titulo="Lo que dice la SUNAT del proveedor">
                <ul className="space-y-1.5">
                  {sunat.map((a) => (
                    <li key={a.tipo}>
                      <span className="font-semibold text-ink">{a.titulo}.</span> <span className="text-inkSoft">{a.explica}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-rotulo text-mute">Fuente: SUNAT, padrón de contribuyentes. Son datos para revisar, no una acusación.</p>
                {fichaProveedor && (
                  <EnlaceAccion href={fichaProveedor} prefetch={false} variante="secundario" flecha className="mt-3">
                    Ver la ficha de la empresa
                  </EnlaceAccion>
                )}
              </BloqueDetalle>
            )}
            {(m.tieneRequerimiento || m.tieneContrato) && (
              <BloqueDetalle titulo="Documentos">
                <div className="flex flex-wrap gap-2">
                  {m.tieneRequerimiento && (
                    <a href={urlRequerimiento(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                      <FileText className="size-4" aria-hidden /> Requerimiento (TDR)
                      <span className="sr-only"> (PDF, se abre en otra pestaña)</span>
                    </a>
                  )}
                  {m.tieneContrato && (
                    <a href={urlContratoMenor(m.id)} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                      <FileSignature className="size-4" aria-hidden /> Contrato u orden
                      <span className="sr-only"> (PDF, se abre en otra pestaña)</span>
                    </a>
                  )}
                </div>
              </BloqueDetalle>
            )}
            {(soloEntidad || soloProveedor) && (
              <div className="flex flex-wrap gap-2">
                {soloEntidad && (
                  <EnlaceAccion href={soloEntidad} prefetch={false} variante="secundario">
                    <ListFilter size={15} aria-hidden />
                    Ver sólo los de esta entidad
                  </EnlaceAccion>
                )}
                {soloProveedor && (
                  <EnlaceAccion href={soloProveedor} prefetch={false} variante="secundario">
                    <ListFilter size={15} aria-hidden />
                    Ver sólo los de este proveedor
                  </EnlaceAccion>
                )}
              </div>
            )}
          </CuerpoDetalle>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: SEACE — Buscador de Contratos del Estado (contrato) y buscador de procesos (requerimiento){m.codigo ? ` (${m.codigo})` : ""}</span>,
      },
    };
  });
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={P_MEN.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas} subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Contratos menores ≤ 8 UIT" />
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
