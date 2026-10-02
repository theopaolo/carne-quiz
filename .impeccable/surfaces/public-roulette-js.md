---
version: 1
slug: "public-roulette-js"
primary_target: "public/roulette.js"
related_targets: ["prof.js","public/quiz.css"]
---

# Quiz-roulette

Mode : Operate. Formateur en classe, utilisation projetée ou depuis son appareil.

## Direction contract

THESIS : deux colonnes de tirage alignées sur une ligne sélectionnée, d'après la maquette fournie.

OWN-WORLD : conserver Inclusive Sans, les surfaces crème, l'accent violet et les états vert et rouge de Carnet. Le thème sombre existant reste disponible.

STORY : choisir la classe, indiquer les présents, tirer puis évaluer la réponse. Priorité aux moins interrogés, 2 ou 3 passages maximum. Les questions réussies sortent, les questions ratées reviennent.

FIRST VIEWPORT : régie avec titre, groupe, élève, question, réponse et un seul groupe d'actions. Réglages repliés. L'écran des élèves (/prof/roulette/ecran) montre seulement les deux rouleaux et le verdict, sans réponse.

FORM : extension de l'interface existante, structure fournie par la maquette et explicitement affinable. Aucun nouveau monde visuel ni tournoi de concepts.

FINISH : unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Animation : rouleaux décalés, accélération, vitesse constante, freinage et léger dépassement, durées tirées au hasard. Le clavier lance la rotation sur l'écran des élèves. Pas de rotation avec la réduction des animations. Le résultat reçoit la couleur de son évaluation, accompagnée d'un texte explicite.

Contraintes : aucune nouvelle dépendance, aucun fichier privé de quiz exposé, authentification du formateur conservée. Sauvegarde locale par groupe. Banque de 72 questions dans decks/questions-courtes.md.
