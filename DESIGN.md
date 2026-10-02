---
name: Carnet quiz
description: "Interface de quiz et de suivi en français."
colors:
  bg-desk: "#f2eee6"
  bg-page: "#fdfbf7"
  bg-surface: "#fffefc"
  bg-sunken: "#f5f1e9"
  border: "#e7e2d8"
  border-strong: "#c6beb1"
  text: "#1e2530"
  text-muted: "#56637a"
  heading: "#202637"
  accent: "#9475c6"
  accent-text: "#51357e"
  accent-bg: "#f2ecfa"
  on-accent: "#ffffff"
  code-bg: "#efebe3"
  ok: "#2f7a4f"
  ok-bg: "#e6f2ea"
  half: "#8a5300"
  half-bg: "#fbf0da"
  ko: "#b3261e"
  ko-bg: "#fbeae8"
  bg-desk-dark: "#0f1117"
  bg-page-dark: "#14171f"
  bg-surface-dark: "#1b1f2a"
  bg-sunken-dark: "#181c25"
  border-dark: "#2c3242"
  border-strong-dark: "#4a5268"
  text-dark: "#e6e8ee"
  text-muted-dark: "#a3abbd"
  heading-dark: "#f2f4f8"
  accent-dark: "#c4a6ee"
  accent-text-dark: "#dcc8fa"
  accent-bg-dark: "#272238"
  on-accent-dark: "#14171f"
  code-bg-dark: "#262c3a"
  ok-dark: "#6fcf97"
  ok-bg-dark: "#15291d"
  half-dark: "#e8b866"
  half-bg-dark: "#2e2615"
  ko-dark: "#f2847c"
  ko-bg-dark: "#341b1a"
typography:
  display:
    fontFamily: "Inclusive Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.75rem, 1.35rem + 1.8vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inclusive Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 650
    lineHeight: 1.2
  title:
    fontFamily: "Inclusive Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.2
  body:
    fontFamily: "Inclusive Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inclusive Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    lineHeight: 1.55
  code:
    fontFamily: "Roboto Mono, ui-monospace, monospace"
    fontSize: "0.875em"
rounded:
  radius: "6px"
  page: "10px"
  badge: "4px"
spacing:
  sheet-pad: "40px"
  sheet-pad-mobile: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-text}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.radius}"
    padding: "0 18px"
  button:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.heading}"
    rounded: "{rounded.radius}"
    padding: "0 18px"
  input:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    padding: "10px 12px"
  badge:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
---

# Design System: Carnet quiz

## Overview

Carnet conserve ses surfaces crème, ses textes denses et Inclusive Sans. Les commandes et les résultats utilisent les couleurs du quiz existant. La roulette prolonge ce système avec deux vues : une régie pour le formateur et un écran de projection où deux rouleaux partagent une sélection commune. Le tirage d’équipes suit le même partage entre une régie et un écran projeté.

Source des valeurs : `public/quiz.css`. Les noms du frontmatter reprennent les propriétés CSS sans le préfixe `--`. Le suffixe `-dark` décrit leur substitution dans le thème sombre automatique.

## Colors

L’accent violet sert aux actions, aux liens et à la sélection. `accent-text` fournit le fond du bouton principal et de la bande de roulette, `on-accent` leur texte. `accent` marque le focus.

Les neutres distinguent le fond extérieur (`bg-desk`), la page (`bg-page`), les commandes (`bg-surface`) et les zones secondaires (`bg-sunken`). `text-muted` garde les informations secondaires lisibles. `border` et `border-strong` séparent les contenus et les champs.

Le vert (`ok`) et le rouge (`ko`) accompagnent un libellé de résultat. L’orange (`half`) appartient aux états intermédiaires du quiz. Le thème sombre remplace les valeurs des mêmes propriétés.

## Typography

Inclusive Sans compose les titres, les textes et les commandes. Roboto Mono compose le code et les valeurs techniques, jamais les titres de roulette. Les tailles et graisses des cinq rôles sont dans le frontmatter. Le texte courant utilise une hauteur de ligne de 1,55, les titres de 1,2. Sur l’écran de projection, la taille des lignes suit leur hauteur (26 %), entre 1 et 4 rem et au plus 3,2 vw, avec une graisse de 500 portée à 700 pour la sélection. Dans la régie, le nom de l’élève va de 1,5 à 2 rem en graisse 700, la question de 1,25 à 1,625 rem en graisse 600. Sur l’écran des équipes, la taille suit la place de chaque équipe, jusqu’à 3,25 rem. Pendant les oraux, le nom de l’équipe à l’oral va jusqu’à 6 rem en graisse 700, ses membres jusqu’à 4 rem en graisse 500.

## Layout

La page ordinaire possède une colonne de lecture de 42 rem, la page large une largeur maximale de 72 rem. À 760 px et moins, la page rejoint les bords de l’écran et ses marges internes passent à 16 px. Les espaces entre commandes sont généralement de 12 à 24 px.

La régie et l’écran répartissent l’élève et la question à 38/62. La régie empile les deux colonnes à 600 px et moins. Son tirage occupe alors toute la largeur et les deux évaluations restent côte à côte. Les réglages, les présences et la liste du groupe sont repliés sous « Réglages ».

L’écran de projection occupe toute la fenêtre, sans barre de navigation. Les rouleaux remplissent la hauteur disponible en cinq lignes égales. Un masque efface les lignes du bord, comme sur un tambour. Hors plein écran, une barre discrète rappelle les raccourcis clavier.

La régie des équipes place la composition dans une colonne de 18 rem et les équipes à droite, en grille de colonnes d’au moins 13 rem séparées par des règles. Sous 54 rem, les deux colonnes s’empilent. L’écran des équipes occupe toute la fenêtre. Hors oraux, le script choisit le nombre de colonnes qui donne le plus grand texte. Pendant les oraux, l’équipe à l’oral occupe 62 % de la largeur et la file de passage 38 %. En format portrait, les deux zones s’empilent.

## Elevation & Depth

Les différences de fond et les bordures structurent les surfaces. La bande de roulette reste plane. Les boutons secondaires ont une ombre de 1 px.

## Shapes

Les commandes et les champs reprennent le rayon commun du frontmatter. La page possède des coins légèrement plus arrondis sur desktop, droits sur mobile. La bande de sélection est rectangulaire. Les badges et le code utilisent de petits coins arrondis.

## Components

Les boutons ont une hauteur minimale de 44 px. Le principal est violet, le secondaire possède un fond de surface et une bordure, l’action discrète est soulignée. Le survol renforce la bordure ou assombrit le fond. Un bouton désactivé conserve son libellé et réduit son opacité.

Les champs natifs ont une hauteur minimale de 46 px. Leur focus associe un contour violet de 2 px et une bordure d’accent. Les autres commandes affichent un contour de focus décalé de 2 px. La navigation aligne la marque, le titre et les liens et peut revenir à la ligne.

La roulette relie visuellement l’élève et la question par une seule bande. Chaque rouleau accélère, file, freine, dépasse un peu sa ligne puis s’y cale. Le rouleau des questions part 0,15 à 0,4 s après celui des élèves et s’arrête 0,4 à 0,9 s après lui. Pendant sa rotation, la bande d’un rouleau passe à `accent-bg`, puis reprend sa couleur à l’arrêt. Une rotation complète dure de 2 à 3,5 s. La préférence de réduction des animations donne directement le résultat. Le verdict colore la bande et s’écrit sous les rouleaux.

La régie affiche le tirage en cours, la réponse attendue et un seul groupe d’actions : le tirage, ou les deux évaluations quand une réponse attend. Le focus passe du tirage à l’évaluation, puis au tirage suivant ou au statut de fin. La progression reste en petit texte à droite des actions.

Dans la régie des équipes, les tailles de 2 à 5 sont des boutons à bascule. Celui qui correspond à la composition prend le fond `accent-bg` et une bordure d’accent. Un seul bouton principal à la fois : tirer les équipes, puis l’ordre, puis commencer et faire avancer les oraux. Le nom d’une équipe se modifie sur place : un titre au repos, un champ au survol et au focus. L’équipe à l’oral reçoit un fond `accent-bg` et une règle d’accent de 2 px. Sur l’écran, elle porte la bande `accent-text` dans la file de passage, comme la bande de la roulette. Les équipes passées prennent `text-muted`. Un nouveau tirage s’affiche nom par nom sur l’écran, à 35 ms d’écart, avec un flou et un léger glissement. Un nouvel ordre ou un changement de passage fait glisser les équipes par une transition de vue. La réduction des animations affiche directement le résultat.

## Do's and Don'ts

- Conserver les couleurs et polices de Carnet dans les deux thèmes.
- Accompagner les verdicts d’un texte et garder le focus clavier visible.
- Respecter la préférence de réduction des animations.
- Pas de letter-spacing, de titres en capitales, de serif ni de Tailwind.
