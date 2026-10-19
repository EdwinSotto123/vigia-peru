/**
 * Las tildes que el SEACE, el MEF y CONOSCE pierden al escribir en MAYÚSCULAS ("ADQUISICION DE UTILES DE
 * ESCRITORIO" → "Adquisición de útiles de escritorio"). Sólo se aplica a lo que llegó todo en mayúsculas (lo escrito
 * a mano se respeta) y en dos partes:
 *   · una regla segura: en castellano, toda palabra que termina en consonante + "ion" lleva tilde ("construccion",
 *     "pension", "region", "camion"); el plural ("construcciones") no.
 *   · un diccionario sacado de los mismos datos: en los 1,267 casos de abajo, los textos de CONOSCE que sí usan
 *     tildes escriben la palabra con tilde al menos 6 de cada 10 veces (y 8 veces o más), más una lista revisada a
 *     mano de lugares, apellidos y palabras frecuentes. Las ambiguas ("esta"/"está", "mas"/"más", "solo") no están.
 * La lista la rearma backend/scripts/generar_tildes.py (lee la base); a mano, sólo para quitar una que esté mal.
 */

const PALABRAS = `
académica académicas académico académicos acrílica acrílicas acrílico acuática acuáticas acuático acuáticos acuícola
acuícolas acuífero acémilas acético acústica acústicas acústico acústicos además adoquín adquisició adquisiciónde
adquisicón adquisiicón adrián adán aeronáutica aeronáuticas aeronáutico aeródromo aféresis agroecología
agroecológico agronomía agronómicos agrostología agrícola agrícolas agrónoma aguaytía agustín ajonjolí albañilería
alcaldía alcázar alelíes algodón almacén almidón amazonía amazónica amazónicas amazónico amazónicos amiláceo
ampliaciónde américa américas analítica analíticas analítico analíticos anatomía ancoracá ancón andalucía andrés
anestesiología aniónico antiaérea antropología antártida antígeno antígenos antón antúnez análisis apurímac apícola
apícolas apósito apósitos arbóreas archivístico archivísticos argón aromáticas aromático aromáticos arpía
arqueología arqueológica arqueológicas arqueológico arqueológicos arquitectónico arquitectónicos arsénico artesanía
artesanías artillería artículo artículos artística artísticas artístico artísticos asesoría asfáltica asimétrico así
asís atlética atlético atmosférica atmosféricas atmosféricos atípicas atómica atún auditoría auditorías audífonos
automática automáticas automático automáticos automóvil automóviles autonomía autónoma autónomas autónomo averías
aviónica avícola awajún azúcar aérea aéreas aéreo aéreos bacteriológico bahía bahías balística balón bambú barrón
bartolomé bastón batallón batería baterías batimétrico bayóvar baúl belén bermúdez bibliográfica bibliográfico
bibliográficos bidón bimetálicos biología biológica biológicas biológico biológicos biomédicas biomédico biomédicos
biométrica biométrico biométricos biopolímeros bioquímica bioquímico bioquímicos biotecnología biotecnologías
biólogo bogotá bolívar bombón bongará boquerón borceguí borceguíes botiquín botín botón bromatología butrón buzón
bárbara básculas básica básicas básico básicos bélgica bórax bóveda búsqueda caballería cabrería cadáver cadáveres
cafetería café cahuín calorímetro calzón camaná camarón camélidos canadá canaán capellanía capitanía capitanías
capitán características carbón cardiología carpintería carrocería carrózale cartografía cartográfica cartón carácter
caserío caseríos catastróficos categoría categorías catiónica catéter catéteres catódica católica caudalímetros
caída celendín cerrajería cerámica cerámicas chepén chillón chimú chávez cibernéticas ciclovía científica
científicas científico científicos cinematográfico cirugía citometría ciudadanía climatológicos climática
climáticamente climáticas climático climáticos clásica clásico clásicos clínica clínicas clínico cocaína colorímetro
colágeno comité comités compañía compañías común conchán consejería conserjería consultaría consultoría
consultoríade consultorías contraloría contratacón contumazá corazón cordón cosmética cospán criminalística
criogénica criogénico cristóbal cromatografía cromatográfico cromatógrafo crédito créditos crías críticas críticos
crónica crónicas crónicos cuartelería cubículos cucurbitáceas currículo cutánea cuádruple cuádruples cáceres cálcica
cálculo cámara cámaras cáncer cánula cánulas cápsulas cárnicos células césped cítricos cívica cívicas cívico cóctel
código códigos cómputo cóndor cúpula deberá demasías demás dentellón depósito depósitos desafíos diabético
diagnóstico diagnósticos dibós didáctica didáctico didácticos dieciséis dieléctrica dieléctrico dieléctricos
dietética dietético difractómetro difícil dinámica dinámico dinámicos dioptría diplomática distanciómetro diálisis
diálogo diámetro dióxido doméstica domésticos domínguez dosimetría dramático déficit día días díaz dígitos dípticos
dúctil dúplex ecografía ecología ecológica ecológicas ecológico ecológicos economía economías económica económicas
económico económicos ecosistémico ecosistémicos ecógrafo ecógrafos ejército electrocardiógrafos electrocirugía
electrodomésticos electrofisiología electromagnético electromagnéticos electromecánica electromecánicas
electromecánico electromecánicos electrógeno electrógenos electrónica electrónicas electrónico electrónicos elástico
eléctrica eléctricas eléctrico eléctricos elías emblemáticas endocrinología endoscópica energética energético
energéticos energía enfermería entomología envío enzimático epidemiológica escalón escuadrón escáner escáneres
escénica escénicas eslabón espectrofotómetro espectrometría espectrómetro espectáculo espectáculos específico
específicos espárragos estadística estadístico estadísticos estantería estanterías estomatología estomatológica
estratégica estratégicas estratégico estratégicos están estándar estándares estático estéril estériles estímulos
etílico extracorpórea exámenes exóticas farmacología farmacológico farmacológicos farmacéutico farmacéuticos
fenólico fenómeno fernández ferretería filosofía fiscalía fiscalías fisicoquímica fisicoquímico fisiografía
fisiográfico fisiología fluorómetro flúor folletería fosfórica fotografía fotogrametría fotogramétrico fotográfica
fotográficas fotográfico fotográficos francés frigorífica frigoríficas frigorífico frutícola fría frías fríos furgón
fábrica fármacos fátima férrico física físicas físico físicos fólderes fórmulas gabán galerías galpón galón
ganadería garantía garcía gasfitería gastronomía gastronómica gastronómico gastronómicos gavión genética genético
genéticos genómicas genómicos geodésico geodésicos geofísica geofísico geofísicos geografía geográfica geográfico
geología geológica geológicas geológico geomática geotécnico geriátrico ginecología ginecológica glutámica gonzález
gradería graderías granítica gráfica gráfico gráficos grúa grúas guardianía guardianías gutiérrez guzmán guía guías
gálvez género gómez hectáreas helicóptero helicópteros hematología hematológico hematopoyéticos hemodinámica
hemodiálisis hemoglobinómetro hemostática hemostático hernán hernández hidrobiología hidrobiológico hidrobiológicos
hidroeléctrica hidroeléctricas hidrofílica hidrogeológico hidrografía hidrográfica hidrográficas hidrología
hidrológica hidrológico hidrometeorológica hidrometeorológico hidrometereológicos hidropónicos hidrostática
hidráulica hidráulicas hidráulico hidráulicos hidróxido higiénico higiénicos hiperbárica hipoalergénico hipólito
histórica histórico históricos hormigón hotelería huachón huamalíes huamán huasmín huánuco hélice hélices héroes
hídrica hídrico hídricos hígado húmedo húmedos ilícito imagenología imágenes inalámbrica inalámbricas inalámbrico
inalámbricos indígena indígenas infantería informática informáticas informático informáticos ingeniería ingenierías
inglés inmunohematología inmunohematológicas inmunología inmunoquímica inmunoserología inorgánico inorgánicos
instantánea instantáneas instantáneo interoceánico interés intrínsecamente intérpretes inés iparía isotónica
isotónico iónica iónico jabón japón jardinería jardín jaén jericó jerusalén jerónimo jesús jiménez jirón joaquín
josé joyería junín jurídica jurídicas jurídicos jóvenes kilómetros laparoscópica latinoamérica lavandería leguía
león librería librerías limón logística logístico logísticos lunahuaná lurín lácteas lácteo lácteos láminas láser
líder líderes línea líneas líquido líquidos lógica lógico lúdicos maestría magnética magnéticas magnético magnéticos
malecón maletín mamografía mampostería mamógrafo mandilón maniquíes manómetros marañón marinería mariátegui marrón
martín martínez maría marítima marítimas marítimo marítimos matemática matemáticas matemático matemáticos maíz
mecatrónica mecánica mecánicas mecánico mecánicos medallón megáfonos membresía mensajería mercancías metabólicos
metagenómica metalmecánica metalúrgica metalúrgico meteorología meteorológica meteorológicas meteorológico
meteorológicos metodología metodologías metodológica metodológicas metodológico metrología metálica metálicas
metálico metálicos microbiología microbiológicos microcatéter microguía micrófono micrófonos minería monofásico
monofásicos monzón morfológica morropón moscú multipropósito multímetro murciélagos museografía mágico máquinas
márgenes márquez mástil mástiles máxima máximo máximos mázac médica médicas médico médicos médula método métodos
méxico mínima mínimo módulo módulos mónica mórrope móvil móviles múltiple múltiples música músicos nanopartículas
nanotecnología nefrología neoplásicas neumología neumáticas neumáticos neurocirugía neurología neurológicas
nitrógeno norteamérica náutico néstor nómina núcleo números núñez obstétrica obstétrico oceanográfico oceanía
odontología odontológica odontológico odontológicos ofimática ofimático oftalmología oftalmológico oftalmológicos
oftálmica oftálmicas oftálmico olímpica oncología oncológica oncológicas oncológico oncológicos optrónica
organoléptico organolépticos orgánica orgánicas orgánico orgánicos orquídeas orégano ositrán osteosíntesis oxígeno
oyotún pabellón pacarán pacífico padrón paiján paisajística pajón panadería panamá panorámica panorámico pantalón
papelería paquetería parabólico paracaídas parasitología parasitológico parasitológicos pariachichí partículas
parámetros pasantía pasantías pastelería patología patologías patológica patrón patógenos país países pedagogía
pedagógica pedagógicas pedagógico pedagógicos pediatría pediátrica pediátricas pediátrico película películas
percutáneo periférica periféricas periférico periféricos perimétrica perimétrico perimétricos periodísticos
periódica periódicas periódico periódicos permitirá perímetro peróxido perú pesquería petroperú petróleo petróleos
piscícola piscícolas piérola plantón plástica plásticas plástico plátano plátanos podotáctil policlínico policía
polimérica polimérico poliméricos poliéster política políticas pontón porcón portátil portátiles prebásica
prehispánico procuraduría promperú pronósticos propósito prostático proteína proteínas proveeduría práctica
prácticas préstamo próstata prótesis próxima próximo psicología psicológica psicológicas psiquiatría pucalá
pumacayán punzón purús página páginas péptidos pérdidas pérez pérgola pérsico pétreos póliza pólizas pólvora pórtico
pórticos pública públicas público públicos quemazón quirúrgica quirúrgicas quirúrgico quirúrgicos química químicas
químico químicos radiofármacos radiografía radiográficas radioisótopos radiología radiológica radiológico ramírez
ramón raíces raíz raúl realizará recién refinería regímenes relés repostería república retráctil reómetro robótica
robótico rodríguez román rápida rápidas rápido régimen rígida rígido rígidos rímac ríos rústicos salomón salón
sanguínea satélite satélites sayán sebastián secretaría según semafórica semiautomática semiautomático semáforos
serológicas serológico serrán servirá será serán sifón sillón simultánea simultáneo simétrico simón sinfónica
sintética sintético sistemático sistemáticos soberón socioeconómica socioeconómico subacuáticas subterránea
subterráneas subterráneos sucedáneo sáenz sánchez sémola séptico sépticos séptima séptimo sífilis símbolos síntesis
sísmica sísmico sódica sódico sólidos sótano sótanos tablón tahití también tampón tardía tecnología tecnologías
tecnológica tecnológico tecnológicos telefonía teleférico telefónica telefónicas telefónico telemetría telemática
teléfono teléfonos temática temático temáticos teoría terapéutica terapéuticas terapéutico termográfica
termohigrómetros termómetro termómetros tesorería teórico tomografía tomógrafo topografía topográfico topográficos
toxicología toxicológico trabajará traqueotomía traumatología través trifásica trifásicas trifásico trifásicos
trigésima tráfico trámite trámites tránsito trébol trípticos tubería tuberías tubérculos tumbadén tumán turquía
turística turísticas turístico turísticos tutoría táctica tácticas táctico tácticos táctil técnica técnicas técnico
técnicos térmica térmicas térmico térmicos términos título títulos tópico tópicos tórax tótem tótems tóxicos túcume
túnel túneles ultrasónico urbanísticos vacío vacíos valcárcel valentín varón vehículo vehículos veintidós veintiséis
velásquez virú viáticos volcánica volcánico volumétrico volumétricos vulcanológico válvula válvulas vásquez vía vías
víbora víctimas víctor vísceras vívelo víveres yanchalá zoológico ácidas ácido álamo álvarez ámbito ámbitos áncash
ángel ángeles ángulos árabes árboles área áreas énfasis épocas ética éxito índice índices ítem ítems ómnibus óptica
ópticas óptico ópticos órgano órganos ósea última únic única únicas único únicos útil útiles
`;

/** "adquisicion" → "adquisición". La clave es la palabra sin tilde ni diéresis (la ñ se conserva). */
const TILDES = new Map<string, string>();
for (const p of PALABRAS.split(/\s+/)) if (p) TILDES.set(sinTilde(p), p);

function sinTilde(p: string): string {
  return p.normalize("NFD").replace(/(?!\u0303)\p{M}/gu, "").normalize("NFC");
}

const RE_PALABRA = /\p{L}+/gu;
const RE_ION = /[^aeiouáéíóú]ion$/;

/** Devuelve el texto (en minúsculas) con sus tildes repuestas, palabra por palabra. */
export function conTildes(t: string): string {
  return t.replace(RE_PALABRA, (p) => {
    const d = TILDES.get(p);
    if (d) return d;
    return p.length >= 5 && RE_ION.test(p) ? p.slice(0, -2) + "ón" : p;
  });
}
