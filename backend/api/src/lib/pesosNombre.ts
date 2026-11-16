/**
 * Cuánto pesa cada palabra de un nombre como APELLIDO (positivo) o como NOMBRE DE PILA (negativo), de −9 a 9.
 *
 * Sirve a `ordenProbable` (lib/privacidad.ts) para decidir si un nombre viene «apellidos nombres» o «nombres apellidos»
 * y tapar el apellido correcto. Sale de contar, en un padrón que trae los apellidos aparte del nombre (700 mil personas
 * con órdenes de servicio), cuántas veces cada palabra es apellido y cuántas nombre de pila: peso = 2·ln((apellido + 1) /
 * (nombre + 1)), sólo palabras con 40 usos o más. Son palabras sueltas, no personas.
 *
 * Medido con verdad de campo (39 mil personas del RNP que no entraron a la cuenta): la regla anterior, con 281 nombres
 * de pila, erraba el orden en 1,81 % (y dejaba los dos apellidos a la vista en 1,34 %); con estos pesos, 0,25 %.
 * Se mide y se regenera con backend/scripts/medir_orden_nombres.py [--escribir] (2026-11-16).
 */
const POR_PESO: Record<string, string> = {
  "9": `abal abarca achahui aguado ahuanari aiquipa alanya alata alave alayo alberca albornoz almanza anahua anampa
anaya ancajima anchapuri anco aparcana apaza aquise arauco areche arimuya arrascue arribasplata arteaga asto
atalaya ayquipa babilonia baez balcazar baldera barco bardalez barragan barreto barrionuevo bermeo berrio
bravo briones bustillos cabellos cabezas caceda cacha cachay cadenas caja cajahuanca cajaleon calampa
calizaya calsina cama camones campana campomanes canaza canchari candiotti capcha caqui cardoza cardozo
carhuas carreon cartagena casilla casique caso catacora cayllahua ccallata ccallo ccama ccapa ccasa ccolque
ccorahua ccorimanya ccosi chalco chambe chambi chambilla champi chanco chara charaja chata chayna checalla
cherre chinchay chino chipana choque choquehuayta chuchon chuctaya chumbe chunga chuquilin chuquillanqui
chuquipiondo chuquiyauri chuquizuta cierto cieza cjuno coaguila coila colana colca colque colquehuanca
colqui cometivos condezo condor condori corahua coronel coyla coz cucho cuellar culqui culquicondor cumpa
cuno cunya curasi cuti cutipa cuya cuyo diez dominguez enriquez escriba falcon farronan febres ferro gago
gavidia gongora granados guizado hancco herencia hinostroza huacac huachaca huacho hualla huallpa huaman
huanaco huanacuni huanca huancas huanqui huansi huarac huaraca huari huaringa huaroc huayanay huayna
huaynate huayta huerta huillca huincho huisa humpire ibarra inca incacutipa inonan izaguirre jaimes jamanca
jayo juarez junco juro lamadrid laurente layme leiva lengua letona leyva limachi limaylla limo llaja
llamocca llatas llenque lloclla lluen loarte loro lupaca macavilca machaca machacuay malca mamani manco
manihuari manuyama manzano maquera marca masco maylle mayta mego merma mescco milla minchan mogrovejo molero
mollinedo mollo monroy monsalve montalban montalvo montanez montano montesinos monzon morocho mozo mujica
mullisaca munguia murayari muro murrugarra najarro narvaez naupa naupari neciosup nima nizama ochavano ocsa
ojeda olivera oquendo ore orellana oriundo oscco otarola pacaya pacora pacori pacsi palpa pancca panez
paniura paricahua pariona pasapera pastrana paucar pauccar pauccara pauro penaloza perca percca pereira
pilares pillco pineda pintado porras pucho puicon pulido puma quea quenaya quicana quichca quillahuaman
quincho quinde quinonez quispe rebaza ricapa rimachi riofrio roa rosado rua ruelas rugel rupay saez saire
salamanca saldana saldivar sallo sanabria saucedo saune seclen segovia serrano siccha sicha sinarahua sinche
solorzano soncco suca sucapuca sueldo suma surco taco tamani tamayo tarazona tarrillo ticliahuanca ticlla
tineo tinoco tinta tintaya tipula torrejon trejo trigozo troncos ttito tuanama tucto turpo ulloa untiveros
urquia usca ushinahua valverde vara varas varillas ventocilla veramendi vereau viera vilcapaza vilcas
villagaray villalta villarroel viza yahuarcani yalle yanac yanqui yapo yaranga yauli yepez ypanaque yucra
zamata zarzosa zelaya zenteno zurita zuta`,
  "8": `acaro acasiete accostupa achahuanco achulli acosta acuna adco aduviri aguayo aguilar aguinaga ala alache
alagon alanoca alarcon alava alaya albarracin albarran alcarraz alcca aldazabal alderete allcca almerco
altamirano alvarado alvarez alvines alzamora amachi amacifuen amao amaringo amasifen amaya ambicho amesquita
anamuro ananca anccasi ancco anchiraico andia angulo anquise antaurco anticona anyosa apagueno araca aragon
aranda arapa araujo arbaiza arbieto arce arcos arellano arenas arestegui arguedas ari arias arisaca
arismendiz arizaca arizapana arocutipa arohuanca aroni arpasi arquinigo arredondo arriaga arroyo ascarza
ascate ascue asencios asenjo aslla aspajo aspilcueta astete astudillo astuhuaman atachagua atamari atao
ataucuri ataucusi ataypoma atencio auccapuma auqui avellaneda avendano ayala ayambo ayay aybar aza azanedo
azanero balabarca balboa baldeon bances banegas barcena bardales barja barrantes barranzuela barrenechea
barrientos barros barrueta barturen barzola basualdo bazalar becerra bejarano bellota benavente bendezu
bereche bermejo bermudo berroa berru beteta bobadilla bohorquez bonilla bracamonte bringas buitron buiza
buleje burga burgos burneo bustamante bustios bustos cabanillas cabello cabrejos cabrera caceres cachique
cacya cadillo cahuana cahuaya cahuaza cairo cajachagua cajahuaringa cajas calapuja calatayud calcina caldas
calderon calero calisaya callacondo callo calloapaza calsin calua calzada camacho camarena camargo camayo
camino campos camus canahuire canales canari canchanya cancho cancino candela cangalaya canqui cantaro
caparachin capristan carbajal carhuachin carhuajulca carhuallanqui carhuaricra carhuatanta carhuayo carranza
carrasco carrillo carrizales casa casana casquino castaneda castellares castillon castro catachura catari
catunta cauper caviedes ccahua ccahuana ccalla ccarhuas ccasani ccencho ccoa cconislla ccopa ccori ccoto
ccoya ccoyo ccuno centeno cerna ceron cerpa cerquin cerron cespedes chaca chacon chafloque chagua chahuara
chaina challco chamaya chamorro chaname chapa chapilliquen chaupis chavez chero chevarria chevez chicalla
chicoma chihuan chilcon chileno chillihuani chilo chilon chinguel chininin chiroque chirre chistama chomba
choquehuanca choquemamani choquenaira choquepuma chota chuco chujutalli chulle chuman chuqui chuquihuanga
chuquimia chuquiruna chura churampi churata cisneros cjuiro cjuro clavijo clavo coaquira cobos cohaila
collado collanqui collantes collas colonia colunche condemayta condena condo contreras conza copa copaja
copari cordero cordova corilla cornejo correa corro cortez cosavalente costilla cotrina crespo cribillero
criollo cruzado cubas cuentas cuestas cueva cuevas cumapa cunurana cusacani cusihuallpa cusihuaman cuzco
dahua davalos daza diaz diestra dolorier doza duenas durand eca echevarria echeverria edquen elescano
encalada enciso erazo escalante escobal escobar escobedo escudero eslava espada espejo espezua espichan
espinola espinoza espirilla esquerre esquia estofanero estrada eyzaguirre falla farro fatama feijoo
fernandez fiestas figueredo flores florez frias frisancho fuentes fustamante galan galarza galvez gamarra
gambini gamboa gamez gamonal garay garces garcia garrido gavancho gavilan giraldez giron goicochea gomez
goni gonzales goycochea granda grandez guanilo guerra guerrero gutierrez halanocca hanampa haro henriquez
herrera holgado horna hoyos huacani huacarpuma huacchillo huahuasoncco huaita hualpa huamani huanacune
huanchi huancollo huaqui huaquisto huaracha huarahuara huarancca huaraya huarca huarcaya huarhua huaricallo
huarocc huaroto huauya huayama huaycama huayhua huayhuas huaylinos huaylla huayllapuma huerto huichi huicho
huilca huiman huinapi huiza humpiri hurtado huyhua idme idrogo illa infanzon inga ipanaque ipushima irarica
ishuiza isla isuiza izarra izquierdo jacome jallo janampa jancco jaramillo jauregui jimenez julca julcamoro
juscamaita juscamayta labrin lachira ladera ladines lagos laguna laime laiza lanchipa lapa laquihuanaco
larico larota laupa lavado lavalle layza lazo ledesma leguia lerma lescano levano limache limay linares
linarez lipa lipe litano livias lizana lizano lizarme llacsa llacsahuanga llacta llacza llamo llanca llanos
llanque llantoy llasa llerena lliuya llontop lluncor loa loaiza loayza lobaton lope lopez lopinta lozano
lucano lujan luna lupu luque lurita macahuachi macedo machacca macuri macuyama magan maldonado mallma
mallqui malpartida mamanchura manay manchay manchego mancilla mantilla manuelo manuico manzanares marchena
marquez marreros marron marroquin martell maticorena matos mattos mayanga mayhuire maza medina medrano mejia
melgarejo menacho mendez mendieta mendiola mendo mendocilla mendoza mera mestas meza mezarina mezones minano
minaya minchola minope miranda miraval misaico mita mogollon molina molocho monago moncada mondragon
montenegro montero montes monteverde monteza moquillaza morales morante moreto morillas mormontoy moscol
mosquera moya mozombite mucho mundaca munive munoz murga murguia murillo musaja nahui nahuincopa napan
naquiche navarrete navarro navas neyra ninahuaman niquen noa noblecilla nolorbe nonajulca norabuena nunez
nunjar obando obregon ocampo ocana ocas ochoa ochochoque ocrospoma ojanama olave olivares ollachica
olortegui oncebay oncoy onton ordonez ormachea oropeza ortega oruna oscanoa osores osorio otazu ovalle
oviedo oyola pacci pacco pachari pacheco pacoticona padilla paima paiva pajares palacios palomares palomino
pancorbo paniagua panta pantoja parco pardave pardo paredes pari parillo paripanca parisaca parraga paucara
paxi paytan pazo pedraza perales peralta pereda perez peves picon picoy pilco pillaca pimentel pinan pinares
pinazo pinchi pinedo piscoya pizango pizarro plasencia poma pongo portuguez poves puchuri puclla puelles
puican pumayalli pupuche purizaga puscan putpana puyen qqueccano quenta quesquen quicano quijano quilla
quiroz ramirez ramos ravichagua rayo regalado rendon renteria requena retamozo retis retuerto revollar
reynaga ricaldi ricopa rimac rimache rimarachin rivadeneira rivasplata robles rocca rodriguez rojas romaina
romani romero romo rondan rosello rubio saavedra sacaca saenz sagastegui sagua sairitupac sajami salas
salazar salhuana salinas salon salvatierra samame samaniego samillan sanchez sancho sandoval sanga sangama
santibanez santillan sanz saquiray saravia sarayasi sare sarmiento satalaya sayas sedano seguil segura
sencia sernaque serrato shahuano shupingahua sifuentes siguenas silupu simbron sinuiri sisa sivincha sobrado
sobrino soles sonco sono soplin sosa soto sotomayor suana suclupe sudario sulca sulla sumaran sumari supo
surichaqui sutta suyo suyon tacas tacca tacilla tacora tacuche tacuri tacza tafur tahua tananta tandazo
tangoa tanta tantalean tapahuasco tapayuri tapia tapullima taquiri tarco taricuarima tarqui taype tecsi
tejada tello terrazas tesen ticahuanca ticllacuri ticona tipiani tipo tirado tisnado tocto toledo tornero
torpoco torres troncoso trujillano trujillo ttupa tuero tueros tuesta tume tunoque tunque tunqui tunquipa
tupayachi unocc urbina ureta urquizo ururi uscamayta utani utia utrilla uzuriaga vaca valdera valderrama
valdez valdivia valdivieso valdiviezo valencia valenzuela valer valera vallejos valles vargas vasquez
vejarano vela velasque velasquez velazque velez velezmoro velita verastegui vergara vergaray vicuna vidaurre
vigo vilca vilcahuaman vilcapuma vilcherrez vilchez villacorta villagra villalobos villanes villanueva
villarreal villavicencio villegas villena virhuez vitor vivanco vizcarra yactayo yaipen yalan yalico yallico
yapuchura yarleque yauri yauricasa yaya ybanez ydrogo yenque ylla yllanes ynonan yovera ysla yuca yufra yupa
yuyarima zagaceta zamalloa zambrano zamora zanabria zapana zapata zarate zavala zavaleta zegarra zubieta
zumaeta zumaran zuniga`,
  "7": `abramonte abregu aburto acero acevedo acha acho acurio adrianzen aduvire agama agreda aguero aguilera
aguirre agurto ahumada alama alania alban alburqueque alca alcalde alcantara alcocer aldana aldave ale
alegre alejos alfaro aliaga allca almeyda almiron almonacid alor alva alvan alvares alvites amanqui
amasifuen ampuero anchante andrade anglas angles antezana aparco apolaya aponte apumayta aquije arambulo
aramburu arana arango aranya araoz arbanil arboleda arbulu ardiles arevalo argomedo arica arirama arista
ariza armas aro arone arones arosquipa arostegui arqque arratea arrese arrieta arriola arrunategui arzapalo
astocondor atencia ato atoche atuncar avalo avalos avila ayca aylas ayllon ayma ayuque azabache azana baca
balarezo balbin baldarrago ballena baltodano banda baneo banos barahona barazorda barbaran barboza barreda
barrera barriga barrios barron bartra basauri bastidas bayona bazan bedon bedregal bedrinana belito bellido
bello benites bermudez bernal bernales bernaola bernedo berrios berrocal berrospi blanco bocanegra bocangel
bojorquez bolanos bolivar bonifaz borjas boza briceno buendia bueno bullon bustinza butron caballero cabana
cabeza cabezudo cachi cadenillas cahua cahui cajahuaman cajamarca cajo calla callata calle callirgos callupe
calmet calvay calvo camac camasca camizan campoverde canal canaquiri canayo candia cano cansaya canta
capillo capunay carbonel carcausto cardena cardenas cardoso carhuamaca carhuancho carhuapoma carhuavilca
carhuaz carmona carnero carreno carrera carrion caruajulca casachagua casafranca casani casanova casaverde
castellanos castillejo castrejon cauna cavero caycho cazorla ccalli ccana ccari ccarita ccaso ccolqque
ccoscco ccoyllo centurion cercado cerda cerdan cervantes chacaltana chacca chacolla chahua chahuayo
chambergo chanca chanchari chanduvi changanaqui chanta chaparro chaponan charca chauca chavarri chavarry
chavesta checa checca chicana chiclla chilet chilquillo chipa chirinos chocce choqque choquecota choquepata
chozo chuchullo chucuya chujandama chullo chumacero chumbiauca chumpitaz chuquimango chuquipoma claros coa
coba cobenas cochachi cochachin coello colchado collazos colmenares comun conde conga conislla corimanya
coronado corrales cortes cortijo corzo cotos covenas cruzalegui cuadros cuayla cueto curasma curi curitima
curo curro cusi cusipuma cutimbo cutire cuyubamba cuzcano daga davila dedios delgado depaz dextre deza
dioses donayre dongo duque duran echegaray egoavil egusquiza elguera encinas escate escurra espinal espino
espinosa esquivel estacio esteves facho fajardo farfan farias fasabi fasanando ferrel fierro figueroa
florindez fretel gaitan galdos galiano gallardo gallegos gallo galvan gama gamero ganoza garavito gargate
garibay garnica garnique garriazo garro gastelo gatica gayoso geldres gibaja godoy gomero gonzalez gordillo
grados grande grijalva grillo guarniz guarnizo guerreros guevara guillen gutarra hallasi hanco henostroza
heredia hermoza hernandez herrada hilares hilasaca hinojosa holguin huacan huacasi huaccha huaco
huallpayunca huamancayo huamannahui huanay huancachoque huanuco huapaya huarachi huaranga huaripata huarsaya
huasasquiche huatuco huayaney huaycani huayllani huaytan huertas humire ibanez iglesias ihuaraqui illanes
illescas iman incio infantas infante infantes inquilla inuma iparraguirre iquiapaza irigoin ito jahuira jara
julcarima julon jurado kana labajos labra lalupu lanazca landa landeo laqui larrea lastra laucata lezama
liendo lima limas linan lingan lizarraga llacma llanco llano llauce llave llocclla lloclle lobato lobo lomas
lostaunau lovaton lovera loza lozada lucana ludena luza macalupu maceda machado maco magallanes maguina maiz
malaga malaver malpica manayay mandujano mango manrique mantari manyari maque marcas marchan marinas marinos
marmanillo marmolejo maron marquina marrufo martel marticorena martinez mas masgo maslucan matute maurtua
mautino mayhua mayorca mayorga maytahuari meca mechan mechato melendez melendres melendrez mellado mena
mendizabal menendez meneses mercado merino mescua mesia mesones mesta mestanza mija mimbela mio mirano mitma
mondalgo monja monje monrroy montalico montalvan monteagudo montejo montoya montufar mora moran more moreano
moreno moreyra mori morocco moron mory moscoso mostacero mucha munayco murrieta najera nalvarte namuche
nanez napa negron neira nevado nieto ninaja noriega novoa nunura nurena obeso ochante ocharan ocmin olarte
olivos oporto orbegoso orbezo ordinola orejon orihuela ormeno oroche orosco orozco orrego ortiz osco ostos
paccori pacherres pacho pacompia paez paico pajuelo palacin paliza palma pampa panaifo panana panca panduro
pantigoso paraguay pareja paria parra pasache pashanasi pasmino pasquel patino paye peche pelaez pena
penafiel perea pereyra periche pezo phocco pinas pingo pinto pipa pisconte pisfil pizan pocco poemape
polanco ponce ponte porta portella portocarrero preciado pretel prieto principe puertas puescas puga pulache
pumacayo purihuaman quecano quevedo quezada quico quijandria quilca quiliche quille quino quinones quintana
quintanilla quinte quinteros quiroga quisocala quito ravello reategui reluz rengifo requejo reto revilla
revolledo reynoso ricalde ricse riojas risco rivas rivera riveros robledo rocha rodas rojo romayna rosales
rozas rucoba rueda ruesta ruiz rujel saboya saico sal salcedo saldarriaga salgado salguero sanca sanjinez
santacruz santisteban santivanez sarango sardon servan sevillano shapiama shuna sialer siancas sierra
siesquen siguas silva silvera sinchi sinti sipion soca socola socualaya soldevilla solis sopla soplopuco
soria soriano sotacuro sotelo sovero suarez sucari sucasaca sucasaire sullca sullcaray sullon sumire suncion
supa susanibar taboada taipe talavera talledo tamariz tanchiva tapara taquire tasayco tasilla tataje tavara
tavera tellez tenazoa terreros terrones teves ticse timana tinedo tipacti tocas torero toro trigoso trillo
trucios tuya ubillus uceda ucharima uchasara uchuya uculmana ugaz umeres upiachihua urcia uriarte urrunaga
urrutia valero valladares valladolid vallejo vallenas valqui vegas velarde velasco venegas venero vera verde
vicharra vidarte viena vila vilcapoma vilcatoma vilela villafuerte villagomez villajuan villalba villalva
villar villasante villon villoslada vizarreta yabar yachachin yacila yajahuanca yalli yamunaque yana yanapa
yanarico yanayaco yanez yangali yangua yanque yarasca yauyo ynfante yparraguirre yujra yumbato yupanqui
yurivilca yzaguirre zafra zamudio zea zeballos zelada zeta zevallos zorrilla zuasnabar zumba zuzunaga`,
  "6": `abanto achata adanaque adauto adriazola agnero agramonte albines albites albitres alcas alcedo alegria
aleman alferez alhuay allende almeida almestar almonte altez alvitres alza ames amezquita anazco ancachi
ancalla ancalle anicama antay anton antunez aquino arancibia arca arcaya arcela aredo arela arellan
argandona argumedo arispe arizaga arnao aroapaza arotinco arotoma arratia artica asalde ascona ascoy asin
asipali asmat asqui atarama atoccsa aucca auris aviles ayasta aymara ayvar azurin bahamonde balbuena
baldoceda balladares ballesteros ballon bancayan baquerizo barba barrueto batallanos bedia bedoya begazo
bejar belleza benavides benique beraun bernuy blacido blancas bolo borda borja branez broncano bujaico
bulnes bustincio cachicatari cahuapaza caira cajavilca cajusol callan callanaupa camara camposano cana
cangahuala canto cantoral capa carazas carbonell carcamo carhuatocto cari carita carrascal carrero cartolin
casariego casavilca castelo castillo castromonte catalan ccala ccanahuire ccanto ccente ccoicca ccora cedano
celiz cenepo ceras cerro cervera cevallos chamba chana chang chani chapiama chau chaupin chavarria checya
cherres chiara chico chile chinga chire chiri chirito chong choquecahua choquegonza chorres choy chumbes
chumpitazi chung cienfuegos coaquera coasaca coayla coca colan collao coloma colonio colorado concha coras
corcuera cori cortegana cosi cosio cossio cotrado cruces cuadra cuadrado cuaresma cuba cuenca cunyas curay
cusma delgadillo eche echenique effio eguiluz elera eneque escajadillo escarcena esparza espiritu esquen
esquives estana esteba estremadoyro euribe fababa fachin falconi farje farronay felices feria ferreyra
fonseca francia fuertes galarreta galindo gaona garate garayar garcilazo gastelu giles girao gonas gonza
gordon goyzueta grau graus guardia guimaray herbozo hidalgo honores huacca huaccho huaira huamanchumo
huancahuari huancco huanio huaranca huatay huayanca huayapa huayllas huayra huaytalla iberico ichpas
ingaroca iriarte isminio jave jeri jibaja jinez jove joya junchaya laines lajo lamas lancha landauro laos
lara latorre laulate lavi lazarte lecca legua leva leveau licas limaco limaymanta lizama lizarbe
llactahuaman llamoca llana llancari llanqui llanto llaque llica llosa loja lombardi loo lovon loyaga lugo
luyo machicao madueno maita malasquez malqui mancha mandamiento manosalva mansilla maravi maraza martos
matallana matamoros matencio mayo mayuri mazuelos melgar melo mere millones minan misari monge monterroso
morillo morote mosqueira motta muchaypina muguerza munante munarriz muniz napuri narro naupay naveda naveros
negrete nestares nicho nina ninahuanca ninamango ninaquispe nolazco nole nopo norena oblitas ocon olaechea
olano olaya olivas olivo omonte orbe orbegozo ordaya orejuela orizano oros orrillo osnayo ospina otero
otiniano oyarce pachas pacherre pacherrez pairazaman paisig paja pamo pando paquiyauri parado pare pasco
pauca payano pazos peceros pecho penadillo penaranda peve pichilingue piminchumo pina pinche pinillos pinin
pisco pita plaza polo portal portilla portillo portugal posadas postigo povis pozo prado pretell puerta
pujay purisaca purizaca puse querevalu quesada quijada quina quineche quintero quinto quiquia quiza rabanal
rado ranilla rayme rea reano rebatta recuay reinoso rejas remuzgo reque revatta reyes ricra riega rimari
rincon rioja rios rivadeneyra rivero robalino roncal ronceros rondinel rondon rondoy rosillo rospigliosi
rudas rufasto ruidias rumiche saca sacha saco salirrosas salluca saman samanamud samanez samata samayani
sangay santamaria santillana santur sayan sayritupac seijas seminario sequeiros serpa serquen sevilla shuan
sinacay sirlopu soberon solsol suasnabar surita tagle tairo tala talla tang taza tejeda temoche tenorio
teran terrel tinco tipismana tomaylla torrealva torreblanca toscano totora tovar trauco travezano trebejo
trelles tuco ugarte urquiaga urteaga valdeiglesias varela varona vega veintemilla velazco veliz vento
ventura verano vertiz vidalon vilavila vilcanqui vilcarromero villacrez villafana villano villantoy
villaseca villaverde villazana vinces vite vivar vivas vizcardo wong yacolca yaicate yalta yance yataco
yesquen ynga zaga zavalaga zela zena zuloaga zuloeta zulueta`,
  "5": `advincula aedo alamo alatrista albujar alcala alejandria alpaca altuna alvis apaico apestegui aranibar
argote aroquipa arteta astorga auccasi ayamamani balvin barra barraza basurco basurto bellodas benitez
bernilla boyer cacho cahuas cajacuri calagua callapina caman camero canelo canepa cango capia caro casas
castilla cedillo cepeda chacaliaza chalan chancafe changa chira chocano chocca cholan chu chucos ciudad
cubillas cuela cupe denegri desposorio deudor dulanto ecos estupinan evangelista falen ferreyros freitas
fuster gadea galicia garabito garamendi gaviria giraldo godos gozar grajeda guardamino hermosilla hijar
huaccachi huallanca illatopa ingaruca ingunza jihuallanca laban larios lau laynes leon leyton lindo lora
loyola macha machuca marin matta mendivil millan mina molleda montoro morey moyano nacion naira najar nana
ninanya nique olazabal oliveira ordono orellano otoya pacha paitan palza papa parodi paz pedroza perdomo
pesantes pichihua pinzon poicon polar pomar portales prada pua rafaele raffo ravines razuri roca rosadio
rubina salva santana santander santi santoyo saona serna serra sina sipan solano solari solier suazo suni
talaverano tantarico tena tincopa tolentino triveno tumi tupa tupia urday uribe uriol urquiza urtecho
valcarcel valiente valle verona via vicencio vildoso villa yaringano yeren yllescas yong ysuiza zabaleta`,
  "4": `aching alarco apolo arbildo balta bautista blas boulangger brena brito caicedo casapia celis coral costa
cotera damiano dianderas elizalde freyre gamio gastulo guzman injante lam laurencio laveriano lecaros loli
madrid masias milian nolasco obispo oblea oliden oliva oliveros pino rangel ravelo requelme resurreccion
rosas saba sales tamara tupac vigil`,
  "3": `abad abril aguedo alba alcazar alejo amaro ascencio asencio atanacio bailon bartolo baylon calixtro campo
carlin carpio celi colina crisanto crispin custodio doria duarte ferrer gala gil heras hernani jaen lazaro
li lira liza meregildo muriel odar onofre paco piedra pierola puente riquelme riva roldan roque rubin
sacramento saira sandi sotero sotil souza tudela venturo victorio`,
  "2": `amable ambrosio angeles aparicio belizario cayetano cayo cora corcino crisostomo estrella facundo florian
franco gaspar gonzaga hermitano jacobo jordan juli lama laureano lupo mata maxi nino pastor primo reymundo
ricci roman rosell rossel silvano solar sota terry`,
  "1": `alvino amaru apolinario asis ayme bacilio baltazar beltran berna bernaldo bonifacio calixto casimiro corpus
damian gavino inocente ita laura liberato livia lucero mar matias maya mesias nonato orue presentacion
salvador siles silvestre tadeo tito urbano valeriano vidal`,
  "-1": `aime albino ali anastacio aniceto basilio benito bernabe cipriano crisologo doroteo estela gervacio
inocencio jacinto justiniano leo narcizo nazario nieves olmedo pacifico paquita patricio remigio rey rolin
rosel simon visitacion viviano ygnacio yon zacarias zaira`,
  "-2": `agapito amancio anacleto bernardo candelario celedonio celestino damaso diego dionicio dionisio esteban
estelita eustaquio evaristo felipa hermenegildo higinio isidro jeronimo joaquin lauro lewis lucho marino
marlo merida merlin nicacio nicasio noel palermo pascual paulino perla pio placido policarpo reina rodrigo
romualdo rufino salome santiago santos sebastian simeon teodor thomas timoteo valentin vicente yane`,
  "-3": `allison alvaro angelino bartolome cecilio ceferino claudio constantino davis delfin dios dolores elias
eulogio fuente gabino gabriel gonzalo grabiel graciano grimaldo guadalupe hilarion ignacio justo lee lorenzo
luciano marcos mari mariluz mayer miller narciso nolberto pelayo policarpio raimundo ramon rodil serafin
silverio smith ubaldo valentino ysidro`,
  "-4": `adan alfonzo alonso ancelmo anderson angelo apolonio asuncion avelino caleb cancio climaco concepcion dimas
dolly eden emanuel eugenio faustino feliciano felix galo greta hernando jeremias juanito leonardo lolo
maximiliano natividad nerio oliver purificacion rafael rosalino ross sabino salomon sandy tomas tula vito
winder`,
  "-5": `adrian amador arcenio ascencion belen belisario berta bruce camilo carmelo catalino emeterio eusebio
exaltacion felipe fermin gaston guillermo hipolito idelfonso jaime javier julian levi libia mariano meliton
modesto natalio neri noe rudecindo sacarias severiano tercero vivian wagner werner yola`,
  "-6": `agustin aladino alan alipio anselmo apolinar aquilino berly carlo carmen cesareo cirilo donato douglas
emmanuel enrrique epifania eulalio feliberto florentino francis fulgencio ilich isac jefferson jorge justino
kennedy leocadio liria lizardo lupe magno mara marina mark maura maximino melquiades meri nalda nehemias
nicolas norberto nory pablo pelagio roel roni rosario rosi sara seferino sixto victoria victoriano victorino
walker willians zara`,
  "-7": `abelino agueda albert alejandro alfonso amarildo anahi analy ananias andres ann anne arcangel ayda azucena
baldomero benedicto benigno benilda camila carlos carmina casimira charly cintya clemencia cleto conrado
delma donald duberly eduarda einer elvin erasmo estefania estuardo euclides eudosia evarista eveling everth
fabiana fidel filomeno flor florencio fritz gamaniel gardenia geremias german gilder gregorio guido hayde
heidi hilmer inocencia isrrael jackson jesus jonas joseph josn kathy ledy leodan lia liborio lizandro lorena
lucio marcial martin melecio meliza mercedes miguel miguelina miria mitchell narcisa natalie nazaria neiser
nery nicolaza ninfa noemy odalis omer otto ovidio paulo pierre placida pool priscila reinaldo remberto
reynaldo rider robinson roosevelt rosa samantha segundo sharon silver simion sussy tempora teodolfo
teodolinda teodoro ulices wilberth williams wilman wilson wualter yoli yrene ysaias ytalo yul yuli`,
  "-8": `aaron absalon adita adler aidee alamiro alberta alcibiades alexandro alexi aleyda alindor allan alvina amada
anatolia andre andy annie anny antero antolin antonino antonio antony apolinaria apolonia arcadio armandina
armida arnold arquitecto arsenio arthur artidoro astrid asunciona aureliano aurora balbina balvina barbara
beder benicio berenice bernarda bertila bethy beto bety bibiana biviana bonifacia brigitte buenaventura
caridad casilda celedonia cesario charo cindy cintia cipriana clarisa claudina claver clodoaldo connie
cristhiam cristiam dalia damaris dan dani dania dayana debora deciderio delcy denise denny denys deyvi
diogenes domenica donata donatila doraliza dorian dorila eda edda edi edil edilberta edu ela eladia elcira
eleana eleodora eliazar eligio elisabet eliza elma emigdio emily enedina enoc enzo erica ericson ester eudes
eufemio euler eunice eustaquia evelio exequiel fabio fabricio fausta favio faviola felimon fidelia fiorela
francesca francisco fred fredesvinda fresia gabina gaudencio geovana gertrudis gian gilber gilma giuliano
gladiz gleny gregory grimalda grimanesa grober guiliana guillerma guissela gumercinda helard helbert helder
helena helga hellen herless hermenegilda hermes hermilio hever hilder hilton hipolita honorato hortensia
ibeth idalia idelso ignacia ilda inocenta iraida irene isaura isolina israel itala ivone jackelin jacob
jacquelin jael james jane janette janneth jany jaquelin jazmin jean jeaneth jeannette jenner jerry jerson
jessy jilmer jimena johann jovanna joyce juber judy julisa juvencio juver katherin kathia katiuska kattia
katya kelvin kenneth kety klever leandra leidy leila lener leocadia leoncia leonid leonila leonilda lester
leydi lider ligia liliam lilly lindaura lionel lisbet liset liseth lizette loida lorgio loyda luigi lurdes
luzgarda lydia madelaine madeleyne magnolia mamerto marcia mardonio maricruz marie mariel marieta marisa
marissa marly marna martina marybel marylin massiel mauricia mauro mavel mayela medalith medardo melania
melita melvin merardo michell mike milca milciades mildred milka mirla miryan mitchel moises morayma myrian
napoleon nathalie nathaly neli nelva ney nicomedes nils nilson nimia ninoska nivardo nolberta nury obdulio
obed oca octavia odilon olegario olenka olimpio otoniel palmira panfilo pastora patrick patty peggy perci
peregrina perpetua piedad plinio prospero prudencia randy ranulfo raymunda regner reinerio renso reynalda
reynerio richer rildo rody rogelia rolan romelia romeo romer romina ronnie rosalva rosalvina rosalyn rosanna
rosaria rosemarie rosenda rosina rosmeri rossy royer ruddy rut saida sally serafina serapio severo sixta
soraida stephanie sujey sulema sulma susi sylvia tarcila telmo teodorico teofanes teresita timotea tobias
tony ubaldina uber valdemar valeriana valery violeta vitaliano vladimiro waldemar wigberto wiliam willam
willan wilma wilmar wilton xavier ximena xiomara yajaira yaquelin yda yerson yliana ymelda yone yonny ysaac
yudi yulisa yvette zelmira zenovia zocimo zunilda`,
  "-9": `abdias abdon abel abelardo abigail abilio abner abraham abrahan ada adalberto adela adelaida adelina adelmo
ademir adolfo adriana adriel agripina agripino agustina agusto aida aide alain albertina alberto albina
alcides alcira aldo aleida alejandra alejandrina alejandrino alex alexander alexandra alexis alfredo alicia
alida alina amadeo amalia amanda amelia america americo amilcar amparo ana anabel anali anastacia andrea
angel angela angelica angelina angelita angie anibal anita antenor anthony antonia antonieta aquiles
aquilina araceli aracelli aracelly aracely aristides armando arminda arnaldo arnulfo arquimedes artemio
arturo asunta atilio augusta augusto aura aurea aurelia aurelio ausberto avelina ayde aydee bacilia basilia
beatriz belinda benedicta benigna benita benjamin bernardina bernardino bertha betsabe betsy betty betzabe
betzabeth billy bladimir blanca boris braulio brenda brigida candelaria candy carina carla carlota carmela
carol carola carolina catalina catherine cecilia ceferina celeste celestina celia celina celinda celso cesar
charito charles christiam christian christopher cinthia cinthya cirila ciro clara claudia clelia clementina
cleofe clever clorinda clotilde constantina consuelo corina cristhian cristian cristina cynthia dagoberto
daisy dalila damiana daniel daniela danilo danitza danny dante dany daria dario darwin david daysi deisy
delfina delia delicia demetria demetrio denis denisse dennis dennys desiderio deysi diana dick digna dilma
dilmer dina dino diomedes dionicia dionisia dominga domingo domitila dora doris dorotea eber ebert eberth
eddie eddy edelmira eder edgar edgard edgardo edilberto edin edinson edison edit edita edith edmundo edson
eduar eduardo edwar edward edwin edwing edy efrain efren eladio elar elard elba elber elda elder eleazar
elena eleodoro eleuteria eleuterio eli elia eliana elida elio elisa elisabeth elisban eliseo elita elizabet
elizabeth elmer elmo eloisa eloy elsa elva elver elvia elvira elvis ely emerita emerson emilia emiliana
emiliano emilio emma emperatriz ena enith enma enrique enriqueta epifanio eriberto eric erick ericka erik
erika erlinda ermelinda ernestina ernesto erwin esau esmeralda esperanza estanislao esther etelvina ethel
eudocia eufemia eugenia eulalia eulogia eusebia eva evangelina evelin evelina evelyn ever evert ezequiel
fabiola fanny fany fatima faustina fausto federico felicia feliciana felicita felicitas fermina fernanda
fernando fidela fidencio filiberto filomena fiorella flavia flavio flora florencia florentina florinda
fortunata fortunato francisca frank franklin franz freddy fredi fredy frida froilan gabriela gaby gary
genara genaro genoveva george georgina geovanna gerald geraldine gerardo gerson giancarlo gianina giannina
gilbert gilberto gilda gilmar gilmer gina gino giovana giovani giovanna giovanni giovanny gisela gisella
giselle gissela gissella giuliana gladis gladys glenda glicerio gloria godofredo grace graciela gregoria
gricelda griselda grover gualberto gudelia guillermina guisela guisella gumercindo gustavo hamilton hans
harold harry haydee heber hebert hector heidy helen heli helmer henrry henry heraclio herbert heriberto
herlinda herman hermelinda herminia herminio hermogenes hernan hilaria hilda hildebrando hitler homero
honorata horacio hortencia huber hubert hugo humberto ida igor iliana imelda indira ines ingeniero ingrid
irina iris irma isaac isabel isaias isela isidora isidoro ismael italo ivan ivette ivon ivonne jacinta jack
jackeline jacqueline jair jairo jakeline janet janeth janett janina jannet jaqueline jeanette jennifer jenny
jeny jesica jessenia jessica jesusa jhon jhonatan jhonny jhony jim jimmy jimy joan joanna job joe joel johan
johana johanna john johnny johny jonatan jonathan jonny jony jose josefa josefina joselito josue jovana
jovita juan juana juanita judit judith julia juliana julieta julio julissa july junior justa justina juvenal
karem karen karim karin karina karla karol katerine katherine katia katty katy kelly kely kenny ketty kevin
ladislao lady larry lastenia lelis lenin leny leonarda leoncio leonel leonidas leonor leopoldo leslie lesly
leticia leyla libertad lida lidia liduvina lila lili lilia lilian liliana lily limber lina lincoln linda
linder lisbeth lisette lisset lisseth lissette lita liz lizbeth lizet lizeth lola lorenza lourdes lucia
lucila lucinda lucrecia lucy luis luisa luz luzmila mabel macario macedonio madeleine magali magally magaly
magda magdalena magna malena manolo manuel manuela marcel marcela marcelina marcelino marciano marco marden
margaret margarita margot margoth maria mariana marianela marianella maribel maricela mariela mariella
marilin marilu marilyn mario marisela marisol marita maritza marivel mariza marizol marjorie marlene marleni
marleny marlon marta martha maruja marvin mary matilde max maxima maximiliana maximina maximo mayra medalit
melanio melba melchora melina melisa melissa melva mercy merly mery micaela michael michel milagritos
milagro milagros milena milton miluska mirella mireya miriam mirian mirko mirna mirta mirtha miryam misael
modesta monica myriam nadia nanci nancy narda natali natalia nataly neil nelida nelly nelson nely nemecio
nemesio neptali nerida nestor nicanor nicolasa nidia nila nilda nilo nilton nixon noelia noemi nohemi nora
norka norma norman obdulia octavio odon ofelia olga olger olimpia olinda olivia omar orestes orfelinda
orlando oscar oswaldo otilia pamela paola paolo pascuala patricia paul paula paulina pavel pedro pepe percy
peter petronila piero pilar pompeyo porfirio primitiva primitivo quintin rafaela ramiro raphael raquel raul
ray rayda rebeca regina regulo renan renato rene renee renzo ricardina ricardo richar richard rigoberto rina
rita rivelino rober robert roberta roberth roberto robin rocio rodolfo rogelio roger rogger roland rolando
roly romel rommel romulo romy ronal ronald ronny rony rosalia rosalina rosalinda rosalio rosana rosaura
rosemary rosendo rosio rosita rosmery rossana rossmery roxana roy ruben rubi ruby rudy rufina rufo ruperto
rusbel ruth sabina sadith samuel sandra sandro santosa santusa sarita saturnina saturnino saul sebastiana
segunda segundina segundino selene sergio sheila sheyla shirley sigifredo silvana silveria silvia silvio
simona socorro socrates sofia solange soledad sonia soraya stalin steve sugey susan susana susy tania
tatiana teddy telesforo teobaldo teodocia teodocio teodomiro teodora teodosia teodosio teodulo teofila
teofilo teresa tereza tomasa toribia tulio uldarico ulises uriel ursula valentina valeria vanesa vanessa
veronica veronika vicenta vicentina vicky victor vilma virgilio virginia viviana vladimir waldir waldo
walter walther washington wenceslao wendy wilber wilbert wilberto wilder wilfredo wilian william willian
willy wilmer wilver wily winston yadira yanet yaneth yanett yanina yanira yaqueline yasmin yeni yenny yeny
yesenia yesica yessenia yessica ynes yngrid yobana yoel yohana yolanda yonel yoni yony yovana yovani yovanna
yovany yris yrma ysabel ysela ysmael ysrael yudith yudy yuliana yulissa yuly yuri yury yvan yvonne zaida
zarela zenaida zenobia zenobio zenon zoila zonia zoraida zosimo zulema zully zulma`,
};

/** palabra (sin tildes, en minúsculas) → peso. */
export const PESO_NOMBRE = new Map<string, number>();
for (const [peso, lista] of Object.entries(POR_PESO)) for (const w of lista.split(/\s+/)) if (w) PESO_NOMBRE.set(w, Number(peso));
