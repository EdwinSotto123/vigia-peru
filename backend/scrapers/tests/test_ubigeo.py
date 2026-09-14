"""Tests de `backend/scrapers/_core/ubigeo.py`: nombres OCDS (buyer.address) → ubigeo INEI."""

from backend.scrapers._core.ubigeo import ZonaIndex, norm, resolve_ubigeo

ROWS = [
    ("15", "departamento", "Lima", None), ("1501", "provincia", "Lima", "15"), ("150135", "distrito", "San Martin de Porres", "1501"),
    ("1505", "provincia", "Cañete", "15"), ("150501", "distrito", "San Vicente de Cañete", "1505"),
    ("06", "departamento", "Cajamarca", None), ("0611", "provincia", "San Ignacio", "06"), ("061106", "distrito", "Tabaconas", "0611"),
]


def idx() -> ZonaIndex:
    return ZonaIndex.from_rows(ROWS)


def test_distrito_exacto():
    assert resolve_ubigeo(idx(), "CAJAMARCA", "SAN IGNACIO", "TABACONAS") == "061106"


def test_tildes_y_mayusculas():
    assert resolve_ubigeo(idx(), "Lima", "CAÑETE", "SAN VICENTE DE CAÑETE") == "150501"


def test_sin_distrito_cae_a_provincia():
    assert resolve_ubigeo(idx(), "LIMA", "LIMA", None) == "1501"


def test_sin_provincia_cae_a_departamento():
    assert resolve_ubigeo(idx(), "LIMA", None, None) == "15"


def test_distrito_no_encontrado_cae_a_provincia():
    assert resolve_ubigeo(idx(), "LIMA", "LIMA", "DISTRITO INEXISTENTE") == "1501"


def test_nada():
    assert resolve_ubigeo(idx(), None, None, None) is None


def test_distrito_truncado_por_el_ocds_matchea_por_prefijo():
    # El OCDS del OECE corta locality a ~19 caracteres: 'SANTA CRUZ DE TOLED' (INEI: Santa Cruz de Toledo).
    ix = ZonaIndex.from_rows(ROWS + [("060506", "distrito", "Santa Cruz de Toledo", "0605"), ("0605", "provincia", "Contumaza", "06")])
    assert resolve_ubigeo(ix, "CAJAMARCA", "CONTUMAZA", "SANTA CRUZ DE TOLED") == "060506"


def test_prefijo_ambiguo_o_corto_no_adivina():
    ix = ZonaIndex.from_rows(ROWS + [("150136", "distrito", "San Miguel", "1501"), ("150137", "distrito", "San Martin de Porres Norte", "1501")])
    assert resolve_ubigeo(ix, "LIMA", "LIMA", "SAN M") == "1501"          # muy corto → provincia
    assert resolve_ubigeo(ix, "LIMA", "LIMA", "SAN MARTIN DE") == "1501"  # dos candidatos → provincia


def test_norm_quita_tildes_guiones_y_espacios():
    assert norm("  San   Martín-de Porres ") == "SAN MARTIN DE PORRES"
    assert norm(None) == ""
