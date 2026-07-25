/**
 * UI string catalogue (T1.7).
 *
 * French is the DEFAULT — the target market is Île-de-France golfers and
 * every plan document is in French. English is the fallback: any key missing
 * from `fr` falls back to `en`, and a missing key in both renders the key
 * itself (visible in dev, never a crash).
 *
 * Vocabulary is fixed (Delivery Spec §5) and must stay consistent:
 *   Game → Partie · Match → Sortie · Round → Tour · Card → Carte
 *   Standings → Classement
 * "League" only appears in brand copy.
 *
 * Keys are dotted and grouped by surface. Interpolation uses {name} tokens.
 */

export type Locale = "fr" | "en"

export const LOCALES: Locale[] = ["fr", "en"]
export const DEFAULT_LOCALE: Locale = "fr"

type Dict = Record<string, string>

export const en: Dict = {
  // ── common ────────────────────────────────────────────────
  "common.loading": "Loading…",
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.continue": "Continue",
  "common.skip": "Skip for now",
  "common.retry": "Try again",
  "common.error.generic": "Something went wrong.",
  "common.optional": "(optional)",
  "common.required": "(required)",

  // ── nav ───────────────────────────────────────────────────
  "nav.home": "Home",
  "nav.games": "Games",
  "nav.players": "Players",
  "nav.profile": "Profile",
  "nav.new": "New",
  "nav.new.round": "Record a round",
  "nav.new.game": "Create a game",
  "nav.new.join": "Join with code",
  "nav.menu.profile": "Profile",
  "nav.menu.calendar": "My calendar",
  "nav.menu.notifications": "Notification settings",
  "nav.menu.logout": "Log out",
  "nav.menu.language": "Language",
  "nav.account": "Account menu",

  // ── auth / landing ────────────────────────────────────────
  "auth.tagline": "Your weekend golf crew, organized.",
  "auth.subtitle": "Games, scores, bragging rights, all in one place.",
  "auth.login": "Log In",
  "auth.signup": "Sign Up",
  "auth.google": "Continue with Google",
  "auth.apple": "Continue with Apple",
  "auth.or": "or",
  "auth.redirecting": "Redirecting…",
  "auth.provider.off": "{provider} sign-in isn't switched on yet.",

  // ── onboarding ────────────────────────────────────────────
  "onboarding.welcome": "Welcome to Mulligan",
  "onboarding.brandline": "Your Game. Your League.",
  "onboarding.pitch":
    "Turn your regular golf crew into a real competition — schedule rounds, log scores, and settle who's actually best.",
  "onboarding.start": "Get started",
  "onboarding.name.title": "What should we call you?",
  "onboarding.name.subtitle": "This is the name your crew sees on the standings.",
  "onboarding.username": "Username",
  "onboarding.club": "Home club",
  "onboarding.town": "Town",
  "onboarding.nohandicap":
    "No handicap needed — you can add a photo and details later from your profile.",
  "onboarding.username.short": "Pick a username (at least 2 characters).",
  "onboarding.username.taken": "That username is taken — try another.",
  "onboarding.join.title": "Get into a game",
  "onboarding.join.subtitle":
    "Got an invite code from a friend? Use it. Otherwise start your own.",
  "onboarding.join.code": "Join with a code",
  "onboarding.join.code.sub": "Your crew already has a game going",
  "onboarding.join.create": "Create a game",
  "onboarding.join.create.sub": "Start a league and invite your friends",

  // ── home ──────────────────────────────────────────────────
  "home.greeting": "Hi, {name}",
  "home.greeting.anon": "Welcome back",
  "home.subtitle": "Here's what needs you.",
  "home.loading": "Loading your home…",
  "home.action.approve": "Scores waiting for your approval",
  "home.action.approve.cta": "Review",
  "home.action.enter": "Enter your score",
  "home.action.enter.cta": "Enter",
  "home.caughtup": "You're all caught up",
  "home.caughtup.sub": "No scores waiting on you right now.",
  "home.next": "Next match",
  "home.next.none": "Nothing scheduled.",
  "home.next.cta": "Schedule a round",
  "home.standings": "Where you stand",
  "home.cards": "{counted}/{total} cards",

  // ── games hub ─────────────────────────────────────────────
  "games.title": "Games",
  "games.subtitle": "Your crews and competitions.",
  "games.loading": "Loading games…",
  "games.join": "Join",
  "games.create": "Create",
  "games.create.full": "Create Game",
  "games.join.full": "Join Game",
  "games.section.active": "Active",
  "games.section.upcoming": "Upcoming",
  "games.section.completed": "Completed",
  "games.requests": "Requests to review",
  "games.requests.review": "Review",
  "games.requests.match": " wants to join a match",
  "games.requests.game": " wants to join a game",
  "games.empty.title": "No games yet",
  "games.empty.body":
    "Start a game for your crew, or ask a buddy for their invite code.",
  "games.card.nocourse": "No course set",
  "games.card.next": "Next {date}",
  "games.card.final": "Final",
  "games.card.nomatch": "No match yet",
  "games.show": "Show",
  "games.hide": "Hide",

  // ── course autocomplete ───────────────────────────────────
  "course.label": "Golf course",
  "course.placeholder": "Golf National, Saint-Nom-la-Bretêche…",
  "course.verified": "Verified",
  "course.freetext": "Not in our course list — we'll save it as typed.",
  "course.holes": "{n} holes",
  "course.par": "Par {n}",

  // ── invite deep link ──────────────────────────────────────
  "invite.invited": "You're invited to",
  "invite.course": "Course",
  "invite.format": "Format",
  "invite.players": "Players",
  "invite.notset": "Not set",
  "invite.join": "Join this game",
  "invite.joining": "Joining…",
  "invite.signup": "Sign up & join",
  "invite.havelogin": "I already have an account",
  "invite.spots": "{n} spots left",
  "invite.spots.one": "1 spot left",
  "invite.invalid.title": "This invite isn't valid",
  "invite.invalid.body":
    "The code {code} doesn't match any game. It may have been mistyped or the game was deleted.",
  "invite.manual": "Enter a code manually",
  "invite.browse": "Browse your games",
  "invite.gomulligan": "Go to Mulligan",
  "invite.full": "This game is full ({max} players).",
  "invite.completed": "This game has already finished, so it isn't taking new players.",
  "invite.failed": "We couldn't add you to this game.",
  "invite.lookupfailed": "We couldn't look up that invite.",

  // ── consent (CNIL) ────────────────────────────────────────
  "consent.title": "Help us improve Mulligan",
  "consent.body":
    "We'd like to measure anonymous usage to see where new players get stuck. Nothing is collected unless you accept.",
  "consent.privacy": "Privacy policy",
  "consent.accept": "Accept",
  "consent.refuse": "Refuse",

  // ── profile cards (possessive-aware) ───────────────────────
  "profile.trajectory.own": "Your trajectory",
  "profile.trajectory.other": "{name}'s trajectory",
  "profile.honors.own": "Your honors",
  "profile.honors.other": "{name}'s honors",
}

export const fr: Dict = {
  // ── common ────────────────────────────────────────────────
  "common.loading": "Chargement…",
  "common.back": "Retour",
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.continue": "Continuer",
  "common.skip": "Plus tard",
  "common.retry": "Réessayer",
  "common.error.generic": "Une erreur est survenue.",
  "common.optional": "(facultatif)",
  "common.required": "(obligatoire)",

  // ── nav ───────────────────────────────────────────────────
  "nav.home": "Accueil",
  "nav.games": "Parties",
  "nav.players": "Joueurs",
  "nav.profile": "Profil",
  "nav.new": "Nouveau",
  "nav.new.round": "Saisir un tour",
  "nav.new.game": "Créer une partie",
  "nav.new.join": "Rejoindre avec un code",
  "nav.menu.profile": "Profil",
  "nav.menu.calendar": "Mon calendrier",
  "nav.menu.notifications": "Préférences de notifications",
  "nav.menu.logout": "Se déconnecter",
  "nav.menu.language": "Langue",
  "nav.account": "Menu du compte",

  // ── auth / landing ────────────────────────────────────────
  "auth.tagline": "Votre partie de golf entre amis, organisée.",
  "auth.subtitle": "Parties, scores et fierté — au même endroit.",
  "auth.login": "Connexion",
  "auth.signup": "Inscription",
  "auth.google": "Continuer avec Google",
  "auth.apple": "Continuer avec Apple",
  "auth.or": "ou",
  "auth.redirecting": "Redirection…",
  "auth.provider.off": "La connexion {provider} n'est pas encore activée.",

  // ── onboarding ────────────────────────────────────────────
  "onboarding.welcome": "Bienvenue sur Mulligan",
  "onboarding.brandline": "Votre partie. Votre ligue.",
  "onboarding.pitch":
    "Transformez vos sorties entre amis en vraie compétition — planifiez vos tours, enregistrez vos scores, et réglez enfin qui joue le mieux.",
  "onboarding.start": "C'est parti",
  "onboarding.name.title": "Comment doit-on vous appeler ?",
  "onboarding.name.subtitle": "Ce nom apparaîtra au classement.",
  "onboarding.username": "Nom d'utilisateur",
  "onboarding.club": "Club d'attache",
  "onboarding.town": "Ville",
  "onboarding.nohandicap":
    "Pas besoin d'index — vous pourrez ajouter une photo et vos infos plus tard depuis votre profil.",
  "onboarding.username.short": "Choisissez un nom d'utilisateur (2 caractères minimum).",
  "onboarding.username.taken": "Ce nom est déjà pris — essayez-en un autre.",
  "onboarding.join.title": "Rejoignez une partie",
  "onboarding.join.subtitle":
    "Un code d'invitation d'un ami ? Utilisez-le. Sinon, lancez la vôtre.",
  "onboarding.join.code": "Rejoindre avec un code",
  "onboarding.join.code.sub": "Vos amis ont déjà une partie en cours",
  "onboarding.join.create": "Créer une partie",
  "onboarding.join.create.sub": "Lancez une ligue et invitez vos amis",

  // ── home ──────────────────────────────────────────────────
  "home.greeting": "Salut {name}",
  "home.greeting.anon": "Bon retour",
  "home.subtitle": "Voici ce qui vous attend.",
  "home.loading": "Chargement de votre accueil…",
  "home.action.approve": "Des scores attendent votre validation",
  "home.action.approve.cta": "Vérifier",
  "home.action.enter": "Saisissez votre score",
  "home.action.enter.cta": "Saisir",
  "home.caughtup": "Vous êtes à jour",
  "home.caughtup.sub": "Aucun score en attente pour le moment.",
  "home.next": "Prochaine sortie",
  "home.next.none": "Rien de prévu.",
  "home.next.cta": "Planifier un tour",
  "home.standings": "Votre classement",
  "home.cards": "{counted}/{total} cartes",

  // ── games hub ─────────────────────────────────────────────
  "games.title": "Parties",
  "games.subtitle": "Vos équipes et compétitions.",
  "games.loading": "Chargement des parties…",
  "games.join": "Rejoindre",
  "games.create": "Créer",
  "games.create.full": "Créer une partie",
  "games.join.full": "Rejoindre une partie",
  "games.section.active": "En cours",
  "games.section.upcoming": "À venir",
  "games.section.completed": "Terminées",
  "games.requests": "Demandes à traiter",
  "games.requests.review": "Traiter",
  "games.requests.match": " souhaite rejoindre une sortie",
  "games.requests.game": " souhaite rejoindre une partie",
  "games.empty.title": "Aucune partie",
  "games.empty.body":
    "Lancez une partie pour vos amis, ou demandez-leur leur code d'invitation.",
  "games.card.nocourse": "Parcours non défini",
  "games.card.next": "Le {date}",
  "games.card.final": "Terminée",
  "games.card.nomatch": "Aucune sortie prévue",
  "games.show": "Afficher",
  "games.hide": "Masquer",

  // ── course autocomplete ───────────────────────────────────
  "course.label": "Parcours",
  "course.placeholder": "Golf National, Saint-Nom-la-Bretêche…",
  "course.verified": "Vérifié",
  "course.freetext": "Absent de notre base — nous l'enregistrons tel quel.",
  "course.holes": "{n} trous",
  "course.par": "Par {n}",

  // ── invite deep link ──────────────────────────────────────
  "invite.invited": "Vous êtes invité à",
  "invite.course": "Parcours",
  "invite.format": "Format",
  "invite.players": "Joueurs",
  "invite.notset": "Non défini",
  "invite.join": "Rejoindre cette partie",
  "invite.joining": "Ajout en cours…",
  "invite.signup": "S'inscrire et rejoindre",
  "invite.havelogin": "J'ai déjà un compte",
  "invite.spots": "{n} places restantes",
  "invite.spots.one": "1 place restante",
  "invite.invalid.title": "Cette invitation n'est pas valide",
  "invite.invalid.body":
    "Le code {code} ne correspond à aucune partie. Il a peut-être été mal saisi, ou la partie a été supprimée.",
  "invite.manual": "Saisir un code manuellement",
  "invite.browse": "Voir mes parties",
  "invite.gomulligan": "Aller sur Mulligan",
  "invite.full": "Cette partie est complète ({max} joueurs).",
  "invite.completed": "Cette partie est terminée et n'accepte plus de joueurs.",
  "invite.failed": "Impossible de vous ajouter à cette partie.",
  "invite.lookupfailed": "Impossible de retrouver cette invitation.",

  // ── consent (CNIL) ────────────────────────────────────────
  "consent.title": "Aidez-nous à améliorer Mulligan",
  "consent.body":
    "Nous aimerions mesurer l'usage de façon anonyme pour voir où les nouveaux joueurs bloquent. Rien n'est collecté sans votre accord.",
  "consent.privacy": "Politique de confidentialité",
  "consent.accept": "Accepter",
  "consent.refuse": "Refuser",

  // ── profile cards (possessive-aware) ───────────────────────
  "profile.trajectory.own": "Votre progression",
  "profile.trajectory.other": "Progression de {name}",
  "profile.honors.own": "Vos trophées",
  "profile.honors.other": "Trophées de {name}",
}

export const dictionaries: Record<Locale, Dict> = { fr, en }
