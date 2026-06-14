export type Locale = 'fr' | 'en';
type Dict = Record<string, string>;
const FR: Dict = {
  // Auth / Login
  'login.title': 'Connexion',
  'login.email': 'Email',
  'login.password': 'Mot de passe',
  'login.submit': 'Se connecter',
  'login.signup': 'Créer un compte',
  'login.forgot': 'Mot de passe oublié ?',
  // App states
  'app.loading': 'Démarrage du moteur local…',
  'app.loading.models': 'Chargement des modèles…',
  'app.loading.db': 'Initialisation de la base locale…',
  'app.loading.almost': 'Presque prêt…',
  'app.loading.hold': 'Toujours en route, tiens bon…',
  'app.privacy.tagline': 'Tout reste sur ta machine.',
  'app.error.server': 'Le serveur local ne répond pas.',
  'app.error.retry': 'Réessayer',
  // Top bar / nav
  'nav.chat': 'Chat',
  'nav.library': 'Bibliothèque',
  'nav.settings': 'Réglages',
  'nav.tasks': 'Tâches',
  // Input bar
  'input.send': 'Envoyer',
  'input.placeholder': 'Tape ta demande, glisse un fichier, ou dicte…',
  'input.stop': 'Stop',
  'input.mic.start': 'Démarrer la dictée',
  'input.mic.stop': 'Arrêter la dictée',
  // Settings
  'settings.title': 'Réglages',
  'settings.simple': 'Simple',
  'settings.advanced': 'Avancé',
  'settings.search.placeholder': 'Chercher dans les réglages…',
  'settings.section.persona': 'Persona',
  'settings.section.behavior': 'Comportement',
  'settings.section.help': 'Aide',
  'settings.section.privacy': 'Vie privée',
  'settings.section.security': 'Sécurité',
  'settings.section.legal': 'Légal',
  'settings.locale': 'Langue',
  'settings.music.title': 'Modèle musique',
  'settings.music.help': 'Modèle pour générer de la musique.',
  'settings.music.loading': 'Chargement des modèles musique…',
  'settings.music.selected': 'Modèle choisi',
  // Library
  'library.memory': 'Mémoire',
  'library.upcoming': 'Tâches à venir',
  'library.finished': 'Tâches terminées',
  'library.documents': 'Documents',
  'library.empty.memory': 'Aucun souvenir pour l\'instant.',
  'library.empty.upcoming': 'Rien de planifié.',
  'library.empty.documents': 'Aucun document.',
  'library.cta.memory': 'Crée un souvenir',
  'library.cta.task': 'Planifier une tâche',
  'library.cta.document': 'Importer un document',
  'library.search.placeholder': 'Chercher dans la mémoire ou les documents',
  // Onboarding
  'onboarding.welcome': 'Bienvenue dans',
  'onboarding.subtitle': 'Assistant personnel local-first',
  'onboarding.cta': 'Commencer',
  // Tour
  'tour.cta': 'C\'est parti',
  // Errors / generic
  'error.crashed': 'Quelque chose a planté.',
  'error.retry': 'Réessaie ou recharge l\'app.',
  'error.reload': 'Recharger',
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.delete': 'Supprimer',
  'common.confirm': 'Confirmer',
  'common.close': 'Fermer',
  // outfitting screen (camp before the map)
  // status line
  // setup wizard
  // expedition loading screen
  // buttons
  // pickers
  // sizes
  // difficulties
  // actions
  // dungeon / interior
  // narration
  // combat
  // map
  // confirms
  // lodge
  // satchel / party
  // end screen
  // chapter board
  // misc / flavour
  // lodge stat words (interpolated readouts)
  // continue / resume saves
  // campaign setup
  // prologue — heroic-fantasy framing shown first (the Crown, the Reliquary, the Relic-Seeker)
  // campaign intro
  // story acts — the bounded 4-Year arc, charged by Mirelle Vance
  // expedition picker banner
  // crown hub
  // scene
  // dungeon
  // conversation
  // combat results
  // tactical board (CE2)
  // iso-CE die maneuver icons (what a refined die can fuse into)
  // iso-CE named combos (icon patterns fusing into a named maneuver)
  // foe battle personality (closed enum — drives its dice lean + whom it strikes)
  // party / morale / provisions
  // character card
  // party view
  // inventory
  // end screen
};
const EN: Dict = {
  // Auth / Login
  'login.title': 'Sign in',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.signup': 'Create account',
  'login.forgot': 'Forgot password?',
  // App states
  'app.loading': 'Starting local engine…',
  'app.loading.models': 'Loading models…',
  'app.loading.db': 'Initializing local database…',
  'app.loading.almost': 'Almost ready…',
  'app.loading.hold': 'Still running, hang tight…',
  'app.privacy.tagline': 'Everything stays on your device.',
  'app.error.server': 'Local server is not responding.',
  'app.error.retry': 'Retry',
  // Top bar / nav
  'nav.chat': 'Chat',
  'nav.library': 'Library',
  'nav.settings': 'Settings',
  'nav.tasks': 'Tasks',
  // Input bar
  'input.send': 'Send',
  'input.placeholder': 'Type your request, drag a file, or speak…',
  'input.stop': 'Stop',
  'input.mic.start': 'Start voice input',
  'input.mic.stop': 'Stop voice input',
  // Settings
  'settings.title': 'Settings',
  'settings.simple': 'Simple',
  'settings.advanced': 'Advanced',
  'settings.search.placeholder': 'Search settings…',
  'settings.section.persona': 'Persona',
  'settings.section.behavior': 'Behavior',
  'settings.section.help': 'Help',
  'settings.section.privacy': 'Privacy',
  'settings.section.security': 'Security',
  'settings.section.legal': 'Legal',
  'settings.locale': 'Language',
  'settings.music.title': 'Music model',
  'settings.music.help': 'Model used to generate music.',
  'settings.music.loading': 'Loading music models…',
  'settings.music.selected': 'Selected model',
  // Library
  'library.memory': 'Memory',
  'library.upcoming': 'Upcoming tasks',
  'library.finished': 'Finished tasks',
  'library.documents': 'Documents',
  'library.empty.memory': 'No memories yet.',
  'library.empty.upcoming': 'Nothing scheduled.',
  'library.empty.documents': 'No documents.',
  'library.cta.memory': 'Create a memory',
  'library.cta.task': 'Schedule a task',
  'library.cta.document': 'Import a document',
  'library.search.placeholder': 'Search memory or documents',
  // Onboarding
  'onboarding.welcome': 'Welcome to',
  'onboarding.subtitle': 'Local-first personal assistant',
  'onboarding.cta': 'Get started',
  // Tour
  'tour.cta': 'Let\'s go',
  // Errors / generic
  'error.crashed': 'Something went wrong.',
  'error.retry': 'Try again or reload the app.',
  'error.reload': 'Reload',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  // outfitting screen (camp before the map)
  // expedition loading screen
  // iso-CE die maneuver icons (what a refined die can fuse into)
  // iso-CE named combos (icon patterns fusing into a named maneuver)
};
const DICTS: Record<Locale, Dict> = { fr: FR, en: EN };
let currentLocale: Locale = 'fr';
const listeners = new Set<() => void>();
export function setLocale(l: Locale) {
  if (!(l in DICTS)) return;
  currentLocale = l;
  listeners.forEach(fn => fn());
}
export function getLocale(): Locale {
  return currentLocale;
}
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentLocale] || FR;
  let s = dict[key] ?? FR[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}
