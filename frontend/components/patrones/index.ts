/** Patrones reutilizables del producto (DESIGN_SYSTEM.md §11.3). */
export { EstadoVacio, EstadoError, Cargando, SinSenalesEstado } from "./Estados";
export { Pagina, EncabezadoPagina, Seccion, Cifra, EnlaceFuente, FuenteDato, Nota, Volver } from "./Estructura";
export { Ayuda } from "./Ayuda";
export { AyudaTermino } from "./AyudaTermino";
export { Pestanas, CabeceraPestana, irAPestana, type Pestana } from "./Pestanas";
export { PestanaAPedido } from "./PestanaAPedido";
export { Migas, type Miga } from "./Migas";
export { FichaNoLeida } from "./FichaNoLeida";
export { CuerpoDetalle, ChipsDetalle, DatosClave, BloqueDetalle, CitaDetalle, PieDetalle, type DatoClave } from "./Detalle";
export { TarjetaDatos } from "./TarjetaDatos";
export { BanderasFicha, type BanderaFicha } from "./BanderasFicha";
export { BarraCompartir } from "./Compartir";
export { Franja, Beneficios, type Beneficio } from "./Franja";
