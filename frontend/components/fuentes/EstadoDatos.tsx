import { AlertTriangle, CheckCircle2, Clock, Hand } from "lucide-react";
import type { ReactNode } from "react";
import { API_BASE } from "@/lib/api-client";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Ayuda } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { fechaCorta } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * «Cómo están hoy» (fase 5 del plan del 2026-10-27): hasta qué fecha llega cada fuente, cuándo fue su última carga buena y
 * si está al día, atrasada, con error o se carga a mano (GET /estado/datos). Para que quien lee una cifra sepa hasta
 * cuándo llega. Server component; sin respuesta de la API, no se muestra (el resto de la página es estático).
 */
interface FuenteEstado {
  clave: string;
  nombre: string;
  que: string;
  cadencia: string;
  hasta: string | null;
  ultimaCarga: string | null;
  estado: "al_dia" | "atrasada" | "error" | "manual" | "fuente_vieja";
}

const ESTADO: Record<FuenteEstado["estado"], { texto: string; icono: ReactNode; clase: string }> = {
  al_dia: { texto: "Al día", icono: <CheckCircle2 size={14} aria-hidden />, clase: "border-mossTexto/30 text-mossTexto" },
  atrasada: { texto: "Atrasada", icono: <Clock size={14} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto" },
  error: { texto: "Falló la última carga", icono: <AlertTriangle size={14} aria-hidden />, clase: "border-crimsonTexto/40 text-crimsonTexto" },
  manual: { texto: "Se carga a mano", icono: <Hand size={14} aria-hidden />, clase: "border-line text-inkSoft" },
  fuente_vieja: { texto: "La fuente no publica hace meses", icono: <Clock size={14} aria-hidden />, clase: "border-amberTexto/40 text-amberTexto" },
};

export async function EstadoDatos() {
  let fuentes: FuenteEstado[] = [];
  try {
    const r = await fetch(`${API_BASE}/estado/datos`, { next: { revalidate: 600 } } as RequestInit);
    if (r.ok) fuentes = ((await r.json()) as { fuentes: FuenteEstado[] }).fuentes ?? [];
  } catch {
    fuentes = [];
  }
  if (!fuentes.length) return null;
  const columnas: Columna[] = [
    { clave: "fuente", titulo: "Fuente", ancho: "minmax(0,1fr)" },
    { clave: "hasta", titulo: "Sus datos llegan hasta", ancho: "9.5rem", alinear: "der", desde: "md", apilar: "con-rotulo", corto: "Llega hasta" },
    { clave: "estado", titulo: "Estado", ancho: "12rem", alinear: "der" },
  ];
  const filas: Fila[] = fuentes.map((f) => {
    const e = ESTADO[f.estado];
    return {
      id: f.clave,
      celdas: {
        fuente: (
          <CeldaPrincipal
            titulo={f.nombre}
            meta={[
              <span key="q">{f.que}</span>,
              <Dato key="c" tipo="fecha" nombre="Cada cuánto">{f.ultimaCarga ? `${f.cadencia}; última carga el ${fechaCorta(f.ultimaCarga)}` : f.cadencia}</Dato>,
            ]}
          />
        ),
        hasta: <CeldaNumero>{f.hasta ? fechaCorta(f.hasta) : "Sin dato"}</CeldaNumero>,
        estado: (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-rotulo font-semibold", e.clase)}>
            {e.icono}
            {e.texto}
          </span>
        ),
      },
    };
  });
  return (
    <section aria-labelledby="estado-datos" className="space-y-3">
      <div className="flex items-center gap-1">
        <h2 id="estado-datos" className="font-display text-bloque font-bold text-ink">
          Cómo están hoy
        </h2>
        <Ayuda titulo="¿Qué quiere decir cada estado?">
          <span className="block">«Al día»: su última carga automática salió bien dentro de lo que se espera (un día, una semana o un mes, según la fuente).</span>
          <span className="mt-2 block">«Atrasada»: no hay una carga buena reciente; sus datos pueden no tener lo último. «Falló la última carga»: se reintenta en la próxima.</span>
          <span className="mt-2 block">«La fuente no publica hace meses»: la carga sale bien, pero el registro oficial no trae nada de los últimos tres meses.</span>
          <span className="mt-2 block">«Se carga a mano»: el registro no responde fuera del Perú o no tiene una descarga automática; se actualiza desde una computadora en el Perú.</span>
        </Ayuda>
      </div>
      <p className="text-meta text-inkSoft">Hasta qué fecha llega cada registro y cuándo se actualizó por última vez. Una cifra de Vigía nunca va más allá de su fuente.</p>
      <Tabla columnas={columnas} filas={filas} etiqueta="Estado de cada fuente de datos" medida="contenedor" densidad="compacta" />
    </section>
  );
}
