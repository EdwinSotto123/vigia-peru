import { FileText, FileSignature, Store, TriangleAlert } from "lucide-react";
import { AyudaTermino, DatosClave, EstadoVacio, type DatoClave } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fechaCorta, numero, oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { P_MEN, urlContratoMenor, urlRequerimiento, type MenoresPagina } from "@/lib/menores";

/**
 * Lista de CONTRATOS MENORES (≤8 UIT) del SEACE (sección propia y, con filtro, ficha de empresa/entidad). Cada contrato
 * abre su panel con el requerimiento/TDR y el contrato en PDF (servidos por proxy de nuestra API).
 */

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Suscrito", ancho: "92px", desde: "md", apilar: true },
  { clave: "contrato", titulo: "Contrato menor", ancho: "minmax(0,1.9fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(0,0.6fr)", desde: "lg", apilar: true },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der" },
];

const objetoTxt = (o: string | null) => (o && /bien/i.test(o) ? "Bien" : o && /servicio/i.test(o) ? "Servicio" : o ? tituloNatural(o) : null);

export async function BarraMenoresGeneral({ pagina, regiones = [] }: { pagina: Promise<MenoresPagina | null>; regiones?: string[] }) {
  const anios = (await pagina)?.anios ?? [];
  return (
    <BarraFiltros
      busqueda={{ param: P_MEN.q, placeholder: "Buscar por descripción, entidad, proveedor o código…", etiqueta: "Buscar en los contratos menores", min: 3 }}
      visibles={[
        { param: P_MEN.anio, etiqueta: "Año", corta: "Año", todas: "Todos", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a) })) },
        ...(regiones.length
          ? [{ param: P_MEN.region, etiqueta: "Región", corta: "Región", todas: "Todo el país", opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r) })) }]
          : []),
        {
          param: P_MEN.objeto, etiqueta: "Objeto", corta: "Objeto", todas: "Bien y servicio",
          opciones: [{ valor: "bien", etiqueta: "Bienes" }, { valor: "servicio", etiqueta: "Servicios" }],
        },
        {
          param: P_MEN.conReq, etiqueta: "Con requerimiento", corta: "Requerimiento", todas: "Todos",
          opciones: [{ valor: "si", etiqueta: "Con requerimiento (TDR)" }],
        },
      ]}
      orden={{ param: P_MEN.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguos" }] }}
    />
  );
}

function Pager({ ruta, parametros, actual, hayMas }: { ruta: string; parametros: Parametros; actual: number; hayMas: boolean }) {
  const href = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, String(v));
    if (page > 1) q.set(P_MEN.page, String(page)); else q.delete(P_MEN.page);
    const qs = q.toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const botón = "rounded-lg border border-line px-3 py-1.5 text-meta";
  return (
    <nav className="flex items-center gap-2" aria-label="Paginación de contratos menores">
      {actual > 1
        ? <a href={href(actual - 1)} className={`${botón} text-inkSoft transition-colors duration-rapido hover:text-ink`}>← Anterior</a>
        : <span className={`${botón} text-mute opacity-50`} aria-disabled>← Anterior</span>}
      <span className="text-rotulo text-mute">Página {numero(actual)}</span>
      {hayMas
        ? <a href={href(actual + 1)} className={`${botón} text-inkSoft transition-colors duration-rapido hover:text-ink`}>Siguiente →</a>
        : <span className={`${botón} text-mute opacity-50`} aria-disabled>Siguiente →</span>}
    </nav>
  );
}

const enlacePdf = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-meta text-inkSoft transition-colors duration-rapido hover:text-ink hover:border-ink/30";

export async function ListaMenores({ pagina: p, ruta, parametros, actual }: { pagina: Promise<MenoresPagina | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <EstadoVacio compacto titulo="No pudimos cargar los contratos menores">Probá con otro año o quita la búsqueda.</EstadoVacio>;
  if (!pagina.data.length) return <EstadoVacio compacto titulo="Ningún contrato menor con estos filtros">Cambia el año, el objeto o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((m, i) => {
    const entidad = m.entidad ? tituloNatural(m.entidad) : null;
    const proveedor = m.proveedor ? tituloNatural(m.proveedor) : null;
    const descripcion = m.descripcion ? oracion(m.descripcion) : "Sin descripción";
    const objeto = objetoTxt(m.objeto);
    const cotiza = m.cotizaDesde && m.cotizaHasta ? `${fechaCorta(m.cotizaDesde)} – ${fechaCorta(m.cotizaHasta)}` : null;
    // Banderas SUNAT del proveedor (indicio, no acusación): dado de baja/suspendido, no habido/no hallado, o recién creado al ganar.
    const provEstadoMal = m.provEstado && m.provEstado !== "ACTIVO" ? m.provEstado : null;
    const provCondMal = m.provCondicion && m.provCondicion !== "HABIDO" ? m.provCondicion : null;
    const mesesAlGanar = m.provDiasAlGanar != null && m.provDiasAlGanar >= 0 ? Math.round(m.provDiasAlGanar / 30) : null;
    const recienCreada = mesesAlGanar != null && mesesAlGanar < 6;
    const hayBanderaProv = !!(provEstadoMal || provCondMal || recienCreada);
    const items: (DatoClave | null)[] = [
      { etiqueta: "Qué se contrató", valor: descripcion },
      objeto ? { etiqueta: "Bien o servicio", valor: objeto } : null,
      { etiqueta: "Entidad", valor: entidad },
      { etiqueta: "Proveedor", valor: proveedor },
      m.provTipo ? { etiqueta: "Tipo de proveedor", valor: oracion(m.provTipo) } : null,
      m.provActividad ? { etiqueta: "Giro del proveedor", valor: oracion(m.provActividad) } : null,
      m.provDesde ? { etiqueta: "Proveedor desde", valor: fechaCorta(m.provDesde), mono: true } : null,
      { etiqueta: "Suscrito", valor: m.fecha ? fechaCorta(m.fecha) : null, mono: true },
      { etiqueta: "Monto", valor: m.monto != null ? soles(m.monto) : null, mono: true },
      m.codigo ? { etiqueta: "Código", valor: m.codigo, mono: true } : null,
      m.estadoProceso ? { etiqueta: "Estado del proceso", valor: m.estadoProceso } : null,
      cotiza ? { etiqueta: "Pudo cotizarse", valor: cotiza, mono: true, ayuda: <AyudaTermino clave="cotizacion" /> } : null,
    ];
    return {
      id: `${m.id}`,
      celdas: {
        fecha: <CeldaFecha fecha={m.fecha} />,
        contrato: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              objeto && <Dato key="objeto" tipo="tipo">{objeto}</Dato>,
              m.codigo && <Dato key="cod" tipo="codigo" nombre="Código del proceso" mono>{m.codigo}</Dato>,
            ]}
          />
        ),
        estado: (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-inkSoft">{m.estado ?? "Sin estado"}</span>
            {hayBanderaProv && (
              <span className="pill inline-flex items-center gap-1 border-amber/30 bg-amber-soft text-amberTexto">
                <TriangleAlert size={12} aria-hidden /> proveedor
              </span>
            )}
          </span>
        ),
        monto: <CeldaNumero sub="≤ 8 UIT, sin concurso">{m.monto != null ? soles(m.monto) : "Sin dato"}</CeldaNumero>,
      },
      detalle: {
        titulo: m.codigo ? `Contrato menor ${m.codigo}` : "Contrato menor",
        etiqueta: `Ver el detalle del contrato ${m.codigo ?? i}`,
        descripcion: entidad ?? undefined,
        contenido: (
          <div className="space-y-4">
            {hayBanderaProv && (
              <div role="note" className="flex gap-3 rounded-xl border border-amber/30 bg-amber-soft/60 p-3.5 text-dato text-ink">
                <TriangleAlert size={18} strokeWidth={2.25} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
                <span className="block">
                  {provCondMal && `El proveedor figura ${provCondMal} en SUNAT (no se le ubica). `}
                  {provEstadoMal && `El proveedor está en ${oracion(provEstadoMal)} en SUNAT. `}
                  {recienCreada && `Empezó actividades ${mesesAlGanar} ${mesesAlGanar === 1 ? "mes" : "meses"} antes de ganar este contrato. `}
                  Es un indicio para revisión humana, no una acusación.
                </span>
              </div>
            )}
            <DatosClave items={items.filter(Boolean) as DatoClave[]} />
            {(m.tieneRequerimiento || m.tieneContrato) && (
              <div className="flex flex-wrap gap-2">
                {m.tieneRequerimiento && (
                  <a href={urlRequerimiento(m.id)} target="_blank" rel="noopener noreferrer" className={enlacePdf}>
                    <FileText className="size-4" aria-hidden /> Requerimiento (TDR)
                  </a>
                )}
                {m.tieneContrato && (
                  <a href={urlContratoMenor(m.id)} target="_blank" rel="noopener noreferrer" className={enlacePdf}>
                    <FileSignature className="size-4" aria-hidden /> Contrato u orden
                  </a>
                )}
              </div>
            )}
          </div>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: SEACE — Buscador de Contratos del Estado (contrato) y buscador de procesos (requerimiento){m.codigo ? ` (${m.codigo})` : ""}</span>,
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">Contratos menores{pagina.anio ? ` de ${pagina.anio}` : ""}</p>
        <Pager ruta={ruta} parametros={parametros} actual={actual} hayMas={pagina.hayMas} />
      </div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Contratos menores ≤ 8 UIT" />
      <div className="flex justify-end">
        <Pager ruta={ruta} parametros={parametros} actual={actual} hayMas={pagina.hayMas} />
      </div>
    </div>
  );
}
