# Carnet quiz

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Les élèves répondent aux quiz. Le formateur prépare les séances, suit les réponses, anime le quiz-roulette et organise les équipes en classe.

## Product Purpose

Faire réviser et évaluer les notions du cours. La roulette associe aléatoirement un élève à une question courte. Le tirage d’équipes répartit les élèves et prépare leur ordre de passage à l’oral.

## Capabilities and Constraints

Le formateur utilise un espace protégé par mot de passe. Les listes d'élèves sont partagées par groupe. La roulette donne la priorité aux élèves les moins interrogés et prévoit 2 ou 3 passages par élève. Le formateur évalue chaque réponse. Une question réussie sort du tirage, une question ratée peut revenir. Les tirages et les présences sont conservés dans le navigateur.

Le serveur Node utilise SQLite ou Turso, sans dépendance npm. L'interface utilise HTML, CSS et JavaScript.

Le formateur choisit le nombre d’équipes pour chaque taille et peut exclure les absents. Chaque présent apparaît une fois. Les équipes ont des noms modifiables, avec des propositions incluant des emojis. L’ordre de passage se tire indépendamment de leur composition. Pendant les oraux, le formateur fait avancer l’équipe à l’oral depuis la régie ou depuis un écran projeté pour les élèves, synchronisé avec la régie. Réglages, résultats et passages sont conservés dans le navigateur par classe.

## Brand Commitments

Conserver les couleurs et les polices de l'application. Pas de titres en capitales, de serif, de letter-spacing ni de Tailwind. Les textes et les questions sont en français.

## Evidence on Hand

La maquette de roulette fournie montre une liste d'élèves et une liste de questions côte à côte, avec une ligne sélectionnée commune. `decks/questions-courtes.md` contient les questions UI, UX et accessibilité.
