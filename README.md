# Carnet

Bullet journal personnel : journal (jour, semaine, mois), planning, humeur, habitudes, dépenses, listes, idées cadeaux, anniversaires, affirmations et thème astral.

Application web installable sur iPhone (Safari › Partager › Sur l'écran d'accueil). Elle fonctionne hors ligne et toutes les données restent sur le téléphone.

- Calculs astronomiques : [astronomy-engine](https://github.com/cosinekitty/astronomy) (licence MIT, fichier `astronomy.min.js`).
- `astro.js` : événements du ciel 2026–2035 (heure de Paris), précalculés avec astronomy-engine.

## Notifications

Le dossier `worker/` contient le petit serveur (Cloudflare Worker, offre gratuite) qui envoie les notifications :
- liaison KV nommée `CARNET` ;
- déclencheur cron `* * * * *` ;
- aucune clé à saisir : les clés VAPID sont créées au premier lancement, et l'app s'enregistre avec un jeton aléatoire (le premier reçu devient le seul accepté).
