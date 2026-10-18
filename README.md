# Récré’Jeux

Un petit site en français pour créer des salons de jeux à l’école et permettre aux autres de les voir et de les rejoindre avec un pseudo.

## Lancer le site

Node.js 18 ou plus récent est nécessaire. Le code organisateur se configure uniquement côté serveur avec la variable d’environnement `CREATOR_CODE` :

```bash
CREATOR_CODE="choisir-un-code-prive" npm start
```

Le serveur écoute sur le port `3000` par défaut. Pour en choisir un autre, définis aussi `PORT`.

## Fonctionnalités

- Les parties ouvertes sont visibles sans code.
- L’organisateur peut lancer dès que le minimum de joueurs du jeu est présent, sans attendre que toutes les places soient prises (par exemple 2/4 pour UNO). Une partie lancée n’accepte plus de nouveaux joueurs.
- Le compte joueur est facultatif : chacun peut créer un pseudo unique avec un mot de passe court (4 caractères minimum), puis se reconnecter avec ces identifiants. Le dernier pseudo de compte est mémorisé pour faciliter la reconnexion ; la connexion reste active pendant 30 jours. Le mot de passe est haché côté serveur et n’est jamais renvoyé au navigateur. Il n’y a pas de récupération par e-mail, alors choisis un mot de passe facile à retenir, mais évite d’en réutiliser un important. Les salons restent rejoignables sans compte ni code.
- Le panneau administrateur est protégé par le code organisateur et permet de consulter le nombre de comptes, renommer ou supprimer un compte, et gérer les rôles admin et Tricheur. Le code est vérifié côté serveur, protégé contre les essais répétés et n’est pas inclus dans le JavaScript envoyé au navigateur.
- Le rôle secret Tricheur n’est pas affiché à côté du pseudo dans les salons. Son titulaire peut voir les rôles de Loup-garou, toutes les mains UNO, choisir la prochaine carte piochée ou donner une carte à un joueur. Ces informations et actions sont protégées côté serveur.
- Chaque partie en cours peut être affichée en plein écran avec le tchat à côté ; sur les écrans étroits, le tchat passe sous le jeu.
- Seul un compte ayant le rôle administrateur ou une session organisateur valide peut ouvrir un nouveau salon ; les administrateurs connectés à leur compte n’ont pas à ressaisir le code.
- Les sept jeux sont jouables : UNO (cartes spéciales, jokers, pioche et revanche), Puissance 4 (grille 6 × 7, alignements et match nul), Loup-garou (cycles nuit/jour minutés, vote du village, loups, voyante, médecin, sorcière, Cupidon, amoureux, chasseur et ancien), Quiz express (huit questions et classement), Blind test (mélodies originales générées dans le navigateur), Morpion (duel 3 × 3 avec bot tactique) et Memory (seize cartes, paires, points et tours rejoués en cas de réussite).
- Au Loup-garou, les loups choisissent ensemble une victime, la voyante inspecte, le médecin protège et la sorcière peut sauver et/ou empoisonner avec deux potions à usage unique. Cupidon crée un couple secret dont les amoureux meurent ensemble et peuvent gagner comme dernier duo ; le Chasseur riposte à sa mort. L’Ancien résiste une fois aux loups, mais le village perd ses pouvoirs spéciaux s’il l’élimine par vote. Les actions nocturnes disposent d’un délai de 45 secondes, le vote du jour de 2 minutes et le dernier tir du Chasseur de 25 secondes ; les délais font avancer la partie sans la bloquer.
- Un tchat est intégré à chaque salon, dans le lobby comme pendant la partie. Chaque message affiche le pseudo, l’emoji d’identité, sa couleur et l’heure. Les messages sont limités à 220 caractères et l’historique à 80 entrées par salon. Dans Loup-garou, le tchat public se ferme la nuit, les loups encore en jeu disposent d’un canal privé, et les joueurs éliminés ne peuvent plus intervenir.
- Fonction supplémentaire du tchat : réactions rapides par emoji (👏 😂 🤔 🎉 ❤️ 🔥 🤝 💡), avec une courte limite anti-spam.
- Le classement conserve les victoires des comptes joueur et affiche leur pseudo enregistré. Les parties jouées sans compte restent anonymes et ne modifient pas ce classement.
- Les salons et la liste des joueurs se mettent à jour automatiquement. Une présence inactive est retirée après quelques minutes.
- La section « Mode solo » propose quatre vrais jeux pour une seule personne, jouables immédiatement sans code organisateur, sans mot de passe et sans compte : Snake, 2048, Démineur et Memory solo. Ces jeux tournent entièrement dans le navigateur : aucun salon n’est créé, rien n’apparaît dans le lobby et les records sont gardés uniquement sur l’appareil.
- Chaque jeu solo a sa barre de réglages, choisie en un clic avant ou pendant la partie : Snake en quatre vitesses (Tranquille 18 × 18, Normal 20 × 20, Rapide 24 × 24, Turbo 28 × 28, toutes accélérant avec le score), 2048 en 4 × 4, 5 × 5 ou 6 × 6 avec les objectifs 2048, 4096 et 8192, Démineur de Facile (9 × 9, 10 mines) à Expert (20 × 20, 90 mines) en passant par Moyen (12 × 12, 25 mines) et Difficile (16 × 16, 50 mines), et Memory solo en 8, 12 ou 18 paires. Le réglage choisi est mémorisé sur l’appareil et chaque variante garde son propre record.
- Le Snake a été entièrement réécrit : plateau dessiné sur un `canvas` (aucune grille CSS, donc aucun décalage de rangée possible), départ à la première commande, file de deux virages pour ne jamais perdre une touche, demi-tour et diagonale impossibles par construction, et pilotage au clavier (flèches ou ZQSD), aux boutons ou au doigt en glissant sur le plateau. Espace met en pause, R relance.
- Le bouton ⛶ de l’en-tête met n’importe quel jeu solo en grand : plein écran natif quand le navigateur l’autorise, sinon repli plein cadre, avec un plateau agrandi et le même bouton pour revenir à la fenêtre (touche Échap également).
- L’organisateur peut arrêter une partie déjà lancée, depuis la partie elle-même ou depuis la carte du salon, après confirmation ; fermer son salon ou ajouter/retirer des bots de test pour remplir les places. Ils jouent automatiquement aux sept jeux ; le bot de morpion bloque les alignements et le Memory mémorise les cartes déjà vues. Les salons sont conservés dans `.data/rooms.json` et les comptes, hachages de mots de passe, sessions et scores dans `.data/accounts.json`, dossier ignoré par Git.

## À noter

Le panneau administrateur affiche aussi « En ligne maintenant » : la liste en direct des personnes dont le navigateur est ouvert sur le site, avec leur pseudo (compte ou invité), ce qu’elles sont en train de faire, leur type d’appareil et leur durée de connexion. Trois boutons par personne (🔔 Cloche, 🚨 Alarme, 🎉 Tada) envoient un son sur son appareil pour attirer son attention ; le son est joué une seule fois, accompagné d’une vibration quand l’appareil le permet. La présence est tenue en mémoire du serveur, sans écriture disque : chaque navigateur se signale toutes les huit secondes et disparaît de la liste quarante secondes après sa fermeture.

Le stockage JSON convient à une seule instance du serveur ; pour un déploiement durable avec beaucoup de classes ou plusieurs instances, il faudra le remplacer par une base de données partagée. Les mélodies du Blind test sont des sons originaux synthétisés par le navigateur, sans catalogue musical externe. Lance `npm test` pour exécuter les tests des sept moteurs multijoueurs, des quatre jeux solo et de leurs variantes, du tchat et des API de bout en bout.
