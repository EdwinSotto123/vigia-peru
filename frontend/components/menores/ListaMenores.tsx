import Link from "next/link";
import { FileSignature, FileText, Store } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { BarraFiltros, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila, type Parametros } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import {
  CeldaFechaCompra,
  EstadoCompra,
  ListaCargando,
  PaginadorHayMas,
  SinAntecedentes,
  datoFecha,
  hrefPagina,
} from "@/components/ordenes/ListaOrdenes";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { enlaceProveedor } from "@/lib/empresas";
import { fecha as fechaLarga, fechaCorta, oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { P_MEN, urlContratoMenor, urlRequerimiento, type ContratoMenor, type MenoresPagina } from "@/lib/menores";

/**
 * Lista de CONTRATOS MENORES (≤8 UIT) del SEACE (sección propia y, con filtro, ficha de empresa/entidad). Cada contrato
 * abre su panel con el requerimiento/TDR y el contrato en PDF (servidos por proxy de nuestra API).
 *
 * Fila de todo listado (§14.1): estado (chip) · qué se contrató, con entidad, proveedor, bien o servicio y código ·
 * antecedentes del proveedor en la SUNAT · monto · suscrito. «Hasta 8 UIT, sin concurso» no va en cada fila: lo son
 * todos, por definición (lo dicen el título y su ⓘ). Las piezas compartidas con Órdenes viven en components/ordenes.
 */

const FUENTE = "el SEACE";

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "112px", desde: "md", apilar: true },
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.8fr)" },
  {
    clave: "antecedentes", titulo: "Antecedentes del proveedor", corto: "Antecedentes", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué antecedentes se revisan aquí?">
        Lo que dice la SUNAT del proveedor: si hoy figura de baja o en suspensión, si es «no habido» o «no hallado», o si
        firmó con menos de 6 meses de haber empezado sus actividades. Son datos para revisar, no prueban una irregularidad.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Suscrito", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

export async function BarraMenoresGeneral({ pagina, regiones = [] }: { pagina: Promise<MenoresPagina | null>; regiones?: string[] }) {
  const anios = (await pagina)?.anios ?? [];
  return (
    <BarraFiltros
      busqueda={{ param: P_MEN.q, placeholder: "Buscar por descripción, entidad, proveedor o código…", etiqueta: "Buscar en los contratos menores", min: 3 }}
      visibles={[
        { param: P_MEN.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a) })) },
        ...(regiones.length
          ? [{ param: P_MEN.region, etiqueta: "Región", corta: "Región", todas: "Todo el país", opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r) })) }]
          : []),
        {
          param: P_MEN.objeto, etiqueta: "Bien o servicio", corta: "Bien o servicio", todas: "Bienes y servicios",
          opciones: [{ valor: "bien", etiqueta: "Bienes" }, { valor: "servicio", etiqueta: "Servicios" }],
        },
        // Una sola opción: el kit lo dibuja como chip que se prende y se apaga, no como desplegable de una línea.
        {
          param: P_MEN.conReq, etiqueta: "Con requerimiento", corta: "Requerimiento", todas: "Todos",
          opciones: [{ valor: "si", etiqueta: "Con requerimiento (TDR)" }],
        },
      ]}
      orden={{ param: P_MEN.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguos" }] }}
    />
  );
}

/** Mientras llega la página de contratos menores. */
export function ListaMenoresCargando() {
  return <ListaCargando texto="Cargando los contratos menores…" columnas={COLUMNAS} />;
}

// ─── Antecedentes del proveedor en la SUNAT ─────────────────────────────────────

interface Antecedente {
  /** El tipo del catálogo de cruces (lib/cruces) cuando existe: su explicación va en el `title` del chip. */
  tipo: string;
  severidad: "alta" | "media" | "baja";
  /** El chip de la celda: corto y sin género (el proveedor puede ser una persona o una empresa). */
  chip: string;
  /** La frase del panel. */
  titulo: string;
  explica: string;
}

/**
 * Las banderas SUNAT del proveedor (indicio, no acusación), con las mismas reglas que las del ganador de un contrato
 * (migraciones 116 y 118): de baja o en suspensión (estado), no habido o no hallado (condición) y firmar a menos de 180
 * días de iniciar actividades. Antes era un «⚠ proveedor» que no decía cuál.
 */
function antecedentesSunat(m: ContratoMenor): Antecedente[] {
  const out: Antecedente[] = [];
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

/** Los antecedentes como banderas, en la celda y en los chips del panel: las de toda lista (CrucesCelda). */
function BanderasSunat({ antecedentes }: { antecedentes: Antecedente[] }) {
  return (
    <CrucesCelda
      cruces={antecedentes.map((a) => ({ tipo: a.tipo, severidad: a.severidad }))}
      etiquetas={Object.fromEntries(antecedentes.map((a) => [a.tipo, a.chip]))}
      explicaciones={Object.fromEntries(antecedentes.map((a) => [a.tipo, a.explica]))}
      etiquetaLista="Antecedentes del proveedor"
    />
  );
}

// ─── La lista ─────────────────────────────────────────────────────────────────

export async function ListaMenores({ pagina: p, ruta, parametros, actual }: { pagina: Promise<MenoresPagina | null>; ruta: string; parametros: Parametros; actual: number }) {
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
    return actual > 1 ? (
      <EstadoVacio
        compacto
        titulo="Esta página de la lista ya no tiene contratos"
        accion={<Link href={hrefPagina(ruta, parametros, P_MEN.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
      />
    ) : (
      <EstadoVacio compacto titulo="Ningún contrato menor con estos filtros">Cambia el año, el bien o servicio o la búsqueda.</EstadoVacio>
    );
  }
  const filas: Fila[] = pagina.data.map((m, i) => {
    const entidad = m.entidad ? tituloNatural(m.entidad) : null;
    const proveedor = m.proveedor ? tituloNatural(m.proveedor) : null;
    const descripcion = m.descripcion ? oracion(m.descripcion) : "Sin descripción";
    const objeto = objetoTxt(m.objeto);
    const cotiza = m.cotizaDesde && m.cotizaHasta ? `${fechaCorta(m.cotizaDesde)} – ${fechaCorta(m.cotizaHasta)}` : null;
    const antecedentes = antecedentesSunat(m);
    const estado = <EstadoCompra estado={m.estado} />;
    // La ficha del proveedor (empresas, RUC 20): donde está lo que dice la SUNAT. No desde su propia ficha.
    const ficha = enlaceProveedor(m.proveedorRuc);
    const fichaProveedor = ficha && !ruta.startsWith(ficha.split("?")[0]) ? ficha : null;
    const items: (DatoClave | null)[] = [
      { etiqueta: "Qué se contrató", valor: descripcion },
      objeto ? { etiqueta: "Bien o servicio", valor: objeto } : null,
      { etiqueta: "Entidad", valor: entidad },
      { etiqueta: "Proveedor", valor: proveedor },
      m.provTipo ? { etiqueta: "Tipo de proveedor", valor: oracion(m.provTipo) } : null,
      m.provActividad ? { etiqueta: "Giro del proveedor", valor: oracion(m.provActividad) } : null,
      m.provDesde ? { etiqueta: "Proveedor desde", valor: fechaCorta(m.provDesde), mono: true } : null,
      datoFecha("Suscrito", m.fecha, FUENTE),
      { etiqueta: "Monto", valor: m.monto != null ? soles(m.monto) : null, mono: true },
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
          <BanderasSunat antecedentes={antecedentes} />
        ) : (
          <SinAntecedentes sinDato={m.provEstado == null && m.provCondicion == null && m.provDesde == null} />
        ),
        monto: <CeldaNumero>{m.monto != null ? soles(m.monto) : "Sin dato"}</CeldaNumero>,
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
              {antecedentes.length > 0 && <BanderasSunat antecedentes={antecedentes} />}
            </ChipsDetalle>
            <DatosClave items={items.filter(Boolean) as DatoClave[]} />
            {antecedentes.length > 0 && (
              <BloqueDetalle titulo="Lo que dice la SUNAT del proveedor">
                <ul className="space-y-1.5">
                  {antecedentes.map((a) => (
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
