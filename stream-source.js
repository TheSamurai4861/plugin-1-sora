// Sora streaming module
// Converts TMDB IDs to HLS streams using a backend aggregator API

const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";
const TMDB_BASE = "https://api.themoviedb.org/3";
const SOURCE_API_BASE = "https://api.movix.blog";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "identity",
    "Referer": "https://movix.rodeo/",
    "Origin": "https://movix.rodeo"
};

function buildQueryString(params) {
    return Object.keys(params)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
        .join('&');
}

async function fetchJson(url) {
    try {
        const response = await fetchv2(url, HEADERS);
        try {
            return await response.json();
        } catch (jsonError) {
            const rawText = await response.text();
            return JSON.parse(rawText);
        }
    } catch (error) {
        console.log(`Fetch error for ${url}:`, error);
        return null;
    }
}

async function getTmdbDetails(tmdbId, mediaType = 'movie') {
    if (!tmdbId) {
        return null;
    }

    const url = `${TMDB_BASE}/${mediaType}/${tmdbId}`;
    const queryString = buildQueryString({ api_key: TMDB_API_KEY, language: 'fr-FR' });
    return await fetchJson(`${url}?${queryString}`);
}

async function getTmdbSeasonDetails(tmdbId, seasonNumber) {
    if (!tmdbId || !seasonNumber) {
        return null;
    }

    const url = `${TMDB_BASE}/tv/${tmdbId}/season/${seasonNumber}`;
    const queryString = buildQueryString({ api_key: TMDB_API_KEY, language: 'fr-FR' });
    return await fetchJson(`${url}?${queryString}`);
}

async function searchSourceByTitle(title) {
    if (!title) {
        return null;
    }

    const url = `${SOURCE_API_BASE}/api/search?title=${encodeURIComponent(title)}`;
    return await fetchJson(url);
}

async function findSourceResult(mediaDetails, mediaType) {
    if (!mediaDetails) {
        return null;
    }

    const titles = [
        mediaDetails.title,
        mediaDetails.original_title,
        mediaDetails.name,
        mediaDetails.original_name
    ]
        .filter(Boolean)
        .map(title => title.trim())
        .filter(Boolean);

    for (const title of Array.from(new Set(titles))) {
        const sourceSearch = await searchSourceByTitle(title);
        if (!sourceSearch || !Array.isArray(sourceSearch.results)) {
            continue;
        }

        const exactMatch = sourceSearch.results.find(result =>
            String(result.tmdb_id) === String(mediaDetails.id) &&
            (mediaType !== 'tv' || String(result.type).toLowerCase() === 'series')
        );

        if (exactMatch) {
            return exactMatch;
        }

        const typeMatch = sourceSearch.results.find(result =>
            mediaType === 'tv'
                ? String(result.type).toLowerCase() === 'series'
                : String(result.type).toLowerCase() !== 'series'
        );

        if (typeMatch) {
            return typeMatch;
        }
    }

    return null;
}

async function getDownloadLinks(internalId) {
    if (!internalId) {
        return null;
    }

    const url = `${SOURCE_API_BASE}/api/films/download/${internalId}`;
    return await fetchJson(url);
}

async function getSeriesDownloadLinks(internalId, season, episode) {
    if (!internalId || !season || !episode) {
        return null;
    }

    const url = `${SOURCE_API_BASE}/api/series/download/${internalId}/season/${season}/episode/${episode}`;
    return await fetchJson(url);
}

async function getSeriesPurstreamLinks(tmdbId, season, episode) {
    if (!tmdbId || !season || !episode) {
        return null;
    }

    const url = `${SOURCE_API_BASE}/api/purstream/tv/${tmdbId}/stream?season=${season}&episode=${episode}`;
    return await fetchJson(url);
}

function extractHlsSources(downloadData) {
    const sources = [];

    if (!downloadData || !Array.isArray(downloadData.sources)) {
        return sources;
    }

    downloadData.sources.forEach(source => {
        const url = source.m3u8 || source.url;
        if (!url || typeof url !== 'string' || !url.trim()) {
            return;
        }

        const normalizedUrl = url.trim();
        const typeHint = String(source.type || source.format || '').toLowerCase();
        const isHls = typeHint.includes('hls') || typeHint.includes('m3u8') || normalizedUrl.includes('.m3u8');
        if (!isHls) {
            return;
        }

        sources.push({
            url: normalizedUrl,
            quality: source.quality || source.name || 'Unknown',
            language: source.language || 'Unknown',
            name: source.src ? source.src.split('/').pop() : source.name || 'Unknown'
        });
    });

    return sources;
}

function parseMediaUrl(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const tmdbMatch = input.match(/media:\/\/stream\/(\d+)/);
    if (!tmdbMatch) {
        return null;
    }

    const tmdbId = tmdbMatch[1];
    let mediaType = 'movie';
    let season;
    let episode;

    const queryIndex = input.indexOf('?');
    if (queryIndex !== -1) {
        const queryString = input.substring(queryIndex + 1);
        const params = new URLSearchParams(queryString);
        const typeParam = params.get('mediaType') || params.get('type');
        if (typeParam) {
            mediaType = String(typeParam).toLowerCase() === 'tv' ? 'tv' : 'movie';
        }

        season = params.has('season') ? Number(params.get('season')) : undefined;
        episode = params.has('episode') ? Number(params.get('episode')) : undefined;
    }

    const slashMatch = input.match(/media:\/\/stream\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
    if (slashMatch) {
        mediaType = 'tv';
        season = Number(slashMatch[2]);
        episode = Number(slashMatch[3]);
    }

    return {
        tmdbId,
        mediaType,
        season: Number.isFinite(season) ? season : undefined,
        episode: Number.isFinite(episode) ? episode : undefined
    };
}

function formatEpisodeHref(tmdbId, season, episode) {
    return `media://stream/${tmdbId}?mediaType=tv&season=${season}&episode=${episode}`;
}

async function searchResults(keyword) {
    try {
        const query = encodeURIComponent(keyword);
        const movieUrl = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${query}&language=fr-FR&page=1`;
        const tvUrl = `${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${query}&language=fr-FR&page=1`;

        const [movieData, tvData] = await Promise.all([
            fetchJson(movieUrl),
            fetchJson(tvUrl)
        ]);

        const results = [];

        if (movieData && Array.isArray(movieData.results)) {
            for (const movie of movieData.results.slice(0, 10)) {
                const sourceResult = await findSourceResult(movie, 'movie');
                if (!sourceResult) {
                    continue;
                }

                results.push({
                    title: movie.title,
                    image: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
                    href: `media://stream/${movie.id}?mediaType=movie`
                });
            }
        }

        if (tvData && Array.isArray(tvData.results)) {
            for (const tvShow of tvData.results.slice(0, 10)) {
                const sourceResult = await findSourceResult(tvShow, 'tv');
                if (!sourceResult) {
                    continue;
                }

                results.push({
                    title: tvShow.name,
                    image: tvShow.poster_path ? `https://image.tmdb.org/t/p/w500${tvShow.poster_path}` : '',
                    href: `media://stream/${tvShow.id}?mediaType=tv`
                });
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('Search error:', error);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const parsed = parseMediaUrl(url);
        if (!parsed) {
            return JSON.stringify([]);
        }

        const details = await getTmdbDetails(parsed.tmdbId, parsed.mediaType);
        if (!details) {
            return JSON.stringify([]);
        }

        return JSON.stringify([{
            description: details.overview || details.description || 'No description available',
            aliases: details.original_title || details.original_name || details.name || details.title || 'Unknown',
            airdate: parsed.mediaType === 'tv'
                ? (details.first_air_date ? new Date(details.first_air_date).getFullYear().toString() : 'Unknown')
                : (details.release_date ? new Date(details.release_date).getFullYear().toString() : 'Unknown')
        }]);
    } catch (error) {
        console.log('Extract details error:', error);
        return JSON.stringify([]);
    }
}

async function extractEpisodes(url) {
    try {
        const parsed = parseMediaUrl(url);
        if (!parsed || parsed.mediaType !== 'tv') {
            return JSON.stringify([]);
        }

        const tvDetails = await getTmdbDetails(parsed.tmdbId, 'tv');
        if (!tvDetails || !Array.isArray(tvDetails.seasons)) {
            return JSON.stringify([]);
        }

        const seasons = tvDetails.seasons
            .filter(season => Number.isFinite(season.season_number) && season.season_number > 0)
            .slice(0, 10);

        const seasonDetails = await Promise.all(
            seasons.map(season => getTmdbSeasonDetails(parsed.tmdbId, season.season_number))
        );

        const episodes = [];
        for (const seasonDetail of seasonDetails) {
            if (!seasonDetail || !Array.isArray(seasonDetail.episodes)) {
                continue;
            }

            for (const episode of seasonDetail.episodes) {
                const seasonNumber = seasonDetail.season_number || episode.season_number;
                const episodeNumber = episode.episode_number;
                if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
                    continue;
                }

                episodes.push({
                    href: formatEpisodeHref(parsed.tmdbId, seasonNumber, episodeNumber),
                    number: `S${seasonNumber}E${episodeNumber}`
                });
            }
        }

        return JSON.stringify(episodes);
    } catch (error) {
        console.log('Extract episodes error:', error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const parsed = parseMediaUrl(url);
        if (!parsed || !parsed.tmdbId) {
            return null;
        }

        const mediaDetails = await getTmdbDetails(parsed.tmdbId, parsed.mediaType);
        if (!mediaDetails) {
            return null;
        }

        const sourceResult = await findSourceResult(mediaDetails, parsed.mediaType);
        if (!sourceResult) {
            return null;
        }

        let downloadData = null;
        if (parsed.mediaType === 'tv') {
            if (!parsed.season || !parsed.episode) {
                return null;
            }
            downloadData = await getSeriesDownloadLinks(sourceResult.id, parsed.season, parsed.episode);
            if (!downloadData) {
                downloadData = await getSeriesPurstreamLinks(parsed.tmdbId, parsed.season, parsed.episode);
            }
        } else {
            downloadData = await getDownloadLinks(sourceResult.id);
        }

        if (!downloadData) {
            return null;
        }

        const hlsSources = extractHlsSources(downloadData)
            .filter(source => source.url && source.url.trim().length > 0);
        if (hlsSources.length === 0) {
            return null;
        }

        const qualityOrder = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
        hlsSources.sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));

        return hlsSources[0].url;
    } catch (error) {
        console.log('Extract stream URL error:', error);
        return null;
    }
}
