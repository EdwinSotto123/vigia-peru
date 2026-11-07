/**
 * Lo del usuario que vive en el navegador (localStorage, con try/catch: en una ventana privada o sin espacio funciona en
 * memoria): sus búsquedas guardadas y el checklist de postulación de cada proceso. Lo que sigue, su etapa y sus notas
 * van en su cuenta (useSeguimiento.ts, la API de guardados), igual que en el tablero y el calendario.
 *
 * Puro salvo el almacenamiento, que se inyecta: así se prueba con un Map.
 */

export interface PerfilBusqueda {
  id: string;
  nombre: string;
  /** La búsqueda como URL, sin «?»: `q=toner&tipo=bienes`. */
  query: string;
  creado: string;
}

export interface EstadoUsuario {
  perfiles: PerfilBusqueda[];
  checklist: Record<string, string[]>;
}

export const VACIO: EstadoUsuario = { perfiles: [], checklist: {} };

export interface Guardado {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export class ErrorAlmacen extends Error {}

const CLAVE = "gobserva-app-v1";
export const LIMITE_PERFILES = 12;

const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function crearAlmacen(guardado: Guardado | null, reloj: () => Date = () => new Date()) {
  let estado: EstadoUsuario = VACIO;
  let cargado = false;
  const oyentes = new Set<() => void>();

  function cargar() {
    if (cargado) return;
    cargado = true;
    try {
      const t = guardado?.getItem(CLAVE);
      if (t) {
        const x = JSON.parse(t) as Partial<EstadoUsuario>;
        estado = { perfiles: x.perfiles ?? [], checklist: x.checklist ?? {} };
      }
    } catch {
      estado = VACIO;
    }
  }

  function poner(siguiente: EstadoUsuario) {
    estado = siguiente;
    try {
      guardado?.setItem(CLAVE, JSON.stringify(estado));
    } catch {
      // Sin espacio o sin permiso: sigue en memoria mientras dure la pestaña.
    }
    oyentes.forEach((o) => o());
  }

  const ahora = () => reloj().toISOString();

  return {
    leer(): EstadoUsuario {
      cargar();
      return estado;
    },
    suscribir(o: () => void) {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },

    guardarPerfil(nombre: string, query: string): PerfilBusqueda {
      cargar();
      const n = nombre.trim();
      if (n.length < 2) throw new ErrorAlmacen("Ponle un nombre de al menos 2 letras.");
      if (n.length > 60) throw new ErrorAlmacen("El nombre puede tener hasta 60 letras.");
      if (estado.perfiles.some((p) => p.nombre.toLowerCase() === n.toLowerCase())) throw new ErrorAlmacen("Ya tienes una búsqueda con ese nombre.");
      if (estado.perfiles.length >= LIMITE_PERFILES) throw new ErrorAlmacen(`Puedes guardar hasta ${LIMITE_PERFILES} búsquedas. Borra una para guardar esta.`);
      const p: PerfilBusqueda = { id: id(), nombre: n, query, creado: ahora() };
      poner({ ...estado, perfiles: [...estado.perfiles, p] });
      return p;
    },
    borrarPerfil(pid: string) {
      cargar();
      poner({ ...estado, perfiles: estado.perfiles.filter((p) => p.id !== pid) });
    },

    marcarRequisito(op: string, req: string, listo: boolean) {
      cargar();
      const actual = new Set(estado.checklist[op] ?? []);
      if (listo) actual.add(req);
      else actual.delete(req);
      poner({ ...estado, checklist: { ...estado.checklist, [op]: [...actual] } });
    },
  };
}

export type Almacen = ReturnType<typeof crearAlmacen>;
