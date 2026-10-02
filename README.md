# Carnet quiz

Quiz en ligne pour une classe, avec le suivi des réponses de chaque élève. L'élève ouvre un lien, tape son nom et répond. Il n'a pas de compte à créer. Le formateur ouvre et ferme le quiz, suit les réponses en direct, note les réponses rédigées et exporte les résultats.

Le serveur corrige les réponses. Le navigateur de l'élève ne reçoit la bonne réponse et l'explication qu'une fois la question finie. Le serveur n'a aucune dépendance npm : il parle à une base Turso par son API HTTP.

## Pour l'élève

- Un accueil annonce le nombre de questions, le temps de réponse, le barème et les règles.
- Tant que le formateur n'a pas ouvert le quiz, le bouton « Commencer » reste grisé. La page se débloque seule à l'ouverture.
- Chaque question dit son type : une seule réponse, plusieurs réponses, réponse courte à taper, réponse rédigée.
- Après une erreur, l'élève voit « Faux », un indice, et il lui reste un essai à 0,5 point.
- Il peut passer une question, qui vaut alors 0 point et affiche la correction.
- Le chrono démarre à l'affichage de la question. À zéro, la réponse sélectionnée ou écrite part toute seule.
- Une question de recherche dit où chercher la réponse dans le cours, avec un lien qui s'ouvre dans un nouvel onglet. Elle n'a pas de chrono, sauf si le quiz lui donne son propre temps.
- Une question peut montrer une image. Un clic l'ouvre en grand dans un nouvel onglet.
- À la fin, l'élève voit son score, le décompte des questions justes et manquées, et le détail de chaque réponse avec la correction. Deux boutons suivent : « Retour au cours » et « Recommencer le quiz ».
- Le passage reste sur l'appareil. Un élève qui recharge la page ou rouvre le lien retrouve ses réponses, et la note du formateur quand elle arrive.
- Tout se fait au clavier : A à H pour choisir, Entrée pour valider et continuer, Ctrl ou Cmd + Entrée pour envoyer une réponse rédigée.
- Pendant une question, rien ne se colle dans la réponse, sauf un passage de sa propre réponse. Copier la question ne donne pas son texte, sauf un mot-clé court pour chercher dans le cours. L'accueil prévient l'élève que ses copies et ses sorties de la page sont notées.

## Pour le formateur

La page `/prof` demande un mot de passe. Le navigateur affiche une fenêtre de connexion : l'identifiant est libre, le mot de passe est `PROF_PASSWORD`.

1. Dans « Lancer un quiz », choisir le quiz et le groupe, puis « Préparer le lien ». Un groupe correspond à une classe et sert pour tous ses quiz. Pour une nouvelle classe, choisir « Nouveau groupe… » et taper son nom (par exemple `eden-lundi`).
2. Pour imposer les noms, ouvrir « Liste des élèves » et coller un nom par ligne. L'élève choisit alors son nom dans un menu, et le serveur refuse tout autre nom. La liste vaut pour tous les quiz du même groupe. Un nom pris est grisé pour les autres élèves. Seul l'appareil qui l'a pris peut recommencer le quiz sous ce nom. Si un élève change d'appareil ou qu'un autre lui a pris son nom, cliquez « Libérer le nom » sous sa ligne dans les résultats : le prochain qui choisit ce nom peut commencer, et les réponses déjà données restent.
3. Copier le lien et le poster sur Discord. Les élèves qui l'ouvrent attendent sur l'accueil du quiz.
4. Cliquer « Ouvrir le quiz » quand tout le monde est prêt.
5. Suivre les résultats. Le tableau se met à jour toutes les 5 secondes : une ligne par élève, une case par question. La colonne « Alertes » et le coin rouge d'une case signalent un élève qui a peut-être demandé la réponse à une IA (voir « Copie, collage et sorties de la page »).
6. Noter les réponses rédigées dans « Réponses écrites » : 0, 0,5 ou 1. La même zone liste les réponses courtes refusées, pour accepter une formulation juste que le quiz n'avait pas prévue.
7. Cliquer « Fermer le quiz » à la fin. Un élève en cours arrive sur ses résultats à sa prochaine action.
8. Exporter en CSV, puis effacer les résultats du groupe une fois la note reportée.

« Question par question » donne le taux de réussite de chaque question et, pour les questions à choix, ce que les élèves ont coché au premier essai. On voit ainsi quelle mauvaise réponse revient le plus souvent.

## Équipes et ordre de passage

Ouvrez « Équipes » depuis `/prof`, ou depuis une séance de quiz. Choisissez la classe et utilisez sa liste d’élèves partagée avec les quiz et la roulette.

- Décochez les absents dans « Liste et présences ».
- Choisissez une taille d’équipe, de 2 à 5. Les présents sont répartis en équipes égales à un élève près : 22 présents par 3 donnent 6 équipes de 3 et 2 équipes de 2. Chaque ligne reste modifiable. Le tirage est disponible lorsque le total des places correspond aux présents.
- Tirez les équipes. Chaque élève présent apparaît une fois. Les noms commencent à Groupe A, puis Groupe B, etc. Cliquez sur un nom pour le modifier, ou proposez des noms avec emojis.
- Ajustez les équipes après le tirage. Cliquez sur un élève pour le déplacer dans une autre équipe ou le noter absent. Décocher un élève dans « Liste et présences » le retire de son équipe. Un élève coché après le tirage attend dans « Sans équipe ». Une équipe vidée disparaît de l’ordre de passage.
- Tirez l’ordre de passage pour les oraux. Un nouveau tirage de l’ordre conserve les équipes et leurs noms.
- Pendant les oraux, « Commencer les oraux » puis « Équipe suivante » indiquent l’équipe à l’oral et la suivante.

« Ouvrir l’écran des élèves » ouvre une fenêtre à placer sur le projecteur. Elle affiche toutes les équipes en grand, puis, pendant les oraux, l’équipe à l’oral avec ses membres et la file de passage. Les deux fenêtres restent synchronisées. Sur l’écran, Espace, Entrée, flèche droite ou Page suivante tirent l’ordre, puis passent à l’équipe suivante. Flèche gauche ou Page précédente reviennent à l’équipe précédente, F bascule en plein écran. Un nouvel ordre se tire depuis la régie. Une télécommande de présentation suffit donc à mener les oraux.

Les réglages, présences, équipes, ordre et passages sont conservés dans ce navigateur, par classe. Modifier les réglages prépare le prochain tirage. « Refaire les équipes » remplace les équipes et remet l’ordre à zéro après confirmation. « Tirer un nouvel ordre » pendant les oraux demande aussi une confirmation.

## Quiz-roulette

Ouvrez « Quiz-roulette » depuis `/prof`, ou depuis la page d'un groupe. Choisissez un groupe et enregistrez sa liste d'élèves si elle n'existe pas encore. Cette liste est partagée avec les autres quiz du groupe.

La roulette a deux vues, comme le mode présentateur de Keynote :

- La régie (`/prof/roulette`) reste sur l'écran du formateur. Elle montre l'élève tiré, la question et sa réponse, les boutons d'évaluation, les réglages et l'historique.
- L'écran des élèves (`/prof/roulette/ecran`) s'ouvre avec « Ouvrir l'écran des élèves », dans une fenêtre à glisser sur le projecteur. Il n'affiche que les deux rouleaux, sans réglages ni réponses. Touche F ou bouton « Plein écran » pour masquer le reste.

Les deux vues partagent la séance : un tirage ou une évaluation dans l'une apparaît dans l'autre. Sur l'écran des élèves, Espace, Entrée, flèche droite ou Page suivante lancent le tirage, B note une bonne réponse, M une mauvaise, E écarte la question. Une télécommande de présentation suffit donc à tirer au sort quand l'écran est dupliqué.

- Dans « Réglages », décochez les absents, choisissez 2 ou 3 passages par élève et filtrez les questions par UI, UX ou accessibilité. Ces réglages sont verrouillés pendant qu'une réponse attend son évaluation.
- Cliquez sur « Tirer au sort ». Les élèves les moins interrogés passent en priorité, dans un ordre aléatoire. Un élève qui a atteint le nombre de passages prévu sort du tirage. Sur l'écran des élèves, le rouleau des noms accélère, file puis freine. Celui des questions part un peu après et s'arrête après lui. Durées et vitesse changent à chaque tirage.
- Cliquez sur « Bonne réponse » ou « Mauvaise réponse » avant de tirer à nouveau. La ligne de l'écran devient verte ou rouge, avec le verdict écrit en dessous. Une question réussie sort du tirage pour toute la séance. Une question ratée peut revenir, avec une autre question entre deux si le choix le permet.
- « Écarter la question » retire une question que vous ne voulez plus poser. L'élève garde son tour et reçoit une autre question, seul le rouleau des questions tourne. Les questions écartées valent pour tous les groupes de cet appareil. « Réglages » les liste avec un bouton « Remettre ». Pour retirer une question partout, supprimez-la de `decks/questions-courtes.md`.
- Avec la préférence de réduction des animations, le résultat s'affiche sans rotation.

Les tirages, leur évaluation, les présences et les réglages restent dans le navigateur, par groupe. Les deux vues doivent donc être ouvertes dans le même navigateur. Recharger reprend la séance, y compris une réponse à évaluer. « Recommencer les tirages » efface l'historique et remet les questions réussies en jeu, après confirmation. Les présences et les réglages sont conservés.

La banque contient 72 questions dans `decks/questions-courtes.md`. Modifiez ce fichier pour les compléter, avec une question par ligne sous les titres `## UI`, `## UX` ou `## Accessibilité`. La ligne `> …` placée sous une question donne sa réponse, affichée seulement dans la régie. Le serveur lit ce fichier à chaque ouverture de la roulette. Ce fichier est inclus dans le dépôt et l'image Docker. Les autres decks restent ignorés par Git.

Repères pour les questions d'accessibilité : [W3C, nommer les contrôles](https://www.w3.org/WAI/tutorials/forms/labels/), [RGAA et déclaration d'accessibilité](https://accessibilite.numerique.gouv.fr/obligations/), [OMS, handicap](https://www.who.int/news-room/fact-sheets/detail/disability-and-health).

## Écrire un quiz

Un quiz est un fichier JSON. Importez-le depuis `/prof`, avec « Importer un fichier JSON », ou en ligne de commande avec `npm run import -- decks/mon-quiz.json`. Le nom du fichier devient l'identifiant du quiz dans le lien. Réimporter un fichier du même nom remplace le quiz sans effacer les réponses déjà données. Gardez alors les mêmes `id` de questions, sinon les anciennes réponses ne correspondent plus.

`/exemple.json` montre les quatre types de questions :

```json
{
  "title": "Exemple : les quatre types de questions",
  "description": "Affiché sur l'accueil du quiz.",
  "courseUrl": "https://mon-cours.fr/chapitre-1/",
  "timeLimit": 60,
  "questions": [
    { "id": "q1", "type": "choice", "question": "Quelle balise crée un lien ?",
      "options": [{ "id": "A", "label": "`<link>`" }, { "id": "B", "label": "`<a>`" }],
      "correctAnswer": "B", "hint": "Une seule lettre.", "explanation": "`<a href>` crée un lien." },
    { "id": "q2", "type": "multiple", "question": "Lesquelles sont des titres ?",
      "options": [{ "id": "A", "label": "`<h1>`" }, { "id": "B", "label": "`<title>`" }, { "id": "C", "label": "`<h2>`" }],
      "correctAnswers": ["A", "C"] },
    { "id": "q3", "type": "text", "question": "Quel attribut décrit une image ?", "accept": ["alt", "attribut alt"] },
    { "id": "q4", "type": "open", "timeLimit": 180, "question": "Pourquoi un bouton a-t-il besoin d'un texte ?",
      "expected": "Ce que le formateur attend, montré à l'élève après l'envoi et au formateur pendant la notation." }
  ]
}
```

| Champ | Où | Rôle |
| --- | --- | --- |
| `title` | quiz | Obligatoire. |
| `description` | quiz | Texte de l'accueil. |
| `courseUrl` | quiz | Adresse du bouton « Retour au cours ». Sans elle, le bouton n'apparaît pas. |
| `timeLimit` | quiz ou question | Secondes pour répondre. Celui de la question remplace celui du quiz. Sans valeur, pas de chrono. `0` retire le chrono du quiz à une question. |
| `lookup` | question | Fait de la question une question de recherche, sans chrono. Le texte complète « Cherchez la réponse dans… », par exemple `"le cours, partie « Les formulaires »"`. Un `timeLimit` sur la question lui donne quand même un chrono. |
| `lookupUrl` | question | Lien vers la page où chercher. Une ancre `#` mène directement à la bonne partie. |
| `image` | question | Adresse `https://` d'une image montrée sous la question. |
| `imageAlt` | question | Obligatoire avec `image` : la description de l'image pour les lecteurs d'écran. |
| `type` | question | `choice` (par défaut), `multiple`, `text` ou `open`. |
| `options` | `choice`, `multiple` | De 2 à 8 options `{ "id", "label" }`. |
| `correctAnswer` | `choice` | L'`id` de la bonne option. |
| `correctAnswers` | `multiple` | Les `id` de toutes les bonnes options. L'élève doit cocher exactement celles-ci. |
| `accept` | `text` | Les réponses acceptées. La première est montrée comme correction. |
| `expected` | `open` | La réponse attendue ou les critères de notation. |
| `hint` | question | Indice montré après la première erreur. |
| `explanation` | question | Montrée quand la question est finie. |
| `topics` | question | Mots-clés, pour vous. |
| `trap` | question | Le texte que reçoit le presse-papiers quand l'élève copie la question : une variante qui mène une IA à une mauvaise réponse. |
| `trapAnswers` | question | Les réponses qui trahissent une IA : celles où mène `trap`, ou les erreurs qu'une IA fait d'elle-même. Pour une question à choix, des `id` de mauvaises options. Pour un texte, un morceau suffit : `"endou"` repère « endoué » et « endouée ». |

Quelques règles :

- Les options sont mélangées pour chaque élève, et les lettres suivent l'ordre affiché. Une explication qui cite « la réponse B » sera donc fausse pour la plupart des élèves : citez le texte de l'option.
- Une réponse courte est comparée sans majuscules, sans accents et sans mots de liaison (« la loi de », « l'effet »). Une faute de frappe passe dès 5 lettres, deux dès 10. Toute la réponse compte : « Jakob Hick Fitts » ne vaut pas « Jakob ».
- Le texte entre accents graves s'affiche en code, et un bloc entre trois accents graves en bloc de code.
- Pour évaluer, préférez 4 ou 5 options plausibles, des questions à choix multiple et des réponses à taper : une question à 3 options se devine une fois sur trois.

Les anciens decks de flashcards (`{ "flashcards": [...] }`) s'importent aussi, en questions à choix unique.

## Barème

- Questions à choix et réponses courtes : 1 point au premier essai, 0,5 au deuxième, 0 ensuite. Deux essais au plus. Une question à deux options n'en a qu'un.
- Réponses rédigées : un seul envoi, noté par le formateur sur 1 point.
- Question passée ou temps écoulé : 0 point.
- La note du formateur remplace toujours la note automatique. Recliquer sur la note l'enlève.

## Copie, collage et sorties de la page

Pendant une question, le navigateur de l'élève envoie au serveur :

- chaque sortie de la page : autre onglet, autre fenêtre, application, panneau d'IA du navigateur, onglet fermé.
- la durée de chaque sortie, mesurée au retour, y compris quand l'élève ferme l'onglet et rouvre le lien.
- chaque copie de la question ou des options.
- chaque collage bloqué.

Copier la question ou les options ne donne pas leur texte, et rien ne s'affiche à l'écran. Si la question a un `trap`, le presse-papiers reçoit ce texte à la place, suivi des options avec les lettres affichées. Sinon, il reçoit « La copie des questions est désactivée pendant le quiz. ». Glisser la question ou son image vers un autre onglet est bloqué. Un mot-clé copié pour chercher dans le cours part tel quel : moins de 30 caractères et moins de 80 % de la question.

Un bon piège vise une erreur que les IA font déjà. Sur la carte de fidélité, des IA ont répondu « effet de dotation », ou traduit « endowed progress effect » en « effet de progrès endoué ». Ce piège ajoute une phrase qui pousse vers la dotation, et `trapAnswers` repère les deux erreurs :

```json
{ "id": "q7", "type": "text",
  "question": "Une carte de fidélité demande 10 tampons, dont 2 déjà offerts. Plus de clients la remplissent qu'une carte de 8 tampons vide. Comment s'appelle cet effet ?",
  "trap": "Une carte de fidélité demande 10 tampons, dont 2 déjà offerts, que le client considère déjà comme les siens. Plus de clients la remplissent qu'une carte de 8 tampons vide. Comment s'appelle cet effet ?",
  "accept": ["gradation du but", "goal gradient"],
  "trapAnswers": ["dotation", "endou", "endowment"] }
```

Une réponse écrite qui contient un morceau de `trapAnswers` compte même sans copie : l'élève qui retape la question dans une IA reçoit souvent la même erreur. Une option piège compte seulement si l'élève a copié la question, car un élève peut la choisir de bonne foi. L'import refuse un morceau de `trapAnswers` qui se trouve dans une réponse acceptée.

Une case prend un coin rouge après une question copiée, un collage bloqué, une réponse piège, 3 sorties ou 10 secondes hors de la page. Survolez-la pour le détail. Les sorties d'une question de recherche ne comptent pas, puisque l'élève doit aller dans le cours. Ses copies et ses réponses pièges comptent. Les seuils sont dans `AWAY`, dans `lib.js`.

Une alerte peut être innocente. Un clic dans la barre d'adresse ou une image ouverte en grand compte comme une sortie, et un élève peut confondre deux effets sans IA. Un élève qui copie la question pour la traduire ou se la faire lire reçoit aussi le piège. Parlez-en avec l'élève avant de conclure. Le quiz ne voit pas l'élève qui photographie l'écran avec son téléphone, ni celui qui bloque les requêtes du quiz dans les outils de développement.

## Chrono

Le serveur note l'heure d'affichage de chaque question minutée. Recharger la page ne redonne donc pas de temps. Il accepte une réponse envoyée jusqu'à 2 secondes après la fin, le temps qu'elle arrive.

Le navigateur reçoit toutes les questions à l'ouverture du quiz et demande lui-même le départ du chrono. Un élève qui écrit ses propres requêtes peut lire les questions en avance et répondre sans chrono. Pour un quiz de cours, ça suffit. Pour un examen, il faudrait envoyer les questions une par une.

## Données

La base garde, pour chaque passage, le quiz, le groupe, le nom tapé, l'heure, chaque réponse envoyée, l'heure d'affichage des questions minutées, les sorties de la page, les questions copiées, les collages bloqués et les notes du formateur. L'accueil du quiz le dit aux élèves. « Effacer les résultats du groupe », sur la page du groupe, supprime les passages, les réponses, les alertes et les notes du groupe. La liste des élèves reste : videz-la à la main.

## Lancer en local

Node 22.9 ou plus récent.

Pour tester avec un fichier SQLite local, sans toucher à la base Turso :

```sh
SQLITE_PATH=local.sqlite PROF_PASSWORD=dev npm start
```

Le fichier `local.sqlite` est créé au premier démarrage et ignoré par Git. Pour importer un quiz dans cette même base, lancez `SQLITE_PATH=local.sqlite npm run import -- decks/mon-quiz.json`. `PORT=3001` choisit un autre port si le port par défaut est occupé.

Pour utiliser Turso en local :

```sh
cp .env.example .env   # puis remplir TURSO_DATABASE_URL, TURSO_AUTH_TOKEN et PROF_PASSWORD
npm start              # http://localhost:3000, suivi sur /prof
npm test
```

Ou avec Docker, comme en production :

```sh
docker build -t carnet-quiz .
docker run --rm --env-file .env -p 3000:3000 carnet-quiz
```

## Déployer sur Coolify

Build pack Dockerfile, port `3000`. Variables d'environnement : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` et `PROF_PASSWORD`. Le serveur crée les tables au démarrage si elles manquent.

Le jeton Turso donne la lecture et l'écriture sur toute la base. Il reste sur le serveur : ne le mettez ni dans le code du navigateur ni dans Git. `decks/` est ignoré par Git, parce que les quiz contiennent les réponses.

## Fichiers

- `server.js` : l'API des élèves et les fichiers statiques.
- `prof.js` : les pages du formateur.
- `lib.js` : la base, la validation des quiz et la correction.
- `web.js` : les outils HTTP communs.
- `public/` : la page du quiz, son script, la feuille de style commune, le script de la page du formateur et l'exemple.
