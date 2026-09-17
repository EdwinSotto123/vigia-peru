"""Paquete de schemas (pydantic v2) de los agentes con juicio — partido por dominio desde
el antiguo schemas.py monolítico (1380 líneas) para que cada archivo quede bajo 800 líneas.
Compatibilidad 100%: cualquier `from agents._shared import schemas as S; S.X` sigue
funcionando igual, porque este __init__ re-exporta TODO lo que el original exponía."""

from pydantic import BaseModel

from .base import Estado, Severidad, SeveridadInfo, Confianza, CITA_MAX, Lista, Opcional, ESTADOS_OK, _Base, _Raiz, _BanderaBase, Evidencia, Hallazgo, NotaPrensa, coaccionar_evidencia, validar_o_descartar
from .legal import VectorLegal, OpinionOECE, RedFlagDocumental, PrincipioEval, CumplimientoPrincipios, Direccionamiento, CausalDirectaEval, LegalOutput
from .market import PrecioObservado, ProveedorPotencial, MarketFinding, MarketOutput
from .web import PersonaCargo, EmpresaPerfil, HallazgoFuente, ContratoEstado, HistorialResumido, RelacionProveedorEntidad, BanderaSugerida, WebResearchOutput
from .news import CategoriaNoticia, Noticia, ConteoSeveridad, BanderaPrensa, NewsOutput
from .entity import FuncionarioDesignado, ResolucionDesignacion, EntityPersonnelOutput
from .person import CargoEmpresa, CargoPublico, EmpresaVinculada, Candidatura, AporteCampana, RedSocial, PersonaPrincipal, Parentesco, ActividadPublica, Familiar, EmpresaRed, RedEmpresarial, TipoVinculoAutoridad, VinculoAutoridad, TipoRelacionFirmante, CruceFirmante, TipoLazoPostores, PostorRef, LazoPostores, BanderaRed, PersonNetworkOutput

OUTPUT_SCHEMAS: dict[str, type[BaseModel]] = {
    "document_legal_analyst": LegalOutput,
    "market": MarketOutput,
    "web_research": WebResearchOutput,
    "news_research": NewsOutput,
    "entity_personnel": EntityPersonnelOutput,
    "person_network": PersonNetworkOutput,
}

__all__ = [
    "Estado", "Severidad", "Confianza", "CITA_MAX", "Lista",
    "Evidencia", "Hallazgo", "coaccionar_evidencia",
    "LegalOutput", "RedFlagDocumental", "OpinionOECE", "CumplimientoPrincipios", "CausalDirectaEval",
    "MarketOutput", "MarketFinding", "PrecioObservado", "ProveedorPotencial",
    "WebResearchOutput", "EmpresaPerfil", "HallazgoFuente", "ContratoEstado", "BanderaSugerida", "NotaPrensa",
    "NewsOutput", "Noticia", "BanderaPrensa", "ConteoSeveridad",
    "EntityPersonnelOutput", "FuncionarioDesignado",
    "PersonNetworkOutput", "PersonaPrincipal", "Familiar", "CruceFirmante", "VinculoAutoridad", "LazoPostores", "BanderaRed",
    "validar_o_descartar", "OUTPUT_SCHEMAS",
]
