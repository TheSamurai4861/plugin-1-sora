# Stream Aggregator Sora Plugin

Ce plugin Sora permet d'accéder aux streams HLS via un backend d'agrégation, en s'appuyant sur TMDB pour la recherche et les métadonnées.

## Installation

1. Copiez le fichier `movix.json` dans le répertoire des modules Sora
2. Le script `stream_source.js` sera automatiquement chargé depuis l'URL spécifiée

## Fonctionnement

Le plugin utilise l'API de TMDB pour la recherche et les métadonnées, puis une API d'agrégation pour obtenir les streams HLS.

### Flux de fonctionnement :
1. **Recherche** : Recherche sur TMDB, vérifie la disponibilité sur l'agrégateur
2. **Détails** : Récupère les informations détaillées depuis TMDB
3. **Épisodes** : Pour les films, un seul "épisode" (le film complet)
4. **Stream** : Convertit l'ID TMDB en URL HLS via l'API d'agrégation

## Configuration

Le plugin est configuré pour :
- **Qualité** : 1080p (mais retourne la meilleure qualité disponible)
- **Type** : Films uniquement
- **Langue** : Français
- **Stream** : HLS

## URLs personnalisées

Le plugin utilise un schéma d'URL personnalisé :
- `media://12345` : Identifie un film par son ID TMDB
- `media://stream/12345` : Demande le stream HLS pour ce film

## Dépendances

- API TMDB (clé incluse)
- API d'agrégation (requiert headers spécifiques pour CORS)

## Limitations

- Fonctionne uniquement avec des films (pas de séries)
- Nécessite une connexion internet pour les APIs
- Les URLs HLS sont signées et peuvent expirer