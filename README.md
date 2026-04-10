# Stream Aggregator Sora Plugin

Ce plugin Sora expose des streams HLS via un backend d'agregation, en s'appuyant sur TMDB pour la recherche et les metadonnees.

## Installation

1. Copiez `venom-stream.json` dans le repertoire des modules Sora.
2. Le script `stream-source.js` sera charge depuis l'URL definie dans le manifeste.

## Fonctionnement

Le plugin utilise TMDB pour la recherche et les details, puis `api.movix.blog` pour resoudre les flux HLS.

### Flux

1. Recherche sur TMDB puis verification de disponibilite cote agregateur.
2. Recuperation des details depuis TMDB.
3. Pour les series, enumeration des saisons et episodes via TMDB.
4. Resolution du stream HLS via l'agregateur, avec fallback `purstream` pour les episodes de series.

## Configuration

- Qualite cible : `1080p` avec selection de la meilleure source disponible.
- Langue : francais.
- Stream : `HLS`.
- Mode Sora : `asyncJS` active, `streamAsyncJS` desactive.

Ce mode garantit que `extractStreamUrl()` recoit une URL et non du HTML brut.

## Note Sora

La doc `docs/sora.md` n'autorise qu'une seule valeur manifeste pour `type` : `anime`, `movies` ou `shows`.

Comme ce module couvre a la fois les films et les series, le champ `type` a ete retire de `venom-stream.json` pour eviter une categorisation incorrecte.

## URLs personnalisees

- `movie/<tmdbId>`
- `tv/<tmdbId>`
- `tv/<tmdbId>/<saison>/<episode>`

Le parser accepte encore les anciens formats `media://stream/...` et les alias `show`, `shows` et `series` pour le type TV.

## Tests

```bash
cd venom-stream
node test_stream_source.js
```

## Dependances

- API TMDB
- API d'agregation `api.movix.blog`

## Limitations

- Le manifeste Sora ne propose pas de type mixte films+series.
- Les APIs necessitent une connexion reseau.
- Les URLs HLS sont signees et peuvent expirer.
