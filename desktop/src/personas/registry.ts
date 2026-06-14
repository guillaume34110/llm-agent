// Professional personas — B2B specialized skins.
// Selected via the unified persona picker; when active, the chosen pro id is
// sent to the backend as `animal_id` (monkey/personas.py picks it up via
// is_pro() to apply pack restriction + role overlay).
//
// Animals stay untouched as the B2C "generalist" path.
//
// Mirror file: monkey/personas.py — keep ids / packs in sync.

export type ProId =
  | 'secretary'
  | 'hr'
  | 'accountant'
  | 'sales'
  | 'marketing'
  | 'legal'
  | 'recruiter'
  | 'support'
  | 'analyst'
  | 'office_manager';

export type ToolSkin = 'terminal' | 'card' | 'mono' | 'glass' | 'neon' | 'paper';

export interface ProPersona {
  id: ProId;
  displayName: string;
  emoji: string;
  tagline: string;
  /** Tool packs the backend restricts to (informational; runtime source = monkey/personas.py). */
  packs: string[];
  skills: string[];
  /** Visual identity (skin). */
  hue: number;
  hue2?: number;
  hue3?: number;
  accent?: string;
  accent2?: string;
  accent3?: string;
  palette?: 'mono' | 'bi' | 'tri';
  toolSkin?: ToolSkin;
}

export const PROS: Record<ProId, ProPersona> = {
  secretary: {
    id: 'secretary',
    displayName: 'Secrétaire',
    emoji: '📋',
    tagline: 'Agenda, mails, rendez-vous, suivi.',
    packs: ['mail', 'calendar', 'whatsapp', 'files', 'media'],
    skills: ['Tri mails', 'Réponses pro', 'Création RDV', 'Rappels', 'Brouillons docs', 'Relances'],
    hue: 215, accent: '#3D7EC8', toolSkin: 'paper',
  },
  hr: {
    id: 'hr',
    displayName: 'Assistant Connaissance RH',
    emoji: '👥',
    // EU AI Act: knowledge/draft assistant only — NEVER decisional (Annex III(4) employment).
    tagline: 'Aide rédactionnelle & connaissance RH. Jamais décisionnel (AI Act).',
    packs: ['mail', 'calendar', 'files', 'media'],
    skills: ['Onboarding (rédaction)', 'Congés (calculs)', 'Politiques RH', 'Brouillons comms', 'Confidentialité', 'Q/R procédures'],
    hue: 350, accent: '#E26680', toolSkin: 'card',
  },
  accountant: {
    id: 'accountant',
    displayName: 'Comptable',
    emoji: '🧮',
    tagline: 'Factures, TVA, exports compta.',
    packs: ['files', 'media', 'mail'],
    skills: ['Lecture factures', 'TVA', 'Rapprochement', 'Export CSV/XLSX', 'Note de frais', 'Suivi paiements'],
    hue: 140, accent: '#4E8C5F', toolSkin: 'mono',
  },
  sales: {
    id: 'sales',
    displayName: 'Commercial',
    emoji: '💼',
    tagline: 'Prospection, relances, devis, CRM.',
    packs: ['mail', 'whatsapp', 'calendar', 'browse', 'search'],
    skills: ['Prospection', 'Cold mail', 'Relance', 'Qualification', 'Devis', 'Suivi pipeline'],
    hue: 25, accent: '#F26A1C', toolSkin: 'neon',
  },
  marketing: {
    id: 'marketing',
    displayName: 'Marketing',
    emoji: '📣',
    tagline: 'Contenu, posts, visuels, SEO.',
    packs: ['browse', 'search', 'image', 'media', 'mail'],
    skills: ['Copywriting', 'SEO', 'Posts réseaux', 'Visuels', 'Newsletters', 'Veille concurrence'],
    hue: 285, accent: '#9B5BD8', toolSkin: 'glass',
  },
  legal: {
    id: 'legal',
    displayName: 'Assistant Juridique (information)',
    emoji: '⚖️',
    // EU AI Act: information juridique, jamais conseil professionnel ni décision judiciaire (Annex III(8)).
    tagline: 'Info contrats, conformité, RGPD. Pas un avis juridique.',
    packs: ['files', 'media', 'mail', 'browse', 'search'],
    skills: ['Lecture contrats', 'Rédaction clauses', 'RGPD', 'CGV/CGU', 'Veille légale', 'Risques'],
    hue: 355, accent: '#7B1F2B', toolSkin: 'paper',
  },
  recruiter: {
    id: 'recruiter',
    displayName: 'Assistant Recrutement (rédaction)',
    emoji: '🎯',
    // EU AI Act: rédaction & organisation uniquement — pas de ranking/sélection automatisée (Annex III(4)).
    tagline: 'Annonces, prep entretiens, offres. Ranking & sélection = humain.',
    packs: ['mail', 'browse', 'search', 'calendar', 'media'],
    skills: ['Rédaction annonces', 'Lecture CV (résumé)', 'Prep entretiens', 'Rédaction offres', 'Planning', 'Onboarding initial'],
    hue: 178, accent: '#1FAE9F', toolSkin: 'card',
  },
  support: {
    id: 'support',
    displayName: 'Support',
    emoji: '🎧',
    tagline: 'Réponses client, FAQ, tickets.',
    packs: ['mail', 'whatsapp', 'search'],
    skills: ['Réponses tickets', 'FAQ', 'Escalade', 'Suivi SLA', 'Ton empathique', 'Tri'],
    hue: 205, accent: '#3496D0', toolSkin: 'mono',
  },
  analyst: {
    id: 'analyst',
    displayName: 'Analyste Data',
    emoji: '📊',
    // EU AI Act: data agrégée & métier OK. Scoring de personnes physiques = high-risk → interdit ici.
    tagline: 'KPIs, rapports, data métier. Pas de scoring de personnes.',
    packs: ['files', 'media', 'code'],
    skills: ['Excel/CSV', 'Pivot', 'Graphiques', 'KPIs', 'Rapports', 'Vérification chiffres'],
    hue: 220, accent: '#5C6B82', toolSkin: 'terminal',
  },
  office_manager: {
    id: 'office_manager',
    displayName: 'Office Manager',
    emoji: '🏢',
    tagline: 'Fournisseurs, badges, événements.',
    packs: ['mail', 'calendar', 'whatsapp', 'files', 'media'],
    skills: ['Fournisseurs', 'Badges', 'Logistique', 'Onboarding poste', 'Événements', 'Notes de frais'],
    hue: 38, accent: '#CC8E2C', toolSkin: 'paper',
  },
};

export const PRO_LIST: ProPersona[] = [
  PROS.secretary,
  PROS.hr,
  PROS.accountant,
  PROS.sales,
  PROS.marketing,
  PROS.legal,
  PROS.recruiter,
  PROS.support,
  PROS.analyst,
  PROS.office_manager,
];

export function isProId(id: string | null | undefined): id is ProId {
  return !!id && id in PROS;
}

export function getPro(id: string | null | undefined): ProPersona | null {
  return isProId(id) ? PROS[id] : null;
}
