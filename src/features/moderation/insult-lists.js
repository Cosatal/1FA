// Insults and hate speech per language, for the "Langage inapproprié" AutoMod filter (moderation.js).
// Discord's lists only exist in English: these cover the rest. All checked languages are
// grouped into a single AutoMod rule (1,000 words max, and Discord allows 6 keyword rules per server).
// Without *: whole word only ("pute" doesn't block "dispute"). Discord ignores upper and lower case.
// Ambiguous words are avoided (e.g. "kanker" = cancer in Dutch): expressions without a double meaning are preferred.

const LANGUAGES = {
  fr: {
    name: '🇫🇷 Français',
    words: [
      'fdp', 'ntm', 'tg', 'ftg', 'tdc', 'nique ta mère', 'nique ta mere', 'niquer ta mère', 'niquer ta mere', 'nik ta mère', 'nik ta mere',
      'va niquer ta mère', 'ta mère la pute', 'ta mere la pute', 'fils de pute', 'fils de chien', 'enfant de pute', 'fille de pute',
      'pute', 'putes', 'sale pute', 'salope', 'salopes', 'salopard', 'connard', 'connards', 'connasse', 'connasses', 'conasse',
      'enculé', 'encule', 'enculés', 'enculer', 'enculeur', 'je te baise', 'je vais te baiser', 'va te faire foutre', 'va te faire enculer',
      'ferme ta gueule', 'suce ma bite', 'suce moi', 'trou du cul', 'batard', 'bâtard', 'batards', 'bâtards',
      'pd', 'pds', 'pédé', 'pede', 'pédés', 'tapette', 'tarlouze', 'fiotte', 'gouine',
      'négro', 'negro', 'négros', 'negros', 'nègre', 'negre', 'nègres', 'bougnoule', 'bougnoules', 'bicot', 'youpin', 'youpins',
      'chinetoque', 'bamboula', 'sale noir', 'sale arabe', 'sale juif', 'sale nègre', 'sale negre', 'mongolien', 'sale race',
    ],
  },
  es: {
    name: '🇪🇸 Espagnol',
    words: [
      'puta', 'putas', 'puto', 'putos', 'hijo de puta', 'hija de puta', 'hijos de puta', 'hijueputa', 'hijo de perra', 'tu puta madre',
      'me cago en tu madre', 'chinga tu madre', 'chingada', 'concha de tu madre', 'coño de tu madre', 'cabrón', 'cabron', 'cabrones',
      'pendejo', 'pendeja', 'gilipollas', 'maricón', 'maricon', 'maricones', 'marica', 'culero', 'mamón', 'malparido', 'malparida',
      'vete a la mierda', 'zorra', 'negrata', 'sudaca', 'subnormal', 'mongólico', 'mongolico',
    ],
  },
  de: {
    name: '🇩🇪 Allemand',
    words: [
      'hurensohn', 'hurensöhne', 'hurensohne', 'hure', 'huren', 'fotze', 'fotzen', 'wichser', 'arschloch', 'arschlöcher', 'missgeburt',
      'spast', 'spasti', 'schwuchtel', 'kanake', 'kanaken', 'neger', 'fick dich', 'fick deine mutter', 'verpiss dich', 'drecksau',
      'schlampe', 'nutte', 'mongo', 'behindi', 'dreckskanake', 'scheiß schwuchtel', 'scheiss schwuchtel',
    ],
  },
  it: {
    name: '🇮🇹 Italien',
    words: [
      'vaffanculo', 'fanculo', 'figlio di puttana', 'figli di puttana', 'puttana', 'puttane', 'troia', 'stronzo', 'stronza', 'stronzi',
      'coglione', 'coglioni', 'testa di cazzo', 'succhiacazzi', 'bastardo', 'bastarda', 'frocio', 'froci', 'ricchione', 'zoccola',
      'mongoloide', 'va a cagare', 'terrone', 'negro di merda',
    ],
  },
  pt: {
    name: '🇵🇹 Portugais',
    words: [
      'filho da puta', 'filha da puta', 'filhos da puta', 'vai tomar no cu', 'vai se foder', 'vai te foder', 'foda-se', 'caralho',
      'arrombado', 'arrombada', 'cuzão', 'cuzao', 'buceta', 'viado', 'otário', 'otario', 'babaca', 'desgraçado', 'desgracado',
      'vagabunda', 'puta que pariu', 'corno', 'retardado',
    ],
  },
  nl: {
    name: '🇳🇱 Néerlandais',
    words: [
      'kankerlijer', 'kanker lijer', 'krijg de kanker', 'kankerhoer', 'kankermongool', 'teringlijer', 'tering lijer', 'krijg de tering',
      'tyfuslijer', 'krijg de tyfus', 'klootzak', 'klootzakken', 'hoer', 'hoeren', 'hoerenzoon', 'mongool', 'flikker', 'flikkers',
      'kutwijf', 'neuk je moeder', 'neger', 'negers', 'kutmarokkaan', 'kuthoer',
    ],
  },
  pl: {
    name: '🇵🇱 Polonais',
    words: [
      'kurwa', 'kurwy', 'ty kurwo', 'chuj', 'chuju', 'pierdol się', 'pierdol sie', 'spierdalaj', 'wypierdalaj', 'jebać', 'jebac',
      'jebany', 'jebana', 'pierdolony', 'pierdolona', 'skurwysyn', 'skurwysynu', 'pizda', 'pedał', 'pedal', 'ciota', 'kutas',
      'dziwka', 'zjeb', 'jebać cię', 'jebac cie',
    ],
  },
  tr: {
    name: '🇹🇷 Turc',
    words: [
      'orospu', 'orospu çocuğu', 'orospu cocugu', 'amına koyayım', 'amina koyayim', 'amına koyim', 'aq', 'amk', 'siktir', 'siktir git',
      'ananı sikeyim', 'anani sikeyim', 'sikerim', 'yarrak', 'ibne', 'pezevenk', 'kahpe', 'sürtük', 'surtuk', 'şerefsiz', 'serefsiz',
      'gerizekalı', 'gerizekali', 'piç kurusu', 'pic kurusu',
    ],
  },
  ru: {
    name: '🇷🇺 Russe',
    words: [
      'блять', 'блядь', 'бля', 'сука', 'суки', 'пидор', 'пидорас', 'пидарас', 'хуй', 'хуесос', 'ебать', 'долбоёб', 'долбоеб',
      'мудак', 'мудила', 'шлюха', 'гандон', 'уёбок', 'уебок', 'пизда', 'иди нахуй', 'нахуй', 'ебанат', 'чурка', 'хач', 'жид',
      'blyat', 'cyka blyat', 'suka blyat', 'pidor', 'pidoras', 'nahui', 'idi nahui',
    ],
  },
  uk: {
    name: '🇺🇦 Ukrainien',
    words: [
      'курва', 'підор', 'підар', 'йобаний', 'йобана', 'хуйло', 'виродок', 'засранець', 'сука', 'блядь', 'пизда', 'мудак', 'іди нахуй',
    ],
  },
  ar: {
    name: '🇲🇦 Arabe (et arabizi)',
    words: [
      'nik mok', 'nik omak', 'nikomok', 'nik mouk', 'zebi', 'kahba', 'qahba', 'kahbe', '9a7ba', 'wald l9a7ba', 'weld el kahba',
      'sharmouta', 'sharmuta', 'charmouta', 'ibn el kalb', 'kos omak', 'kos ommak', 'kossomak', 'ayre fik', 'ayri fik', 'zamel', 'zemel',
      'tabon mok', 'tabonmok', 'mtnak', 'manyak',
      'شرموطة', 'قحبة', 'كس امك', 'كس أمك', 'ابن الكلب', 'ابن الشرموطة', 'منيوك', 'عرص', 'زامل', 'يلعن دينك',
    ],
  },
};

Object.setPrototypeOf(LANGUAGES, null); // LANGUAGES['constructor'] is undefined

// All the words of the chosen languages, without duplicates (1,000 max: Discord's limit)
const wordsFor = (languages) => [...new Set(languages.flatMap((id) => LANGUAGES[id]?.words ?? []))].slice(0, 1000);

module.exports = { LANGUAGES, wordsFor };
