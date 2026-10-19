# Mettre Récré’Jeux en ligne

Le site est un serveur Node.js unique, sans dépendance npm : un simple
`node server.js` suffit. Tout ce qui est écrit (salons, comptes, journal,
historique) va dans le dossier `DATA_DIR` (`.data/` par défaut).

> **Une seule instance à la fois.** Les salons vivent en mémoire et sont
> sauvegardés dans des fichiers JSON. Il ne faut donc pas lancer plusieurs
> copies du serveur derrière un répartiteur de charge : les joueurs se
> retrouveraient dans des salons différents. Un serveur = une instance.

## Variables d’environnement

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `CREATOR_CODE` | oui | Code secret qui autorise la création de salons. À ne jamais mettre dans le dépôt. |
| `PORT` | non (3000) | Port d’écoute. La plupart des hébergeurs l’imposent. |
| `DATA_DIR` | non (`.data`) | Dossier des données. À placer sur un volume persistant. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | sur Vercel | Base Redis (Upstash / Vercel KV). Sans elles, Vercel tourne en mémoire. |
| `STORAGE` | non | Force le mode : `files`, `kv` ou `memory`. |

Les noms `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` sont aussi
reconnus si tu préfères brancher Upstash directement.

Le serveur écoute toujours sur `0.0.0.0` et répond sur `GET /api/health`
(`{"ok":true,"rooms":…}`), ce qui sert de sonde de santé aux hébergeurs.

## Option 1 — Vercel

Le projet est prêt pour Vercel : `api/index.js` sert de fonction serverless,
`vercel.json` envoie toutes les routes `/api/…` vers ce même gestionnaire, et
`public/` est servi par le CDN.

1. Sur [vercel.com](https://vercel.com), **Add New… → Project**, choisis le
   dépôt GitHub `pinckleon31-ui/uno` (le projet `uno` existe déjà).
2. Dans **Environment Variables**, ajoute au minimum :
   - `CREATOR_CODE` — le code organisateur (marque-le *Sensitive*).
3. **Deploy**. L’adresse `https://uno-….vercel.app` est publique en une minute.

### Faire durer les données (fortement conseillé)

Sur Vercel, les fonctions n’ont **pas de disque** : sans base, le site tourne
en mode *mémoire* — tout fonctionne, mais les salons, comptes, records et le
journal disparaissent au bout de quelques minutes d’inactivité, et deux
personnes peuvent tomber sur deux copies différentes du site.

Pour éviter cela, ajoute une base Redis gratuite (Upstash) et connecte-la au
projet :

1. Tableau de bord Vercel → onglet **Storage** → **Create Database** →
   **Upstash Redis** (ou va sur [upstash.com](https://upstash.com) et crée une
   base gratuite).
2. **Connect** la base au projet `uno`. Vercel ajoute tout seul
   `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
3. Redéploie. Le site détecte ces variables et bascule en stockage partagé :
   `/api/health` répond alors `"storage":"kv","persistent":true`.

Avec Upstash (comme avec Vercel KV), il n’y a **aucun paquet à installer** : le
serveur parle directement à l’API REST de la base.

### Ce qu’il faut savoir sur le plan gratuit

- Les fonctions sont limitées en durée (`maxDuration` fixé à 30 s) et le site
  utilise un rafraîchissement toutes les 2,5 s pendant une partie : c’est
  parfait pour une classe, mais évite de laisser 30 onglets ouverts toute la
  journée.
- L’offre gratuite d’Upstash (10 000 commandes/jour) suffit largement à une
  classe ; chaque requête API coûte une lecture groupée.
- La liste « En ligne maintenant » du panneau admin est gardée en mémoire par
  instance : sur Vercel elle peut être incomplète. Tout le reste (salons,
  parties, tchat, comptes, journal) passe par la base et reste cohérent.

> Si tu préfères un serveur classique (données sur disque, une seule
> instance), les options 2 à 4 restent valables : le même dépôt fonctionne
> sans rien changer.

## Option 2 — Render (simple, gratuit)

1. Pousse le dépôt sur GitHub, puis va sur [render.com](https://render.com) →
   **New** → **Blueprint** et choisis le dépôt : le fichier `render.yaml`
   fourni décrit le service.
   Sans Blueprint : **New** → **Web Service**, *Language* **Docker**, plan
   **Free**.
2. Renseigne `CREATOR_CODE` dans *Environment* (marque-le *Secret*).
3. Déploie : Render build l’image du `Dockerfile` et te donne une adresse en
   `https://…onrender.com`, immédiatement accessible sur internet.

À savoir, sur le plan **Free** (octobre 2026) : le service s’endort après
15 minutes sans visite et se réveille en une minute environ, et **il n’accepte
pas de disque persistant** — un redéploiement repart donc de zéro pour les
salons, comptes, records en ligne et journal. C’est parfait pour tester avec la
classe pendant une journée, pas pour garder les comptes d’une année.

Pour des données durables, passe le service en plan *Starter* (7 $/mois),
ajoute un **disque** de 1 Go monté sur `/app/.data`, puis décommente le bloc
`disk:` de `render.yaml` (ou ajoute le disque depuis le tableau de bord).

## Option 3 — Railway

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub**.
   Railway détecte `package.json` et lance `npm start` (le `Procfile` est là
   aussi, et le `Dockerfile` peut être choisi à la place).
2. Ajoute un **volume** monté sur `/app/.data`, puis la variable `DATA_DIR`
   valant `/app/.data` et `CREATOR_CODE`.
3. *Settings* → **Generate Domain** pour obtenir l’adresse publique.

Le plan gratuit donne 1 $ de crédit par mois (et 0,5 Go de volume) : suffisant
pour quelques essais. Les volumes du plan gratuit sont effacés **30 jours**
après la fin du crédit, donc sauvegarde `.data/` si les comptes comptent.

## Option 4 — VPS (OVHcloud, Scaleway, Hetzner…)

C’est l’option la plus confortable pour une école : un petit serveur à
3–5 €/mois, un nom de domaine, et les données restent chez toi.

```bash
git clone <ton-dépôt> recre-jeux && cd recre-jeux
CREATOR_CODE="un-code-long-et-privé" docker compose up -d --build
```

`docker-compose.yml` construit l’image, redémarre le service en cas de
plantage et range les données dans le volume `recre-data`. Le site répond
alors sur `http://IP-du-serveur:3000`.

Pour le HTTPS et un vrai nom de domaine, ajoute [Caddy](https://caddyserver.com)
devant (il obtient le certificat automatiquement) :

```caddyfile
jeux.mon-ecole.fr {
    reverse_proxy 127.0.0.1:3000
}
```

Sauvegarde : `docker run --rm -v recre-jeux_recre-data:/data -v "$PWD:/sauvegarde" alpine tar czf /sauvegarde/recre-data.tgz /data`
(ou simplement `cp -a .data /une/cle/usb/` si le site tourne sans Docker).

Sans Docker, un `systemd` suffit :

```ini
[Service]
WorkingDirectory=/opt/recre-jeux
Environment=CREATOR_CODE=un-code-long-et-privé
Environment=DATA_DIR=/var/lib/recre-jeux
ExecStart=/usr/bin/node server.js
Restart=always
User=recre
```

## Hors ligne, sur le réseau de l’école

Le serveur n’a besoin d’aucun accès internet pour fonctionner : un vieux PC ou
un Raspberry Pi sur le Wi-Fi de l’école suffit, et les élèves se connectent à
`http://adresse-du-pc:3000`. Le site est prévu pour ça : aucune ressource
externe (police, script, image) n’est chargée depuis internet.

## Vérifications après la mise en ligne

1. `https://ton-adresse/api/health` doit répondre `{"ok":true,"rooms":0,…}` et
   indiquer `"storage":"kv"` (ou `"files"` sur un serveur classique) ; si tu lis
   `"storage":"memory"`, les données ne survivront pas.
2. Ouvre la page, entre le code organisateur, crée un salon, rejoins-le depuis
   le téléphone : la liste doit se mettre à jour sur les deux appareils.
3. Vérifie que `CREATOR_CODE` n’apparaît nulle part dans la page
   (`Ctrl+F` sur le code source).
4. Fais un premier export depuis le panneau administrateur pour vérifier que
   les données sont bien écrites dans `DATA_DIR`.

## Mettre à jour une instance existante

```bash
git pull && docker compose up -d --build
```

Le volume garde `rooms.json`, `accounts.json` et `activity.json` : rien n’est
écrasé. Avant une grosse mise à jour, copie quand même le dossier `.data/` :
c’est toute la mémoire du site.
