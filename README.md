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
- Une question de recherche n'a pas de chrono. Elle dit où chercher la réponse dans le cours, avec un lien qui s'ouvre dans un nouvel onglet.
- À la fin, l'élève voit son score, le décompte des questions justes et manquées, et le détail de chaque réponse avec la correction. Deux boutons suivent : « Retour au cours » et « Recommencer le quiz ».
- Le passage reste sur l'appareil. Un élève qui recharge la page ou rouvre le lien retrouve ses réponses, et la note du formateur quand elle arrive.
- Tout se fait au clavier : A à H pour choisir, Entrée pour valider et continuer, Ctrl ou Cmd + Entrée pour envoyer une réponse rédigée.

## Pour le formateur

La page `/prof` demande un mot de passe. Le navigateur affiche une fenêtre de connexion : l'identifiant est libre, le mot de passe est `PROF_PASSWORD`.

1. Dans « Lancer un quiz », choisir le quiz, taper un nom de groupe (par exemple `eden-lundi`), puis « Préparer le lien ».
2. Copier le lien et le poster sur Discord. Les élèves qui l'ouvrent attendent sur l'accueil du quiz.
3. Cliquer « Ouvrir le quiz » quand tout le monde est prêt.
4. Suivre les résultats. Le tableau se met à jour toutes les 5 secondes : une ligne par élève, une case par question.
5. Noter les réponses rédigées dans « Réponses écrites » : 0, 0,5 ou 1. La même zone liste les réponses courtes refusées, pour accepter une formulation juste que le quiz n'avait pas prévue.
6. Cliquer « Fermer le quiz » à la fin. Un élève en cours arrive sur ses résultats à sa prochaine action.
7. Exporter en CSV, puis effacer les résultats du groupe une fois la note reportée.

« Question par question » donne le taux de réussite de chaque question et, pour les questions à choix, ce que les élèves ont coché au premier essai. On voit ainsi quelle mauvaise réponse revient le plus souvent.

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
| `lookup` | question | Fait de la question une question de recherche, sans chrono. Le texte complète « Cherchez la réponse dans… », par exemple `"le cours, partie « Les formulaires »"`. |
| `lookupUrl` | question | Lien vers la page où chercher. Une ancre `#` mène directement à la bonne partie. |
| `type` | question | `choice` (par défaut), `multiple`, `text` ou `open`. |
| `options` | `choice`, `multiple` | De 2 à 8 options `{ "id", "label" }`. |
| `correctAnswer` | `choice` | L'`id` de la bonne option. |
| `correctAnswers` | `multiple` | Les `id` de toutes les bonnes options. L'élève doit cocher exactement celles-ci. |
| `accept` | `text` | Les réponses acceptées. La première est montrée comme correction. |
| `expected` | `open` | La réponse attendue ou les critères de notation. |
| `hint` | question | Indice montré après la première erreur. |
| `explanation` | question | Montrée quand la question est finie. |
| `topics` | question | Mots-clés, pour vous. |

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

## Chrono

Le serveur note l'heure d'affichage de chaque question minutée. Recharger la page ne redonne donc pas de temps. Il accepte une réponse envoyée jusqu'à 2 secondes après la fin, le temps qu'elle arrive.

Le navigateur reçoit toutes les questions à l'ouverture du quiz et demande lui-même le départ du chrono. Un élève qui écrit ses propres requêtes peut lire les questions en avance et répondre sans chrono. Pour un quiz de cours, ça suffit. Pour un examen, il faudrait envoyer les questions une par une.

## Données

La base garde, pour chaque passage, le quiz, le groupe, le nom tapé, l'heure, chaque réponse envoyée, l'heure d'affichage des questions minutées et les notes du formateur. L'accueil du quiz le dit aux élèves. « Effacer les résultats du groupe », sur la page du groupe, supprime tout ce qui concerne ce groupe.

## Lancer en local

Node 22.9 ou plus récent.

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
