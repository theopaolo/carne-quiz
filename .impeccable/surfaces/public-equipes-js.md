---
version: 1
slug: "public-equipes-js"
primary_target: "public/equipes.js"
related_targets: ["prof.js", "public/quiz.css"]
---

# Équipes au hasard

Mode : Operate. Le formateur prépare des équipes et les passages à l’oral.

## Direction contract

THESIS : composer des équipes de tailles choisies, puis tirer leur ordre de passage indépendamment.

OWN-WORLD : extension de Carnet, avec Inclusive Sans, les surfaces crème, l’accent violet et le thème sombre existants. Les emojis font partie des noms proposés, à la demande de l’utilisateur.

STORY : choisir la classe, cocher les présents, choisir une taille d’équipe ou configurer le nombre d’équipes par taille, tirer les équipes, modifier leurs noms, tirer l’ordre de passage puis faire avancer les oraux. Réglages, résultats et passages conservés localement par classe.

FIRST VIEWPORT : titre, classe et accès à l’écran des élèves. Composition compacte à gauche avec tailles proposées, total des places et bouton de tirage. Équipes numérotées dans l’ordre de passage et déroulé des oraux à droite sur ordinateur. Une seule colonne sur téléphone. L’écran des élèves (/prof/equipes/ecran) montre les équipes en grand, puis pendant les oraux l’équipe à l’oral et la file de passage, pilotables au clavier ou à la télécommande.

FORM : demande précise dans un système établi, sans nouveau monde visuel ni tournoi. Listes séparées par des règles, contrôles natifs, aucune nouvelle dépendance.

FINISH : unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Contraintes : pas de tirage si le nombre de places diffère des présents. Chaque élève présent apparaît une fois. Un nouveau tirage d’ordre conserve les équipes et leurs noms. Les listes de classe utilisent l’enregistrement existant et son authentification.
