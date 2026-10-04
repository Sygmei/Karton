import type { Locale } from './i18n';

// The progress API and existing adapters return English messages. Translate at
// the display boundary so saved results and concurrent users keep their locale.
const messages: Record<string, string> = {
  'Queued': 'En attente',
  'Gathering decklist': 'Chargement de la liste',
  'Finding Commander on MtGTop8': 'Recherche du commandant sur MtgTop8',
  'Gathering MtGTop8 decklists': 'Chargement des listes MtgTop8',
  'Analysis': 'Analyse',
  'Done': 'Terminé',
  'Error': 'Erreur',
  'Preparing request...': 'Préparation de la demande…',
  'Preparing analysis request...': 'Préparation de l’analyse…',
  'Finalizing results...': 'Finalisation des résultats…',
  'Opening shared permalink...': 'Ouverture de l’analyse partagée…',
  'Resolving commander...': 'Recherche du commandant…',
  'Fetching input deck...': 'Chargement du deck…',
  'Matching commander on MtgTop8...': 'Recherche du commandant sur MtgTop8…',
  'Fetching MtgTop8 decks...': 'Chargement des decks MtgTop8…',
  'Fetching MtgTop8 pages...': 'Chargement des pages MtgTop8…',
  'MtgTop8 refresh timed out; using cached decklists...': 'MtgTop8 n’a pas répondu à temps ; utilisation des listes en cache…',
  'Analyzing popular cards...': 'Analyse des cartes populaires…',
  'Running keep / cut / add analysis...': 'Analyse des cartes à garder, retirer et ajouter…',
  'Analysis complete.': 'Analyse terminée.',
  'Analysis failed.': 'L’analyse a échoué.',
  'The request could not be completed.': 'La demande n’a pas pu être traitée.',
  'Choose an input mode and enter a commander name.': 'Choisissez un mode d’analyse et saisissez un nom de commandant.',
  'Deck URL is required': 'L’URL du deck est requise.',
  'Deck URL is required.': 'L’URL du deck est requise.',
  'Invalid start date. Use YYYY-MM-DD': 'Date de début invalide. Utilisez le format AAAA-MM-JJ.',
  'Invalid end date. Use YYYY-MM-DD': 'Date de fin invalide. Utilisez le format AAAA-MM-JJ.',
  'Start date must be before or equal to end date': 'La date de début doit précéder la date de fin ou être identique.',
  'Invalid deck URL. Use moxfield.com/decks/<id>, archidekt.com/decks/<id>, or manabox.app/decks/<id>.': 'URL de deck invalide. Utilisez moxfield.com/decks/<id>, archidekt.com/decks/<id> ou manabox.app/decks/<id>.',
  'Unsupported deck host. Use moxfield.com, archidekt.com, or manabox.app.': 'Site non pris en charge. Utilisez moxfield.com, archidekt.com ou manabox.app.',
  'Enter a commander name (up to 150 characters per commander).': 'Saisissez un nom de commandant (150 caractères maximum par commandant).',
  'Commander lookup is temporarily unavailable. Please try again.': 'La recherche de commandants est temporairement indisponible. Veuillez réessayer.',
  'Choose a valid commander from the suggestions.': 'Choisissez un commandant valide parmi les suggestions.',
  'These commanders cannot be paired. Choose a compatible second commander.': 'Ces commandants ne peuvent pas être associés. Choisissez un second commandant compatible.',
  'No Duel Commander decks found on MtgTop8 for this commander yet.': 'Aucun deck Duel Commander trouvé sur MtgTop8 pour ce commandant pour le moment.',
  'Could not find a matching Duel Commander archetype on MtgTop8 for this commander.': 'Aucun archétype Duel Commander correspondant à ce commandant n’a été trouvé sur MtgTop8.',
  'MtgTop8 is temporarily unavailable. Please retry in a few minutes.': 'MtgTop8 est temporairement indisponible. Réessayez dans quelques minutes.',
  'MtgTop8 took too long to respond. Please retry in a few minutes.': 'MtgTop8 a mis trop de temps à répondre. Réessayez dans quelques minutes.',
  'This ManaBox deck does not exist or has been removed.': 'Ce deck ManaBox n’existe pas ou a été supprimé.',
  'Moxfield browser session could not start. Please retry.': 'La session de navigation Moxfield n’a pas pu démarrer. Veuillez réessayer.',
  'ManaBox returned an unexpected deck response.': 'ManaBox a renvoyé une réponse inattendue pour ce deck.',
  'Duel Commander banlist could not be refreshed.': 'La liste des cartes interdites en Duel Commander n’a pas pu être actualisée.',
  'Could not save analysis permalink. Please retry.': 'Le lien permanent de l’analyse n’a pas pu être enregistré. Veuillez réessayer.'
};

export function translateAnalyzerMessage(message: string, locale: Locale): string {
  if (locale !== 'fr') return message;
  if (messages[message]) return messages[message];

  let match = /^(.*) \(Page (\d+(?:\/\d+)?)\)$/.exec(message);
  if (match) return `${translateAnalyzerMessage(match[1], locale)} (page ${match[2]})`;
  match = /^(.*?)(?: \(Trace ID: ([^)]+)\)| Trace ID: (.+))$/.exec(message);
  if (match) return `${translateAnalyzerMessage(match[1], locale)} (Identifiant de trace : ${match[2] ?? match[3]})`;
  match = /^Fetched (\d+) MtgTop8 decks?\.$/.exec(message);
  if (match) return `${match[1]} deck${match[1] === '1' ? '' : 's'} MtgTop8 chargé${match[1] === '1' ? '' : 's'}.`;
  match = /^Scanning MtgTop8 page (\d+(?:\/\d+)?) \((\d+) new decks?\)\.$/.exec(message);
  if (match) return `Lecture de la page MtgTop8 ${match[1]} (${match[2]} ${match[2] === '1' ? 'nouveau deck' : 'nouveaux decks'}).`;
  match = /^Fetching decklists on page (\d+(?:\/\d+)?) \((\d+)\/(\d+)\)\.$/.exec(message);
  if (match) return `Chargement des listes de la page ${match[1]} (${match[2]}/${match[3]}).`;
  match = /^(Moxfield|Archidekt|ManaBox) URL is required\.$/.exec(message);
  if (match) return `L’URL ${match[1]} est requise.`;
  match = /^Invalid (Moxfield|Archidekt|ManaBox) URL( host)?\. Use (.+)\.$/.exec(message);
  if (match) return `${match[2] ? 'Site' : 'URL'} ${match[1]} invalide. Utilisez ${match[3]}.`;
  match = /^Could not detect a commander in this (Moxfield|Archidekt|ManaBox) deck\.$/.exec(message);
  if (match) return `Aucun commandant n’a pu être détecté dans ce deck ${match[1]}.`;
  match = /^Could not extract cards from this (Moxfield|Archidekt|ManaBox) deck\.$/.exec(message);
  if (match) return `Impossible d’extraire les cartes de ce deck ${match[1]}.`;
  match = /^Could not (?:fetch|extract|load) this (Moxfield|Archidekt|ManaBox) deck(?: page)?\. Verify the URL and that the deck is public(?:ly accessible)?\.$/.exec(message);
  if (match) return `Impossible de charger ce deck ${match[1]}. Vérifiez l’URL et assurez-vous que le deck est public.`;
  // Keep unexpected upstream details intact rather than hiding useful context.
  return message;
}
