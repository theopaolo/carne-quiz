# Carnet quiz

Quiz à choix multiples pour les élèves, avec le suivi des réponses dans une base Turso. Pas de compte : l'élève ouvre le lien du quiz, tape son nom et répond. Le formateur ouvre et ferme le quiz, et suit les résultats par groupe sur `/prof`.

Le serveur corrige les réponses. Le navigateur reçoit les questions et les options, puis la bonne réponse et l'explication une fois la question finie. Le serveur n'a aucune dépendance : il parle à Turso par son API HTTP.

## Lancer en local

Node 22.9 ou plus récent.

```sh
cp .env.example .env   # puis remplir le jeton Turso et un mot de passe
npm start              # http://localhost:3000
npm test
```

Ou avec Docker, comme en production :

```sh
docker build -t carnet-quiz .
docker run --rm --env-file .env -p 3000:3000 carnet-quiz
```

## Ajouter un quiz

Écrire un fichier JSON dans `decks/`, puis l'importer :

```sh
npm run import -- decks/ux-j1-fin.json
```

Le nom du fichier devient l'identifiant du quiz dans le lien. Réimporter un fichier remplace le quiz. Si des élèves y ont déjà répondu, garder les mêmes `id` de questions et d'options, sinon leurs anciennes réponses ne correspondent plus.

Format, repris du projet flashcard :

```json
{
  "title": "Quiz de fin du jour 1",
  "timeLimit": 60,
  "questions": [
    {
      "id": "q1",
      "topics": ["persona"],
      "question": "Un persona inventé par une IA, est-ce de la recherche ?",
      "options": [
        { "id": "A", "label": "Oui, s'il est assez détaillé" },
        { "id": "B", "label": "Non" }
      ],
      "correctAnswer": "B",
      "hint": "D'où viennent les informations d'un persona ?",
      "explanation": "Un persona se construit à partir des personnes interrogées.",
      "timeLimit": 90
    }
  ]
}
```

`topics`, `difficulty`, `hint`, `explanation` et `timeLimit` sont facultatifs. Le texte entre accents graves s'affiche en code. Les anciens decks de flashcards (`{ "flashcards": [...] }`) s'importent aussi.

`timeLimit` est le temps de réponse en secondes. Placé à la racine, il vaut pour toutes les questions. Placé dans une question, il remplace celui de la racine. Sans `timeLimit`, pas de chrono.

`decks/` est ignoré par Git : les fichiers contiennent les réponses.

## Pendant le cours

1. Ouvrir `/prof`. Le navigateur demande un identifiant et un mot de passe : l'identifiant est libre, le mot de passe est `PROF_PASSWORD`.
2. Choisir le quiz, taper un nom de groupe, par exemple `eden-2026`, puis « Voir le lien et les résultats ».
3. Poster le lien affiché sur Discord. Les élèves qui l'ouvrent voient « Le quiz n'est pas encore ouvert ». Leur page vérifie toutes les 5 secondes.
4. Cliquer « Ouvrir le quiz ». Les pages des élèves passent au formulaire du nom.
5. Le tableau des résultats se met à jour toutes les 5 secondes.
6. Cliquer « Fermer le quiz » à la fin. Un élève en cours voit ses résultats à sa prochaine action. Ses questions sans réponse restent vides dans le tableau. « Rouvrir le quiz » annule la fermeture.

Barème : 1 point au premier essai, 0,5 au deuxième, 0 ensuite. Après une erreur, l'indice s'affiche et l'élève réessaie. Si l'élève recharge la page, il reprend à la première question sans réponse. S'il ferme l'onglet et rouvre le lien, il recommence : `/prof` montre alors deux lignes à son nom.

## Chrono

Le chrono d'une question part quand elle s'affiche. Le serveur note l'heure : recharger la page ne redonne pas de temps. À zéro, les réponses se bloquent, puis la correction s'affiche. Le serveur accepte encore une réponse envoyée 2 secondes après la fin, le temps qu'elle arrive. Une question sans bonne réponse à la fin du temps vaut 0.

Le navigateur reçoit toutes les questions au départ et demande lui-même le départ du chrono. Un élève qui écrit ses propres requêtes peut lire les questions en avance et répondre sans chrono. Pour un quiz de cours, ça suffit. Pour un examen, il faudrait envoyer les questions une par une.

## Données

Pour chaque passage, la base garde le quiz, le groupe, le nom tapé, l'heure, chaque réponse envoyée et l'heure d'affichage des questions minutées. La page d'accueil du quiz le dit aux élèves. Pour effacer un groupe après la notation, dans le shell Turso :

```sql
DELETE FROM answers WHERE run_id IN (SELECT id FROM runs WHERE group_name = 'eden-2026');
DELETE FROM shown WHERE run_id IN (SELECT id FROM runs WHERE group_name = 'eden-2026');
DELETE FROM runs WHERE group_name = 'eden-2026';
DELETE FROM sessions WHERE group_name = 'eden-2026';
```

## Déployer sur Coolify

Build pack Dockerfile, port `3000`. Variables d'environnement : `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` et `PROF_PASSWORD`. Le serveur crée les tables au démarrage si elles manquent.

Le jeton Turso reste sur le serveur. Il donne la lecture et l'écriture sur toute la base : ne pas le mettre dans le code du navigateur ni dans Git.
