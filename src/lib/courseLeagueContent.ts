/** Verified pilot-course facts; pars match the public nine-hole scorecards. */
export const courseLeagueContent: Record<string, {
  label: string; entry: string; city: string; par: number; title: string; description: string;
  intro: string; tip: string; source: string; sourceLabel: string; otherSlug: string; otherLabel: string
}> = {
  "golf-de-rueil-malmaison-rueil-malmaison": {
    label: "Rueil-Malmaison", entry: "course_rueil", city: "Rueil-Malmaison", par: 32,
    title: "Golf de Rueil-Malmaison — carte de score et ligue entre amis",
    description: "Golf de Rueil-Malmaison : carte de score 9 trous, par 32. Créez votre ligue privée, invitez vos amis et partagez une saison sur 9 ou 18 trous avec Mulligan.",
    intro: "Vous jouez au golf de Rueil-Malmaison avec le même groupe ? Retrouvez vos cartes et donnez une suite à vos parties dans une ligue privée. Ce parcours de 9 trous, par 32, se trouve à Rueil-Malmaison, dans les Hauts-de-Seine.",
    tip: "Pour un rendez-vous régulier à Rueil, commencez par une saison d’un mois sur 9 trous. Choisissez le même départ dans Mulligan pour que les cartes de votre groupe soient compatibles avec la ligue. Vous pouvez aussi sélectionner 18 trous en deux tours du parcours.",
    source: "https://bluegreen.fr/rueil/parcours/", sourceLabel: "Informations et réservation auprès du Golf Bluegreen Rueil-Malmaison",
    otherSlug: "golf-du-haras-de-jardy-vaucresson", otherLabel: "Une ligue au Haras de Jardy, à Vaucresson",
  },
  "golf-du-haras-de-jardy-vaucresson": {
    label: "Jardy", entry: "course_jardy", city: "Vaucresson", par: 30,
    title: "Golf du Haras de Jardy — carte de score et ligue entre amis",
    description: "Golf du Haras de Jardy à Vaucresson : carte de score 9 trous, par 30. Organisez une ligue privée entre amis et suivez votre saison avec Mulligan.",
    intro: "Au Haras de Jardy, à Vaucresson dans les Hauts-de-Seine, les 9 trous associent six par 3 et trois par 4. Prolongez vos rendez-vous sur ce par 30 avec une ligue Mulligan réservée à votre groupe d’amis.",
    tip: "À Jardy, les trous courts donnent une place importante au petit jeu. Pour votre ligue, choisissez une configuration commune de 9 trous, ou 18 trous en deux tours, puis le même départ. Chaque carte compatible peut ensuite alimenter votre classement de saison.",
    source: "https://www.ffgolf.org/parcours-detours/guide-des-golfs/golf-tennis-des-haras-de-jardy", sourceLabel: "Fiche du Haras de Jardy et coordonnées du club sur ffgolf",
    otherSlug: "golf-de-rueil-malmaison-rueil-malmaison", otherLabel: "Une ligue au golf de Rueil-Malmaison",
  },
}

export function courseLeagueSignupHref(courseId: string, entry: string): string {
  const destination = `/games/create?course=${encodeURIComponent(courseId)}`
  return `/?lang=fr&tab=signup&entry=${encodeURIComponent(entry)}&redirect=${encodeURIComponent(destination)}`
}
