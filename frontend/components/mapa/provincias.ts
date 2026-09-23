/**
 * Las provincias del Perú: nombre normalizado → ubigeo INEI de 4 dígitos.
 *
 * GENERADO desde `public/peru-provinces.json` (el mismo geojson que dibuja el
 * mapa), así que la llave con la que se cuenta una señal y el polígono sobre el
 * que se dibuja son la misma. Los dos primeros dígitos del código son el
 * departamento. Para regenerarlo: normalizar `properties.name` (sin tildes, sin
 * espacios, minúsculas) y volcar `properties.code`. El geojson trae dos
 * polígonos con el nombre mal escrito ("Puira", "Victor Fafardo") que comparten
 * código con su provincia: quedan como alias, no como provincias aparte.
 */
export const PROVINCIA_UBIGEO: Readonly<Record<string, string>> = {
  "chachapoyas": "0101", // Chachapoyas
  "bagua": "0102", // Bagua
  "bongara": "0103", // Bongara
  "condorcanqui": "0104", // Condorcanqui
  "luya": "0105", // Luya
  "rodriguezdemendoza": "0106", // Rodriguez De Mendoza
  "utcubamba": "0107", // Utcubamba
  "huaraz": "0201", // Huaraz
  "aija": "0202", // Aija
  "antonioraymondi": "0203", // Antonio Raymondi
  "asuncion": "0204", // Asuncion
  "bolognesi": "0205", // Bolognesi
  "carhuaz": "0206", // Carhuaz
  "carlosferminfitzcarrald": "0207", // Carlos Fermin Fitzcarrald
  "casma": "0208", // Casma
  "corongo": "0209", // Corongo
  "huari": "0210", // Huari
  "huarmey": "0211", // Huarmey
  "huaylas": "0212", // Huaylas
  "mariscalluzuriaga": "0213", // Mariscal Luzuriaga
  "ocros": "0214", // Ocros
  "pallasca": "0215", // Pallasca
  "pomabamba": "0216", // Pomabamba
  "recuay": "0217", // Recuay
  "santa": "0218", // Santa
  "sihuas": "0219", // Sihuas
  "yungay": "0220", // Yungay
  "abancay": "0301", // Abancay
  "andahuaylas": "0302", // Andahuaylas
  "antabamba": "0303", // Antabamba
  "aymaraes": "0304", // Aymaraes
  "cotabambas": "0305", // Cotabambas
  "chincheros": "0306", // Chincheros
  "grau": "0307", // Grau
  "arequipa": "0401", // Arequipa
  "camana": "0402", // Camana
  "caraveli": "0403", // Caraveli
  "castilla": "0404", // Castilla
  "caylloma": "0405", // Caylloma
  "condesuyos": "0406", // Condesuyos
  "islay": "0407", // Islay
  "launion": "0408", // La Union
  "huamanga": "0501", // Huamanga
  "cangallo": "0502", // Cangallo
  "huancasancos": "0503", // Huanca Sancos
  "huanta": "0504", // Huanta
  "lamar": "0505", // La Mar
  "lucanas": "0506", // Lucanas
  "parinacochas": "0507", // Parinacochas
  "paucardelsarasara": "0508", // Paucar Del Sara Sara
  "sucre": "0509", // Sucre
  "victorfafardo": "0510", // Victor Fafardo
  "victorfajardo": "0510", // Victor Fajardo
  "vilcashuaman": "0511", // Vilcas Huaman
  "cajamarca": "0601", // Cajamarca
  "cajabamba": "0602", // Cajabamba
  "celendin": "0603", // Celendin
  "chota": "0604", // Chota
  "contumaza": "0605", // Contumaza
  "cutervo": "0606", // Cutervo
  "hualgayoc": "0607", // Hualgayoc
  "jaen": "0608", // Jaen
  "sanignacio": "0609", // San Ignacio
  "sanmarcos": "0610", // San Marcos
  "sanmiguel": "0611", // San Miguel
  "sanpablo": "0612", // San Pablo
  "santacruz": "0613", // Santa Cruz
  "callao": "0701", // Callao
  "cusco": "0801", // Cusco
  "acomayo": "0802", // Acomayo
  "anta": "0803", // Anta
  "calca": "0804", // Calca
  "canas": "0805", // Canas
  "canchis": "0806", // Canchis
  "chumbivilcas": "0807", // Chumbivilcas
  "espinar": "0808", // Espinar
  "laconvencion": "0809", // La Convencion
  "paruro": "0810", // Paruro
  "paucartambo": "0811", // Paucartambo
  "quispicanchi": "0812", // Quispicanchi
  "urubamba": "0813", // Urubamba
  "huancavelica": "0901", // Huancavelica
  "acobamba": "0902", // Acobamba
  "angaraes": "0903", // Angaraes
  "castrovirreyna": "0904", // Castrovirreyna
  "churcampa": "0905", // Churcampa
  "huaytara": "0906", // Huaytara
  "tayacaja": "0907", // Tayacaja
  "huanuco": "1001", // Huanuco
  "ambo": "1002", // Ambo
  "dosdemayo": "1003", // Dos De Mayo
  "huacaybamba": "1004", // Huacaybamba
  "huamalies": "1005", // Huamalies
  "leoncioprado": "1006", // Leoncio Prado
  "maranon": "1007", // Marañon
  "pachitea": "1008", // Pachitea
  "puertoinca": "1009", // Puerto Inca
  "lauricocha": "1010", // Lauricocha
  "yarowilca": "1011", // Yarowilca
  "ica": "1101", // Ica
  "chincha": "1102", // Chincha
  "nazca": "1103", // Nazca
  "palpa": "1104", // Palpa
  "pisco": "1105", // Pisco
  "huancayo": "1201", // Huancayo
  "concepcion": "1202", // Concepcion
  "chanchamayo": "1203", // Chanchamayo
  "jauja": "1204", // Jauja
  "junin": "1205", // Junin
  "satipo": "1206", // Satipo
  "tarma": "1207", // Tarma
  "yauli": "1208", // Yauli
  "chupaca": "1209", // Chupaca
  "trujillo": "1301", // Trujillo
  "ascope": "1302", // Ascope
  "bolivar": "1303", // Bolivar
  "chepen": "1304", // Chepen
  "julcan": "1305", // Julcan
  "otuzco": "1306", // Otuzco
  "pacasmayo": "1307", // Pacasmayo
  "pataz": "1308", // Pataz
  "sanchezcarrion": "1309", // Sanchez Carrion
  "santiagodechuco": "1310", // Santiago De Chuco
  "granchimu": "1311", // Gran Chimu
  "viru": "1312", // Viru
  "chiclayo": "1401", // Chiclayo
  "ferrenafe": "1402", // Ferreñafe
  "lambayeque": "1403", // Lambayeque
  "lima": "1501", // Lima
  "barranca": "1502", // Barranca
  "cajatambo": "1503", // Cajatambo
  "canta": "1504", // Canta
  "canete": "1505", // Cañete
  "huaral": "1506", // Huaral
  "huarochiri": "1507", // Huarochiri
  "huaura": "1508", // Huaura
  "oyon": "1509", // Oyon
  "yauyos": "1510", // Yauyos
  "maynas": "1601", // Maynas
  "altoamazonas": "1602", // Alto Amazonas
  "loreto": "1603", // Loreto
  "mariscalramoncastilla": "1604", // Mariscal Ramon Castilla
  "requena": "1605", // Requena
  "ucayali": "1606", // Ucayali
  "datemdelmaranon": "1607", // Datem Del Marañon
  "tambopata": "1701", // Tambopata
  "manu": "1702", // Manu
  "tahuamanu": "1703", // Tahuamanu
  "mariscalnieto": "1801", // Mariscal Nieto
  "generalsanchezcerro": "1802", // General Sanchez Cerro
  "ilo": "1803", // Ilo
  "pasco": "1901", // Pasco
  "danielalcidescarrion": "1902", // Daniel Alcides Carrion
  "oxapampa": "1903", // Oxapampa
  "piura": "2001", // Piura
  "puira": "2001", // Puira
  "ayabaca": "2002", // Ayabaca
  "huancabamba": "2003", // Huancabamba
  "morropon": "2004", // Morropon
  "paita": "2005", // Paita
  "sullana": "2006", // Sullana
  "talara": "2007", // Talara
  "sechura": "2008", // Sechura
  "puno": "2101", // Puno
  "azangaro": "2102", // Azangaro
  "carabaya": "2103", // Carabaya
  "chucuito": "2104", // Chucuito
  "elcollao": "2105", // El Collao
  "huancane": "2106", // Huancane
  "lampa": "2107", // Lampa
  "melgar": "2108", // Melgar
  "moho": "2109", // Moho
  "sanantoniodeputina": "2110", // San Antonio De Putina
  "sanroman": "2111", // San Roman
  "sandia": "2112", // Sandia
  "yunguyo": "2113", // Yunguyo
  "moyobamba": "2201", // Moyobamba
  "bellavista": "2202", // Bellavista
  "eldorado": "2203", // El Dorado
  "huallaga": "2204", // Huallaga
  "lamas": "2205", // Lamas
  "mariscalcaceres": "2206", // Mariscal Caceres
  "picota": "2207", // Picota
  "rioja": "2208", // Rioja
  "sanmartin": "2209", // San Martin
  "tocache": "2210", // Tocache
  "tacna": "2301", // Tacna
  "candarave": "2302", // Candarave
  "jorgebasadre": "2303", // Jorge Basadre
  "tarata": "2304", // Tarata
  "tumbes": "2401", // Tumbes
  "contralmirantevillar": "2402", // Contralmirante Villar
  "zarumilla": "2403", // Zarumilla
  "coronelportillo": "2501", // Coronel Portillo
  "atalaya": "2502", // Atalaya
  "padreabad": "2503", // Padre Abad
  "purus": "2504", // Purus
};

/** Nombre para mostrar de cada provincia (el del geojson). */
export const PROVINCIA_NOMBRE: Readonly<Record<string, string>> = {
  "0101": "Chachapoyas",
  "0102": "Bagua",
  "0103": "Bongara",
  "0104": "Condorcanqui",
  "0105": "Luya",
  "0106": "Rodriguez De Mendoza",
  "0107": "Utcubamba",
  "0201": "Huaraz",
  "0202": "Aija",
  "0203": "Antonio Raymondi",
  "0204": "Asuncion",
  "0205": "Bolognesi",
  "0206": "Carhuaz",
  "0207": "Carlos Fermin Fitzcarrald",
  "0208": "Casma",
  "0209": "Corongo",
  "0210": "Huari",
  "0211": "Huarmey",
  "0212": "Huaylas",
  "0213": "Mariscal Luzuriaga",
  "0214": "Ocros",
  "0215": "Pallasca",
  "0216": "Pomabamba",
  "0217": "Recuay",
  "0218": "Santa",
  "0219": "Sihuas",
  "0220": "Yungay",
  "0301": "Abancay",
  "0302": "Andahuaylas",
  "0303": "Antabamba",
  "0304": "Aymaraes",
  "0305": "Cotabambas",
  "0306": "Chincheros",
  "0307": "Grau",
  "0401": "Arequipa",
  "0402": "Camana",
  "0403": "Caraveli",
  "0404": "Castilla",
  "0405": "Caylloma",
  "0406": "Condesuyos",
  "0407": "Islay",
  "0408": "La Union",
  "0501": "Huamanga",
  "0502": "Cangallo",
  "0503": "Huanca Sancos",
  "0504": "Huanta",
  "0505": "La Mar",
  "0506": "Lucanas",
  "0507": "Parinacochas",
  "0508": "Paucar Del Sara Sara",
  "0509": "Sucre",
  "0510": "Victor Fajardo",
  "0511": "Vilcas Huaman",
  "0601": "Cajamarca",
  "0602": "Cajabamba",
  "0603": "Celendin",
  "0604": "Chota",
  "0605": "Contumaza",
  "0606": "Cutervo",
  "0607": "Hualgayoc",
  "0608": "Jaen",
  "0609": "San Ignacio",
  "0610": "San Marcos",
  "0611": "San Miguel",
  "0612": "San Pablo",
  "0613": "Santa Cruz",
  "0701": "Callao",
  "0801": "Cusco",
  "0802": "Acomayo",
  "0803": "Anta",
  "0804": "Calca",
  "0805": "Canas",
  "0806": "Canchis",
  "0807": "Chumbivilcas",
  "0808": "Espinar",
  "0809": "La Convencion",
  "0810": "Paruro",
  "0811": "Paucartambo",
  "0812": "Quispicanchi",
  "0813": "Urubamba",
  "0901": "Huancavelica",
  "0902": "Acobamba",
  "0903": "Angaraes",
  "0904": "Castrovirreyna",
  "0905": "Churcampa",
  "0906": "Huaytara",
  "0907": "Tayacaja",
  "1001": "Huanuco",
  "1002": "Ambo",
  "1003": "Dos De Mayo",
  "1004": "Huacaybamba",
  "1005": "Huamalies",
  "1006": "Leoncio Prado",
  "1007": "Marañon",
  "1008": "Pachitea",
  "1009": "Puerto Inca",
  "1010": "Lauricocha",
  "1011": "Yarowilca",
  "1101": "Ica",
  "1102": "Chincha",
  "1103": "Nazca",
  "1104": "Palpa",
  "1105": "Pisco",
  "1201": "Huancayo",
  "1202": "Concepcion",
  "1203": "Chanchamayo",
  "1204": "Jauja",
  "1205": "Junin",
  "1206": "Satipo",
  "1207": "Tarma",
  "1208": "Yauli",
  "1209": "Chupaca",
  "1301": "Trujillo",
  "1302": "Ascope",
  "1303": "Bolivar",
  "1304": "Chepen",
  "1305": "Julcan",
  "1306": "Otuzco",
  "1307": "Pacasmayo",
  "1308": "Pataz",
  "1309": "Sanchez Carrion",
  "1310": "Santiago De Chuco",
  "1311": "Gran Chimu",
  "1312": "Viru",
  "1401": "Chiclayo",
  "1402": "Ferreñafe",
  "1403": "Lambayeque",
  "1501": "Lima",
  "1502": "Barranca",
  "1503": "Cajatambo",
  "1504": "Canta",
  "1505": "Cañete",
  "1506": "Huaral",
  "1507": "Huarochiri",
  "1508": "Huaura",
  "1509": "Oyon",
  "1510": "Yauyos",
  "1601": "Maynas",
  "1602": "Alto Amazonas",
  "1603": "Loreto",
  "1604": "Mariscal Ramon Castilla",
  "1605": "Requena",
  "1606": "Ucayali",
  "1607": "Datem Del Marañon",
  "1701": "Tambopata",
  "1702": "Manu",
  "1703": "Tahuamanu",
  "1801": "Mariscal Nieto",
  "1802": "General Sanchez Cerro",
  "1803": "Ilo",
  "1901": "Pasco",
  "1902": "Daniel Alcides Carrion",
  "1903": "Oxapampa",
  "2001": "Piura",
  "2002": "Ayabaca",
  "2003": "Huancabamba",
  "2004": "Morropon",
  "2005": "Paita",
  "2006": "Sullana",
  "2007": "Talara",
  "2008": "Sechura",
  "2101": "Puno",
  "2102": "Azangaro",
  "2103": "Carabaya",
  "2104": "Chucuito",
  "2105": "El Collao",
  "2106": "Huancane",
  "2107": "Lampa",
  "2108": "Melgar",
  "2109": "Moho",
  "2110": "San Antonio De Putina",
  "2111": "San Roman",
  "2112": "Sandia",
  "2113": "Yunguyo",
  "2201": "Moyobamba",
  "2202": "Bellavista",
  "2203": "El Dorado",
  "2204": "Huallaga",
  "2205": "Lamas",
  "2206": "Mariscal Caceres",
  "2207": "Picota",
  "2208": "Rioja",
  "2209": "San Martin",
  "2210": "Tocache",
  "2301": "Tacna",
  "2302": "Candarave",
  "2303": "Jorge Basadre",
  "2304": "Tarata",
  "2401": "Tumbes",
  "2402": "Contralmirante Villar",
  "2403": "Zarumilla",
  "2501": "Coronel Portillo",
  "2502": "Atalaya",
  "2503": "Padre Abad",
  "2504": "Purus",
};
