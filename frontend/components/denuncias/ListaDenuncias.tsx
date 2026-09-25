import type { ReactNode } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, Clock } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import type { ApiReporte } from "@/lib/api-client";
import { CATEGORIA_META, estaConfirmada, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { maskDnis } from "@/lib/privacidad";
import { cn } from "@/lib/utils";
import { MiniaturaDenuncia } from "./MiniaturaDenuncia";
import { diaDeDenuncia } from "./fechaDenuncia";
import { Separador } from "@/components/ui/Partes";

/**
 * Las denuncias sobre la plantilla Listado (§14.1): la `Tabla` compartida con la
 * anatomía de fila de todos los listados —categoría (chip) · lo que se reportó y
 * dónde · fecha · estado (chip) · ›— y la ficha completa en su página.
 *
 * El relato va en UNA línea y con los DNI enmascarados (§10.6: nunca un DNI en claro
 * en un listado). `maskDnis`, texto plano, y no el vidrio revelable: la fila entera es
 * un enlace y un botón dentro de un enlace no se puede usar. El vidrio está en la ficha.
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

const COLUMNAS: Columna[] = [
  { clave: "categoria", titulo: "Categoría", ancho: "196px", desde: "md" },
  { clave: "denuncia", titulo: "Lo que se reportó", ancho: "minmax(0,1fr)" },
  { clave: "fecha", titulo: "Reportada", ancho: "96px", desde: "md" },
  { clave: "estado", titulo: "Estado", ancho: "124px" },
];

/** La acción de un estado vacío o de error: un enlace con forma de píldora secundaria. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

interface Props {
  /** Las filas de esta página, ya filtradas. */
  reportes: ApiReporte[];
  /** Cuántas cumplen los filtros (no el tamaño de esta página). */
  total: number;
  pagina: number;
  tam: number;
  /** Parámetros de la URL sin la página, para los enlaces de la paginación. */
  parametros: Record<string, string | undefined>;
  /** Búsqueda activa: cambia el mensaje del vacío. */
  q?: string;
  /** El API no respondió: se dice, no se rellena con nada. */
  fallo: boolean;
  /** Enlace a esta misma vista, para reintentar. */
  aqui: string;
  /** Aviso de una línea bajo la tabla (qué cubre la búsqueda). */
  aviso?: ReactNode;
}

export function ListaDenuncias({ reportes, total, pagina, tam, parametros, q, fallo, aqui, aviso }: Props) {
  if (fallo) {
    return (
      <EstadoError titulo="No pudimos leer las denuncias" accion={<Link href={aqui} className={ACCION}>Reintentar</Link>}>
        El servidor de Vigía no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (total === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={q ? `Ninguna denuncia coincide con «${q}»` : "Ninguna denuncia coincide con esos filtros"}
        accion={<Link href="/app/denuncias" className={ACCION}>Quitar los filtros</Link>}
      >
        {aviso ?? "Prueba quitando el último filtro que agregaste."}
      </EstadoVacio>
    );
  }
  if (reportes.length === 0) {
    return (
      <EstadoVacio titulo="Esta página no tiene denuncias" compacto accion={<Link href={hrefDenuncias(parametros)} className={ACCION}>Ir a la página 1</Link>}>
        La lista llega hasta una página anterior.
      </EstadoVacio>
    );
  }

  const filas: Fila[] = reportes.map((r) => {
    const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
    const etiqueta = meta?.label ?? "Denuncia";
    // §10.6: DNI enmascarados también en el `title`, que el navegador muestra tal cual.
    const relato = maskDnis(r.descripcion) || "Sin descripción";
    return {
      id: r.id,
      href: `/app/denuncias/${r.id}`,
      celdas: {
        categoria: <ChipCategoria categoria={r.categoria} />,
        denuncia: (
          <span className="flex w-full min-w-0 items-center gap-3">
            <MiniaturaDenuncia src={r.fotoUrl ?? null} />
            <CeldaPrincipal
              className="flex-1"
              titulo={relato}
              meta={
                <>
                  {/* En el celular la categoría no tiene columna: va aquí. */}
                  <span className="md:hidden">
                    {etiqueta}
                    <Separador />
                  </span>
                  {r.region || "Sin región"}
                  <span className="hidden md:inline">
                    <Separador />
                    <span className="font-mono" translate="no">
                      {r.id}
                    </span>
                  </span>
                </>
              }
            />
          </span>
        ),
        fecha: <CeldaFecha fecha={diaDeDenuncia(r.fecha)} />,
        estado: <ChipEstado confirmada={estaConfirmada(r)} />,
      },
    };
  });

  const pag = (
    <Paginacion
      actual={pagina}
      paginas={Math.max(1, Math.ceil(total / tam))}
      total={total}
      tam={tam}
      navegacion="url"
      hrefBase="/app/denuncias"
      query={parametros}
      cargando={false}
      nombre="denuncias"
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Denuncias de vecinos" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {aviso ? <p className="inline-flex items-center gap-1 text-[12.5px] text-mute">{aviso}</p> : <span />}
        {pag}
      </div>
    </div>
  );
}

/** La categoría, con su ícono y su tono (los de lib/denuncias-meta). */
function ChipCategoria({ categoria }: { categoria: string }) {
  const meta = CATEGORIA_META[categoria as CategoriaDenuncia];
  const Icono = meta?.icon ?? Camera;
  return (
    <span className={cn("pill max-w-full", meta?.tone ?? "border-line bg-paperSoft text-ink")}>
      <Icono size={11} className="shrink-0" aria-hidden />
      <span className="truncate">{meta?.label ?? "Denuncia"}</span>
    </span>
  );
}

/** Confirmada = la respaldan dos o más reportes independientes (`estaConfirmada`). */
function ChipEstado({ confirmada }: { confirmada: boolean }) {
  return confirmada ? (
    <span className="pill border-moss/30 bg-moss/10 font-semibold text-mossTexto">
      <CheckCircle2 size={11} aria-hidden /> Confirmada
    </span>
  ) : (
    <span className="pill border-line bg-paperDeep text-inkSoft">
      <Clock size={11} aria-hidden /> Sin confirmar
    </span>
  );
}

/** `/app/denuncias` con estos parámetros (sin página: vuelve a la 1). */
export function hrefDenuncias(parametros: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `/app/denuncias?${qs}` : "/app/denuncias";
}
