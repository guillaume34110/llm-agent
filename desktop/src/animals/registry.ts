// Mirror of monkey/animals.py. Keep in sync.
// `name` is the agent identity in English (used in SYSTEM_PROMPT — keep EN).
// `displayName` + `tagline` are FR strings rendered in the UI.

export type AnimalId =
  | 'monkey' | 'ape' | 'gorilla' | 'orangutan'
  | 'dog' | 'poodle' | 'guide_dog' | 'service_dog' | 'wolf' | 'fox' | 'raccoon'
  | 'cat' | 'black_cat' | 'lion' | 'tiger' | 'leopard'
  | 'horse' | 'unicorn' | 'zebra' | 'deer' | 'bison'
  | 'cow' | 'ox' | 'buffalo' | 'pig' | 'boar'
  | 'ram' | 'sheep' | 'goat' | 'camel' | 'two_hump_camel' | 'llama' | 'giraffe'
  | 'elephant' | 'mammoth' | 'rhino' | 'hippo'
  | 'mouse' | 'rat' | 'hamster' | 'rabbit' | 'chipmunk' | 'beaver' | 'hedgehog' | 'bat'
  | 'bear' | 'polar_bear' | 'koala' | 'panda' | 'sloth' | 'otter' | 'skunk' | 'kangaroo' | 'badger'
  | 'turkey' | 'chicken' | 'rooster' | 'chick' | 'bird' | 'penguin' | 'dove'
  | 'eagle' | 'duck' | 'swan' | 'owl' | 'dodo' | 'flamingo' | 'peacock' | 'parrot'
  | 'frog' | 'crocodile' | 'turtle' | 'lizard' | 'snake'
  | 'dragon' | 'eastern_dragon' | 'sauropod' | 't_rex'
  | 'whale' | 'spouting_whale' | 'dolphin' | 'seal' | 'fish' | 'tropical_fish' | 'blowfish' | 'shark' | 'octopus'
  | 'nautilus' | 'coral' | 'crab' | 'lobster' | 'shrimp' | 'squid'
  | 'snail' | 'butterfly' | 'caterpillar' | 'ant' | 'bee' | 'beetle' | 'ladybug' | 'cricket' | 'cockroach'
  | 'spider' | 'scorpion' | 'mosquito' | 'fly' | 'worm';

export interface AnimalProfile {
  id: AnimalId;
  name: string;          // EN — used in agent prompts
  displayName: string;   // FR — shown in UI
  emoji: string;
  tagline: string;       // FR — shown in UI
  hue: number;                       // primary (surfaces + main accent)
  hue2?: number;                     // secondary accent (default = hue → monochrome)
  hue3?: number;                     // tertiary accent (default = hue2 → bi-color)
  chroma2?: number;                  // 0..0.2, default 0.17
  chroma3?: number;
  // Direct hex overrides — when present, animal-service injects them as final --accent / --accent-2 / --accent-3
  // (with dim/glow/soft derived via color-mix). Bypasses OKLCH L/C lock.
  accent?: string;                   // hex #RRGGBB for primary
  accent2?: string;                  // hex #RRGGBB for secondary
  accent3?: string;                  // hex #RRGGBB for tertiary
  neutral2?: 'light' | 'dark';       // force --accent-2 to off-white/off-black (panda, zebra, bee…)
  neutral3?: 'light' | 'dark';
  palette?: 'mono' | 'bi' | 'tri';   // default 'bi' — drives auto-derivation of hue2/hue3 in animal-service
  toolSkin?: 'terminal' | 'card' | 'mono' | 'glass' | 'neon' | 'paper';  // default 'card' — drives data-tool-style for bridge/plan/tools
  priceCents: number;
  free: boolean;
}

const P = 99;

export const ANIMALS: Record<AnimalId, AnimalProfile> = {
  // Primates
  monkey:         { id: 'monkey',         name: 'Monkey',         displayName: 'Singe',           emoji: '🐵',    tagline: 'Curieux, joueur, pratique.',                         hue: 148, priceCents: 0, free: true, palette: 'mono', toolSkin: 'terminal' },
  ape:            { id: 'ape',            name: 'Ape',            displayName: 'Singe sauvage',   emoji: '🐒',    tagline: 'Sauvage, opportuniste, saute de branche en branche.', hue: 145, toolSkin: 'mono', priceCents: P, free: false },
  gorilla:        { id: 'gorilla',        name: 'Gorilla',        displayName: 'Gorille',         emoji: '🦍',    tagline: 'Mâle dominant. Impose le respect.',                  hue: 15,  toolSkin: 'mono', priceCents: P, free: false },
  orangutan:      { id: 'orangutan',      name: 'Orangutan',      displayName: 'Orang-outan',     emoji: '🦧',    tagline: 'Pensif, sage, ermite tranquille.',                   hue: 25,  toolSkin: 'mono', priceCents: P, free: false },

  // Canids
  dog:            { id: 'dog',            name: 'Dog',            displayName: 'Chien',           emoji: '🐶',    tagline: 'Loyal, enthousiaste, motivé.',                       hue: 60,  toolSkin: 'card', priceCents: P, free: false },
  poodle:         { id: 'poodle',         name: 'Poodle',         displayName: 'Caniche',         emoji: '🐩',    tagline: 'Raffiné, soigné, précis.',                           hue: 350, hue2: 40, hue3: 290, palette: 'tri', accent: '#D6457E', accent2: '#C9A66B', accent3: '#8B6FB8',  toolSkin: 'card', priceCents: P, free: false },
  guide_dog:      { id: 'guide_dog',      name: 'Guide Dog',      displayName: 'Chien-guide',     emoji: '🦮',    tagline: 'Stable, fiable, montre le chemin.',                  hue: 50,  toolSkin: 'mono', priceCents: P, free: false },
  service_dog:    { id: 'service_dog',    name: 'Service Dog',    displayName: 'Chien d\'assistance', emoji: '🐕‍🦺', tagline: 'Entraîné, attentif, dévoué.',                      hue: 45,  toolSkin: 'mono', priceCents: P, free: false },
  wolf:           { id: 'wolf',           name: 'Wolf',           displayName: 'Loup',            emoji: '🐺',    tagline: 'Chasseur solitaire. Une seule cible.',               hue: 250, accent: '#311B92', toolSkin: 'terminal', priceCents: P, free: false },
  fox:            { id: 'fox',            name: 'Fox',            displayName: 'Renard',          emoji: '🦊',    tagline: 'Vif, stratégique, concis.',                          hue: 30,  hue2: 35, hue3: 15, neutral2: 'light', palette: 'tri', toolSkin: 'paper', accent: '#E8742C', accent3: '#9C4A1F', priceCents: P, free: false },
  raccoon:        { id: 'raccoon',        name: 'Raccoon',        displayName: 'Raton laveur',    emoji: '🦝',    tagline: 'Malin, fouineur, touche à tout.',                    hue: 35,  toolSkin: 'terminal', priceCents: P, free: false },

  // Felines
  cat:            { id: 'cat',            name: 'Cat',            displayName: 'Chat',            emoji: '🐈',    tagline: 'Indépendant, ironique.',                             hue: 20,  toolSkin: 'card', priceCents: P, free: false },
  black_cat:      { id: 'black_cat',      name: 'Black Cat',      displayName: 'Chat noir',       emoji: '🐈‍⬛',  tagline: 'Mystérieux, distant, énigmatique.',                  hue: 280, neutral2: 'dark', toolSkin: 'terminal', priceCents: P, free: false },
  lion:           { id: 'lion',           name: 'Lion',           displayName: 'Lion',            emoji: '🦁',    tagline: 'Confiant, royal, direct.',                           hue: 80,  hue2: 60, hue3: 40, palette: 'tri', accent: '#D4A24C', accent2: '#C68642', accent3: '#9E6B2F', toolSkin: 'card', priceCents: P, free: false },
  tiger:          { id: 'tiger',          name: 'Tiger',          displayName: 'Tigre',           emoji: '🐯',    tagline: 'Audacieux, décidé, féroce.',                         hue: 30,  neutral2: 'dark', toolSkin: 'mono', priceCents: P, free: false },
  leopard:        { id: 'leopard',        name: 'Leopard',        displayName: 'Léopard',         emoji: '🐆',    tagline: 'Furtif, embuscade précise.',                         hue: 45,  toolSkin: 'mono', priceCents: P, free: false },

  // Equids / hooved
  horse:          { id: 'horse',          name: 'Horse',          displayName: 'Cheval',          emoji: '🐴',    tagline: 'Rapide, libre, grandes foulées.',                    hue: 35,  toolSkin: 'paper', priceCents: P, free: false },
  unicorn:        { id: 'unicorn',        name: 'Unicorn',        displayName: 'Licorne',         emoji: '🦄',    tagline: 'Imaginative, latérale, fantaisiste.',                hue: 320, hue2: 195, hue3: 90, palette: 'tri',  toolSkin: 'glass', accent: '#E54E9E', accent2: '#42B8C4', accent3: '#F5D442', priceCents: P, free: false },
  zebra:          { id: 'zebra',          name: 'Zebra',          displayName: 'Zèbre',           emoji: '🦓',    tagline: 'Rayé, contrariant, casseur de schémas.',             hue: 240, neutral2: 'dark', neutral3: 'light', toolSkin: 'mono', priceCents: P, free: false },
  deer:           { id: 'deer',           name: 'Deer',           displayName: 'Cerf',            emoji: '🦌',    tagline: 'Gracieux, vigilant, aux aguets.',                    hue: 28,  toolSkin: 'paper', priceCents: P, free: false },
  bison:          { id: 'bison',          name: 'Bison',          displayName: 'Bison',           emoji: '🦬',    tagline: 'Lourd, immuable, ancré.',                            hue: 22,  toolSkin: 'paper', priceCents: P, free: false },
  cow:            { id: 'cow',            name: 'Cow',            displayName: 'Vache',           emoji: '🐮',    tagline: 'Calme, généreuse, rumine.',                          hue: 30, hue2: 130, hue3: 350, neutral2: 'dark', palette: 'tri', accent: '#8B5A2B', accent3: '#F2C8D4', toolSkin: 'paper', priceCents: P, free: false },
  ox:             { id: 'ox',             name: 'Ox',             displayName: 'Bœuf',            emoji: '🐂',    tagline: 'Fonce, brut, plein régime.',                         hue: 0,   accent: '#E53935', toolSkin: 'neon', priceCents: P, free: false },
  buffalo:        { id: 'buffalo',        name: 'Buffalo',        displayName: 'Buffle',          emoji: '🐃',    tagline: 'Lourd, stable, déplace le troupeau.',                hue: 18,  toolSkin: 'paper', priceCents: P, free: false },
  pig:            { id: 'pig',            name: 'Pig',            displayName: 'Cochon',          emoji: '🐷',    tagline: 'Gourmand, satisfait, plus malin qu\'il n\'y paraît.', hue: 330, accent: '#FF80AB', toolSkin: 'neon', priceCents: P, free: false },
  boar:           { id: 'boar',           name: 'Boar',           displayName: 'Sanglier',        emoji: '🐗',    tagline: 'Rugueux, têtu, fonce dans le tas.',                  hue: 12,  toolSkin: 'card', priceCents: P, free: false },
  ram:            { id: 'ram',            name: 'Ram',            displayName: 'Bélier',          emoji: '🐏',    tagline: 'Tête baissée, persistant.',                          hue: 38,  toolSkin: 'card', priceCents: P, free: false },
  sheep:          { id: 'sheep',          name: 'Sheep',          displayName: 'Mouton',          emoji: '🐑',    tagline: 'Doux, grégaire, conformiste.',                       hue: 95,  toolSkin: 'paper', priceCents: P, free: false },
  goat:           { id: 'goat',           name: 'Goat',           displayName: 'Chèvre',          emoji: '🐐',    tagline: 'Vaillante, grimpe partout. La GOAT.',                hue: 72,  accent: '#AFB42B', toolSkin: 'paper', priceCents: P, free: false },
  camel:          { id: 'camel',          name: 'Camel',          displayName: 'Dromadaire',      emoji: '🐪',    tagline: 'Endurance, peu d\'eau, longue route.',               hue: 48,  toolSkin: 'paper', priceCents: P, free: false },
  two_hump_camel: { id: 'two_hump_camel', name: 'Bactrian Camel', displayName: 'Chameau',         emoji: '🐫',    tagline: 'Doublement résilient. Deux bosses, deux plans B.',   hue: 52,  toolSkin: 'mono', priceCents: P, free: false },
  llama:          { id: 'llama',          name: 'Llama',          displayName: 'Lama',            emoji: '🦙',    tagline: 'Décalé, calme, pince-sans-rire.',                    hue: 62,  toolSkin: 'paper', priceCents: P, free: false },
  giraffe:        { id: 'giraffe',        name: 'Giraffe',        displayName: 'Girafe',          emoji: '🦒',    tagline: 'Vue d\'ensemble, voit loin et haut.',                hue: 58,  hue2: 28,  toolSkin: 'glass', priceCents: P, free: false },

  // Megafauna
  elephant:       { id: 'elephant',       name: 'Elephant',       displayName: 'Éléphant',        emoji: '🐘',    tagline: 'Sage, mémoire longue, posé.',                        hue: 270, accent: '#AB47BC', toolSkin: 'mono', priceCents: P, free: false },
  mammoth:        { id: 'mammoth',        name: 'Mammoth',        displayName: 'Mammouth',        emoji: '🦣',    tagline: 'Ancien, massif, lourd comme l\'âge de glace.',       hue: 285, accent: '#B39DDB', toolSkin: 'paper', priceCents: P, free: false },
  rhino:          { id: 'rhino',          name: 'Rhino',          displayName: 'Rhinocéros',      emoji: '🦏',    tagline: 'Charge brutale. Une direction.',                     hue: 200, toolSkin: 'mono', priceCents: P, free: false },
  hippo:          { id: 'hippo',          name: 'Hippo',          displayName: 'Hippopotame',     emoji: '🦛',    tagline: 'Jovial et massif. Étonnamment rapide.',              hue: 318, accent: '#EC407A', toolSkin: 'neon', priceCents: P, free: false },

  // Small mammals
  mouse:          { id: 'mouse',          name: 'Mouse',          displayName: 'Souris',          emoji: '🐭',    tagline: 'Discrète, curieuse, sortie rapide.',                 hue: 290, accent: '#BA68C8', toolSkin: 'glass', priceCents: P, free: false },
  rat:            { id: 'rat',            name: 'Rat',            displayName: 'Rat',             emoji: '🐀',    tagline: 'Débrouillard, survivant, trouve toujours.',          hue: 300, accent: '#AD1457', toolSkin: 'terminal', priceCents: P, free: false },
  hamster:        { id: 'hamster',        name: 'Hamster',        displayName: 'Hamster',         emoji: '🐹',    tagline: 'Enthousiaste, accumule pour plus tard.',             hue: 28,  accent: '#FF8F00', toolSkin: 'neon', priceCents: P, free: false },
  rabbit:         { id: 'rabbit',         name: 'Rabbit',         displayName: 'Lapin',           emoji: '🐰',    tagline: 'Rapide, agile, joyeux.',                             hue: 322, accent: '#F06292', toolSkin: 'neon', priceCents: P, free: false },
  chipmunk:       { id: 'chipmunk',       name: 'Chipmunk',       displayName: 'Tamia',           emoji: '🐿️',  tagline: 'Affairé, collecte, vif comme l\'éclair.',            hue: 32,  toolSkin: 'card', priceCents: P, free: false },
  beaver:         { id: 'beaver',         name: 'Beaver',         displayName: 'Castor',          emoji: '🦫',    tagline: 'Bâtisseur infatigable. Construit des barrages.',     hue: 26,  toolSkin: 'paper', priceCents: P, free: false },
  hedgehog:       { id: 'hedgehog',       name: 'Hedgehog',       displayName: 'Hérisson',        emoji: '🦔',    tagline: 'Prudent, piquant, méticuleux.',                      hue: 70,  toolSkin: 'paper', priceCents: P, free: false },
  bat:            { id: 'bat',            name: 'Bat',            displayName: 'Chauve-souris',   emoji: '🦇',    tagline: 'Nocturne, écholocation, inquiétante.',               hue: 260, accent: '#4527A0', toolSkin: 'terminal', priceCents: P, free: false },

  // Bears + various
  bear:           { id: 'bear',           name: 'Bear',           displayName: 'Ours',            emoji: '🐻',    tagline: 'Solide, direct, stable.',                            hue: 25,  toolSkin: 'paper', priceCents: P, free: false },
  polar_bear:     { id: 'polar_bear',     name: 'Polar Bear',     displayName: 'Ours polaire',    emoji: '🐻‍❄️', tagline: 'Glacial. Lent, mortel.',                          hue: 205, neutral2: 'light', toolSkin: 'mono', priceCents: P, free: false },
  koala:          { id: 'koala',          name: 'Koala',          displayName: 'Koala',           emoji: '🐨',    tagline: 'Somnolent, cool, expert basse consommation.',        hue: 115, toolSkin: 'glass', priceCents: P, free: false },
  panda:          { id: 'panda',          name: 'Panda',          displayName: 'Panda',           emoji: '🐼',    tagline: 'Calme, équilibré, zen.',                             hue: 108, neutral2: 'dark', neutral3: 'light', toolSkin: 'mono', priceCents: P, free: false },
  sloth:          { id: 'sloth',          name: 'Sloth',          displayName: 'Paresseux',       emoji: '🦥',    tagline: 'Lent, posé, jamais pressé.',                         hue: 85,  accent: '#4CAF50', toolSkin: 'glass', priceCents: P, free: false },
  otter:          { id: 'otter',          name: 'Otter',          displayName: 'Loutre',          emoji: '🦦',    tagline: 'Joueuse, sociable, prend la main.',                  hue: 192, accent: '#00ACC1', toolSkin: 'glass', priceCents: P, free: false },
  skunk:          { id: 'skunk',          name: 'Skunk',          displayName: 'Mouffette',       emoji: '🦨',    tagline: 'Distinctive, imperturbable, dernier avertissement.', hue: 275, neutral2: 'light', neutral3: 'dark', toolSkin: 'mono', priceCents: P, free: false },
  kangaroo:       { id: 'kangaroo',       name: 'Kangaroo',       displayName: 'Kangourou',       emoji: '🦘',    tagline: 'Bondissant, agile, poche bien remplie.',             hue: 24,  toolSkin: 'card', priceCents: P, free: false },
  badger:         { id: 'badger',         name: 'Badger',         displayName: 'Blaireau',        emoji: '🦡',    tagline: 'Coriace, ne lâche rien, creuse fort.',               hue: 220, toolSkin: 'mono', priceCents: P, free: false },

  // Birds
  turkey:         { id: 'turkey',         name: 'Turkey',         displayName: 'Dinde',           emoji: '🦃',    tagline: 'Festive, abondante, déploie en éventail.',           hue: 20,  toolSkin: 'card', priceCents: P, free: false },
  chicken:        { id: 'chicken',        name: 'Chicken',        displayName: 'Poule',           emoji: '🐔',    tagline: 'Bavarde, affairée, lève-tôt.',                       hue: 8,   toolSkin: 'card', priceCents: P, free: false },
  rooster:        { id: 'rooster',        name: 'Rooster',        displayName: 'Coq',             emoji: '🐓',    tagline: 'Annonceur. Fort, à l\'heure.',                       hue: 15,  hue2: 85, hue3: 30, palette: 'tri', accent: '#D2342B', accent2: '#E8B042', accent3: '#7A4A1F', toolSkin: 'neon', priceCents: P, free: false },
  chick:          { id: 'chick',          name: 'Chick',          displayName: 'Poussin',         emoji: '🐥',    tagline: 'Curieux, naïf, apprend vite.',                       hue: 95,  hue2: 95, hue3: 95, palette: 'mono', accent: '#C8A300', accent2: '#D4AF00', accent3: '#B8860B', toolSkin: 'neon', priceCents: P, free: false },
  bird:           { id: 'bird',           name: 'Bird',           displayName: 'Oiseau',          emoji: '🐦',    tagline: 'Léger, voltigeant, mélodieux.',                      hue: 218, accent: '#29B6F6', toolSkin: 'glass', priceCents: P, free: false },
  penguin:        { id: 'penguin',        name: 'Penguin',        displayName: 'Manchot',         emoji: '🐧',    tagline: 'Posé, poli, formel.',                                hue: 222, accent: '#5C6BC0', toolSkin: 'mono', priceCents: P, free: false },
  dove:           { id: 'dove',           name: 'Dove',           displayName: 'Colombe',         emoji: '🕊️',  tagline: 'Pacifique, douce, conciliante.',                     hue: 198, accent: '#4FC3F7', toolSkin: 'glass', priceCents: P, free: false },
  eagle:          { id: 'eagle',          name: 'Eagle',          displayName: 'Aigle',           emoji: '🦅',    tagline: 'Vue d\'aigle, piqué précis.',                        hue: 30,  hue2: 85, hue3: 230, neutral2: 'light', palette: 'tri', toolSkin: 'terminal', accent: '#6B3E1F', accent3: '#5BA8D1', priceCents: P, free: false },
  duck:           { id: 'duck',           name: 'Duck',           displayName: 'Canard',          emoji: '🦆',    tagline: 'Cool en surface, pagaie en dessous.',                hue: 88,  accent: '#66BB6A', toolSkin: 'card', priceCents: P, free: false },
  swan:           { id: 'swan',           name: 'Swan',           displayName: 'Cygne',           emoji: '🦢',    tagline: 'Élégant, digne, glisse.',                            hue: 230, accent: '#2196F3', toolSkin: 'glass', priceCents: P, free: false },
  owl:            { id: 'owl',            name: 'Owl',            displayName: 'Chouette',        emoji: '🦉',    tagline: 'Patient, précis, analytique.',                       hue: 244, accent: '#3949AB', toolSkin: 'terminal', priceCents: P, free: false },
  dodo:           { id: 'dodo',           name: 'Dodo',           displayName: 'Dodo',            emoji: '🦤',    tagline: 'Disparu, contrariant, vestige bizarre.',             hue: 34,  toolSkin: 'card', priceCents: P, free: false },
  flamingo:       { id: 'flamingo',       name: 'Flamingo',       displayName: 'Flamant rose',    emoji: '🦩',    tagline: 'Voyant, audacieux, en équilibre sur une patte.',     hue: 350, hue2: 15, hue3: 90, palette: 'bi',  toolSkin: 'neon', accent: '#F08CAB', accent2: '#E94E6E', priceCents: P, free: false },
  peacock:        { id: 'peacock',        name: 'Peacock',        displayName: 'Paon',            emoji: '🦚',    tagline: 'Fier, ostentatoire, déploie sa roue.',               hue: 188, hue2: 240, hue3: 140, palette: 'tri', toolSkin: 'neon', accent: '#1E8C9C', accent2: '#2B4FA4', accent3: '#1E8C5B', priceCents: P, free: false },
  parrot:         { id: 'parrot',         name: 'Parrot',         displayName: 'Perroquet',       emoji: '🦜',    tagline: 'Imitateur, coloré, bavard.',                         hue: 140, hue2: 90,  hue3: 25, palette: 'tri', accent: '#2EA84B', accent2: '#F5C842', accent3: '#D2342B', toolSkin: 'neon', priceCents: P, free: false },

  // Reptiles / Amphibians
  frog:           { id: 'frog',           name: 'Frog',           displayName: 'Grenouille',      emoji: '🐸',    tagline: 'Cool, observatrice, patiente.',                      hue: 140, hue2: 25, hue3: 90, palette: 'tri', toolSkin: 'paper', accent: '#5BA84A', accent2: '#D2342B', accent3: '#E8D24A', priceCents: P, free: false },
  crocodile:      { id: 'crocodile',      name: 'Crocodile',      displayName: 'Crocodile',      emoji: '🐊',    tagline: 'Embuscade patiente. Une seule attaque.',             hue: 90,  accent: '#558B2F', toolSkin: 'terminal', priceCents: P, free: false },
  turtle:         { id: 'turtle',         name: 'Turtle',         displayName: 'Tortue',          emoji: '🐢',    tagline: 'Doucement mais sûrement.',                           hue: 102, accent: '#00BFA5', toolSkin: 'card', priceCents: P, free: false },
  lizard:         { id: 'lizard',         name: 'Lizard',         displayName: 'Lézard',          emoji: '🦎',    tagline: 'Adaptatif, caméléon, soleil.',                       hue: 92,  accent: '#00C853', toolSkin: 'mono', priceCents: P, free: false },
  snake:          { id: 'snake',          name: 'Snake',          displayName: 'Serpent',         emoji: '🐍',    tagline: 'Rusé, lové, prêt à frapper.',                        hue: 130, accent: '#33691E', toolSkin: 'terminal', priceCents: P, free: false },

  // Dragons / Dinos
  dragon:         { id: 'dragon',         name: 'Dragon',         displayName: 'Dragon',          emoji: '🐲',    tagline: 'Mythique, audacieux, vaste.',                        hue: 15,  hue2: 85, hue3: 290, palette: 'tri', toolSkin: 'glass', accent: '#C8342B', accent2: '#D4A24C', accent3: '#7A3F9C', priceCents: P, free: false },
  eastern_dragon: { id: 'eastern_dragon', name: 'Eastern Dragon', displayName: 'Dragon oriental', emoji: '🐉',    tagline: 'Serpent sage. Puissance par l\'équilibre.',          hue: 15,  hue2: 85, hue3: 155, palette: 'tri', accent: '#C8342B', accent2: '#D4A24C', accent3: '#2E8B6B', toolSkin: 'mono', priceCents: P, free: false },
  sauropod:       { id: 'sauropod',       name: 'Sauropod',       displayName: 'Sauropode',       emoji: '🦕',    tagline: 'Massif, doux, préhistorique.',                       hue: 96,  accent: '#81C784', toolSkin: 'paper', priceCents: P, free: false },
  t_rex:          { id: 't_rex',          name: 'T-Rex',          displayName: 'T-Rex',           emoji: '🦖',    tagline: 'Prédateur ultime. Petits bras, grosse morsure.',     hue: 28,  accent: '#FF6F00', toolSkin: 'neon', priceCents: P, free: false },

  // Marine
  whale:          { id: 'whale',          name: 'Whale',          displayName: 'Baleine',         emoji: '🐋',    tagline: 'Profonde, posée, longue forme.',                     hue: 210, accent: '#1E88E5', toolSkin: 'glass', priceCents: P, free: false },
  spouting_whale: { id: 'spouting_whale', name: 'Spouting Whale', displayName: 'Baleine soufflante', emoji: '🐳', tagline: 'Majestueuse en surface. Souffle lumineux.',          hue: 195, accent: '#00BCD4', toolSkin: 'glass', priceCents: P, free: false },
  dolphin:        { id: 'dolphin',        name: 'Dolphin',        displayName: 'Dauphin',         emoji: '🐬',    tagline: 'Sympa, joueur, sociable.',                           hue: 220, hue2: 200, hue3: 250, neutral2: 'light', palette: 'tri', accent: '#3E78C4', accent3: '#A0B8C8', toolSkin: 'glass', priceCents: P, free: false },
  seal:           { id: 'seal',           name: 'Seal',           displayName: 'Phoque',          emoji: '🦭',    tagline: 'Lisse, joueur, lézarde au soleil.',                  hue: 215, accent: '#1565C0', toolSkin: 'glass', priceCents: P, free: false },
  fish:           { id: 'fish',           name: 'Fish',           displayName: 'Poisson',         emoji: '🐟',    tagline: 'Suit le courant. Va dans le sens du flux.',          hue: 225, accent: '#0288D1', toolSkin: 'glass', priceCents: P, free: false },
  tropical_fish:  { id: 'tropical_fish',  name: 'Tropical Fish',  displayName: 'Poisson tropical', emoji: '🐠',   tagline: 'Coloré, vif comme un récif.',                        hue: 30,  hue2: 230, hue3: 90, neutral2: 'light', palette: 'tri', accent: '#F4511E', accent3: '#F5D442', toolSkin: 'neon', priceCents: P, free: false },
  blowfish:       { id: 'blowfish',       name: 'Blowfish',       displayName: 'Poisson-globe',   emoji: '🐡',    tagline: 'Gonfle pour défense. Ne pas titiller.',              hue: 54,  toolSkin: 'neon', priceCents: P, free: false },
  shark:          { id: 'shark',          name: 'Shark',          displayName: 'Requin',          emoji: '🦈',    tagline: 'Agressif, efficace, relentless.',                    hue: 218, toolSkin: 'terminal', priceCents: P, free: false },
  octopus:        { id: 'octopus',        name: 'Octopus',        displayName: 'Poulpe',          emoji: '🐙',    tagline: 'Multitâche, méthodique.',                            hue: 330, hue2: 300, hue3: 280, palette: 'tri', toolSkin: 'terminal', accent: '#E85A95', accent2: '#C82B8E', accent3: '#7E3F9C', priceCents: P, free: false },

  // Shells / crustaceans / mollusks
  nautilus:       { id: 'nautilus',       name: 'Nautilus',       displayName: 'Nautile',         emoji: '🐚',    tagline: 'Ordre en spirale. Calme, protecteur.',               hue: 35,  hue2: 25, hue3: 350, neutral3: 'light', palette: 'tri', accent: '#A86A3E', accent2: '#C8542B', toolSkin: 'glass', priceCents: P, free: false },
  coral:          { id: 'coral',          name: 'Coral',          displayName: 'Corail',          emoji: '🪸',    tagline: 'Colonie symbiotique. Écosystème lent.',              hue: 12,  hue2: 85,  hue3: 200, palette: 'tri', accent: '#FF6B5B', accent2: '#D4A24C', accent3: '#3E9CAE', toolSkin: 'neon', priceCents: P, free: false },
  crab:           { id: 'crab',           name: 'Crab',           displayName: 'Crabe',           emoji: '🦀',    tagline: 'Stratège latéral. Attaque par le côté.',             hue: 5,   accent: '#FF5252', toolSkin: 'neon', priceCents: P, free: false },
  lobster:        { id: 'lobster',        name: 'Lobster',        displayName: 'Homard',          emoji: '🦞',    tagline: 'Pince audacieuse. Claquement décisif.',              hue: 358, hue2: 25,  accent: '#C2185B', toolSkin: 'neon', priceCents: P, free: false },
  shrimp:         { id: 'shrimp',         name: 'Shrimp',         displayName: 'Crevette',        emoji: '🦐',    tagline: 'Petite, rapide, en banc coordonné.',                 hue: 16,  hue2: 350, accent: '#FF7043', toolSkin: 'card', priceCents: P, free: false },
  squid:          { id: 'squid',          name: 'Squid',          displayName: 'Calmar',          emoji: '🦑',    tagline: 'Jet d\'encre et fuite. Évasif.',                     hue: 295, accent: '#CE93D8', toolSkin: 'glass', priceCents: P, free: false },

  // Insects + bugs
  snail:          { id: 'snail',          name: 'Snail',          displayName: 'Escargot',        emoji: '🐌',    tagline: 'Lent, régulier, laisse sa trace.',                   hue: 64,  accent: '#6B7A1F', toolSkin: 'card', priceCents: P, free: false },
  butterfly:      { id: 'butterfly',      name: 'Butterfly',      displayName: 'Papillon',        emoji: '🦋',    tagline: 'Transformateur, léger, éphémère.',                   hue: 30,  hue2: 85, hue3: 15, neutral2: 'dark', palette: 'tri', toolSkin: 'glass', accent: '#FF8A65', accent3: '#9E2B1F', priceCents: P, free: false },
  caterpillar:    { id: 'caterpillar',    name: 'Caterpillar',    displayName: 'Chenille',        emoji: '🐛',    tagline: 'Grandit, persistante, avant la métamorphose.',       hue: 104, accent: '#8BC34A', toolSkin: 'card', priceCents: P, free: false },
  ant:            { id: 'ant',            name: 'Ant',            displayName: 'Fourmi',          emoji: '🐜',    tagline: 'Colonie coordonnée. Trace de phéromones.',           hue: 22,  toolSkin: 'terminal', priceCents: P, free: false },
  bee:            { id: 'bee',            name: 'Bee',            displayName: 'Abeille',         emoji: '🐝',    tagline: 'Affairée, productive, structurée.',                  hue: 55,  neutral2: 'dark', accent: '#FFC107', toolSkin: 'card', priceCents: P, free: false },
  beetle:         { id: 'beetle',         name: 'Beetle',         displayName: 'Scarabée',        emoji: '🪲',    tagline: 'Carapace dure. Pousse à travers.',                   hue: 145, hue2: 195, hue3: 285, palette: 'tri', accent: '#2EA86B', accent2: '#3EC4C0', accent3: '#7A3F9C', toolSkin: 'card', priceCents: P, free: false },
  ladybug:        { id: 'ladybug',        name: 'Ladybug',        displayName: 'Coccinelle',      emoji: '🐞',    tagline: 'Chanceuse, précise, à pois.',                        hue: 15,  neutral2: 'dark', neutral3: 'light', palette: 'tri', toolSkin: 'paper', accent: '#D2342B', priceCents: P, free: false },
  cricket:        { id: 'cricket',        name: 'Cricket',        displayName: 'Grillon',         emoji: '🦗',    tagline: 'Chant rythmé. Concentration nocturne.',              hue: 82,  accent: '#9E9D24', toolSkin: 'card', priceCents: P, free: false },
  cockroach:      { id: 'cockroach',      name: 'Cockroach',      displayName: 'Cafard',          emoji: '🪳',    tagline: 'Increvable. Résistant à tout.',                      hue: 18,  toolSkin: 'terminal', priceCents: P, free: false },
  spider:         { id: 'spider',         name: 'Spider',         displayName: 'Araignée',        emoji: '🕷️',  tagline: 'Stratège de la toile. Embuscade patiente.',          hue: 286, accent: '#4A148C', toolSkin: 'terminal', priceCents: P, free: false },
  scorpion:       { id: 'scorpion',       name: 'Scorpion',       displayName: 'Scorpion',        emoji: '🦂',    tagline: 'Dard précis. Ne rate pas.',                          hue: 38,  toolSkin: 'terminal', priceCents: P, free: false },
  mosquito:       { id: 'mosquito',       name: 'Mosquito',       displayName: 'Moustique',       emoji: '🦟',    tagline: 'Persistant. Ne lâche pas.',                          hue: 248, accent: '#3F51B5', toolSkin: 'terminal', priceCents: P, free: false },
  fly:            { id: 'fly',            name: 'Fly',            displayName: 'Mouche',          emoji: '🪰',    tagline: 'Bourdonnante, opportuniste, omniprésente.',          hue: 76,  accent: '#827717', toolSkin: 'neon', priceCents: P, free: false },
  worm:           { id: 'worm',           name: 'Worm',           displayName: 'Ver',             emoji: '🪱',    tagline: 'Tunnel. Creuseur patient.',                          hue: 350, accent: '#FF4081', toolSkin: 'card', priceCents: P, free: false },
};

export const DEFAULT_ANIMAL: AnimalId = 'monkey';

export const VANILLA_ID = 'vanilla' as const;

export const VANILLA_PROFILE: AnimalProfile = {
  id: 'vanilla' as AnimalId,
  name: 'Vanilla',
  displayName: 'Vanille',
  emoji: '🍨',
  tagline: '',
  hue: 50,
  palette: 'mono',
  accent: '#E8D8A8',
  toolSkin: 'paper',
  priceCents: 0,
  free: true,
};

export const CODER_ID = 'coder' as const;

export const CODER_PROFILE: AnimalProfile = {
  id: 'coder' as AnimalId,
  name: 'Coder',
  displayName: 'Coder',
  emoji: '🤖',
  tagline: '',
  hue: 145,
  palette: 'mono',
  accent: '#5BFF9E',
  toolSkin: 'terminal',
  priceCents: 0,
  free: true,
};

export const ANIMAL_LIST: AnimalProfile[] = Object.values(ANIMALS);

export function getAnimal(id: AnimalId | string | null | undefined): AnimalProfile {
  if (!id || !(id in ANIMALS)) return ANIMALS[DEFAULT_ANIMAL];
  return ANIMALS[id as AnimalId];
}
