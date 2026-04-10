// Sora streaming module
// Converts TMDB IDs to HLS streams using a backend aggregator API

const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";
const TMDB_BASE = "https://api.themoviedb.org/3";
const SOURCE_API_BASE = "https://api.movix.blog";
const PLAYER_BASE = "https://movix.rodeo/player";
const CACHE_TTL_MS = 15 * 60 * 1000;

const sourceResultCache = new Map();
const episodeIndexCache = new Map();

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

function normalizeMediaType(type) {
    const normalizedType = String(type || '').trim().toLowerCase();
    return ['tv', 'show', 'shows', 'series'].includes(normalizedType) ? 'tv' : 'movie';
}

function getCachedValue(cache, key) {
    const entry = cache.get(key);
    if (!entry) {
        return undefined;
    }

    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return undefined;
    }

    return entry.value;
}

function setCachedValue(cache, key, value) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS
    });

    return value;
}

function logSeriesResolution(event, payload) {
    try {
        console.log(`[series-resolution] ${event} ${JSON.stringify(payload)}`);
    } catch (error) {
        console.log(`[series-resolution] ${event}`);
    }
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

async function fetchText(url) {
    try {
        const response = await fetchv2(url, HEADERS);
        return await response.text();
    } catch (error) {
        console.log(`Fetch text error for ${url}:`, error);
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

async function resolveTmdbDetails(tmdbId, preferredMediaType) {
    const primaryType = normalizeMediaType(preferredMediaType);
    const fallbackType = primaryType === 'tv' ? 'movie' : 'tv';

    const primaryDetails = await getTmdbDetails(tmdbId, primaryType);
    if (primaryDetails) {
        return {
            mediaType: primaryType,
            details: primaryDetails
        };
    }

    const fallbackDetails = await getTmdbDetails(tmdbId, fallbackType);
    if (fallbackDetails) {
        return {
            mediaType: fallbackType,
            details: fallbackDetails
        };
    }

    return null;
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

    const cacheKey = `${normalizeMediaType(mediaType)}:${mediaDetails.id}`;
    const cachedResult = getCachedValue(sourceResultCache, cacheKey);
    if (cachedResult !== undefined) {
        return cachedResult;
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
            return setCachedValue(sourceResultCache, cacheKey, exactMatch);
        }

        const typeMatch = sourceSearch.results.find(result =>
            mediaType === 'tv'
                ? String(result.type).toLowerCase() === 'series'
                : String(result.type).toLowerCase() !== 'series'
        );

        if (typeMatch) {
            return setCachedValue(sourceResultCache, cacheKey, typeMatch);
        }
    }

    return setCachedValue(sourceResultCache, cacheKey, null);
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

function hasPlayableHlsSource(downloadData) {
    return extractHlsSources(downloadData).some(source => source.url && source.url.trim());
}

function sortSourcesByPriority(sources) {
    const qualityOrder = { '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
    return [...sources].sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));
}

async function isPlayableHlsUrl(url) {
    if (!url) {
        return false;
    }

    const text = await fetchText(url);
    if (!text || typeof text !== 'string') {
        return false;
    }

    return text.includes('#EXTM3U');
}

async function selectBestSourceUrl(downloadDataList) {
    const allSources = [];
    const seenUrls = new Set();

    for (const downloadData of downloadDataList) {
        const sources = extractHlsSources(downloadData);
        for (const source of sources) {
            if (!source.url || seenUrls.has(source.url)) {
                continue;
            }
            seenUrls.add(source.url);
            allSources.push(source);
        }
    }

    if (allSources.length === 0) {
        return null;
    }

    const sortedSources = sortSourcesByPriority(allSources);
    for (const source of sortedSources) {
        if (await isPlayableHlsUrl(source.url)) {
            return source.url;
        }
    }

    return sortedSources[0].url;
}

function createEpisodeKey(seasonNumber, episodeNumber) {
    return `${seasonNumber}:${episodeNumber}`;
}

async function buildCanonicalEpisodeIndex(tmdbId, tvDetails) {
    if (!tmdbId || !tvDetails || !Array.isArray(tvDetails.seasons)) {
        return null;
    }

    const seasons = tvDetails.seasons
        .filter(season => Number.isFinite(season.season_number) && season.season_number > 0)
        .sort((a, b) => a.season_number - b.season_number);

    const episodes = [];
    const episodeByKey = {};
    let flattenedEpisodeNumber = 0;

    for (const season of seasons) {
        const seasonDetail = await getTmdbSeasonDetails(tmdbId, season.season_number);
        if (!seasonDetail || !Array.isArray(seasonDetail.episodes)) {
            continue;
        }

        let seasonLocalEpisodeNumber = 0;
        for (const episode of seasonDetail.episodes) {
            const seasonNumber = seasonDetail.season_number || episode.season_number;
            const tmdbEpisodeNumber = episode.episode_number;
            if (!Number.isFinite(seasonNumber) || !Number.isFinite(tmdbEpisodeNumber)) {
                continue;
            }

            seasonLocalEpisodeNumber += 1;
            flattenedEpisodeNumber += 1;

            const canonicalEpisode = {
                seasonNumber,
                tmdbEpisodeNumber,
                seasonLocalEpisodeNumber,
                flattenedEpisodeNumber,
                title: episode.name || '',
                airDate: episode.air_date || ''
            };

            episodes.push(canonicalEpisode);
            episodeByKey[createEpisodeKey(seasonNumber, tmdbEpisodeNumber)] = canonicalEpisode;
        }
    }

    return {
        episodes,
        episodeByKey
    };
}

async function getCanonicalEpisodeIndex(tmdbId, tvDetails) {
    const cachedIndex = getCachedValue(episodeIndexCache, String(tmdbId));
    if (cachedIndex !== undefined) {
        return cachedIndex;
    }

    const builtIndex = await buildCanonicalEpisodeIndex(tmdbId, tvDetails);
    return setCachedValue(episodeIndexCache, String(tmdbId), builtIndex);
}

function findCanonicalEpisode(index, seasonNumber, tmdbEpisodeNumber) {
    if (!index || !index.episodeByKey) {
        return null;
    }

    return index.episodeByKey[createEpisodeKey(seasonNumber, tmdbEpisodeNumber)] || null;
}

function buildSeriesResolutionCandidates(canonicalEpisode) {
    if (!canonicalEpisode) {
        return [];
    }

    const candidates = [];
    const seenKeys = new Set();

    function addCandidate(strategy, seasonNumber, episodeNumber) {
        if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
            return;
        }

        const key = createEpisodeKey(seasonNumber, episodeNumber);
        if (seenKeys.has(key)) {
            return;
        }

        seenKeys.add(key);
        candidates.push({
            strategy,
            season: seasonNumber,
            episode: episodeNumber
        });
    }

    addCandidate('exact_tmdb', canonicalEpisode.seasonNumber, canonicalEpisode.tmdbEpisodeNumber);
    addCandidate('season_local', canonicalEpisode.seasonNumber, canonicalEpisode.seasonLocalEpisodeNumber);
    addCandidate('flattened_to_season_1', 1, canonicalEpisode.flattenedEpisodeNumber);

    return candidates;
}

async function resolveSeriesCandidate(sourceResult, tmdbId, candidate) {
    const downloadCandidates = [];
    let seriesDownloadData = null;
    let purstreamData = null;

    if (sourceResult && sourceResult.id) {
        seriesDownloadData = await getSeriesDownloadLinks(sourceResult.id, candidate.season, candidate.episode);
        if (seriesDownloadData) {
            downloadCandidates.push(seriesDownloadData);
        }
    }

    if (!seriesDownloadData || !hasPlayableHlsSource(seriesDownloadData)) {
        purstreamData = await getSeriesPurstreamLinks(tmdbId, candidate.season, candidate.episode);
        if (purstreamData) {
            downloadCandidates.push(purstreamData);
        }
    }

    return {
        candidate,
        url: await selectBestSourceUrl(downloadCandidates),
        hasSeriesDownload: Boolean(seriesDownloadData),
        hasPurstream: Boolean(purstreamData)
    };
}

function parseMediaUrl(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    let normalizedInput = input.trim();

    const embeddedMatch = normalizedInput.match(/(https:\/\/movix\.rodeo\/player\/movie\/\d+|https:\/\/movix\.rodeo\/player\/tv\/\d+\/\d+\/\d+|https:\/\/movix\.rodeo\/player\/tv\/\d+|movie\/\d+|tv\/\d+\/\d+\/\d+|tv\/\d+|media:\/\/stream\/movie\/\d+|media:\/\/stream\/tv\/\d+\/season\/\d+\/episode\/\d+|media:\/\/stream\/tv\/\d+|media:\/\/stream\/\d+\/season\/\d+\/episode\/\d+|media:\/\/stream\/\d+(?:\?[^"'<>\\s]+)?)/);
    if (embeddedMatch) {
        normalizedInput = embeddedMatch[1];
    }

    const absoluteEpisodeMatch = normalizedInput.match(/^https:\/\/movix\.rodeo\/player\/(movie|tv)\/(\d+)\/(\d+)\/(\d+)$/);
    if (absoluteEpisodeMatch) {
        return {
            tmdbId: absoluteEpisodeMatch[2],
            mediaType: absoluteEpisodeMatch[1],
            mediaTypeExplicit: true,
            season: Number(absoluteEpisodeMatch[3]),
            episode: Number(absoluteEpisodeMatch[4])
        };
    }

    const absoluteMatch = normalizedInput.match(/^https:\/\/movix\.rodeo\/player\/(movie|tv)\/(\d+)$/);
    if (absoluteMatch) {
        return {
            tmdbId: absoluteMatch[2],
            mediaType: absoluteMatch[1],
            mediaTypeExplicit: true,
            season: undefined,
            episode: undefined
        };
    }

    const relativeEpisodeMatch = normalizedInput.match(/^(movie|tv)\/(\d+)\/(\d+)\/(\d+)$/);
    if (relativeEpisodeMatch) {
        return {
            tmdbId: relativeEpisodeMatch[2],
            mediaType: relativeEpisodeMatch[1],
            mediaTypeExplicit: true,
            season: Number(relativeEpisodeMatch[3]),
            episode: Number(relativeEpisodeMatch[4])
        };
    }

    const relativeMatch = normalizedInput.match(/^(movie|tv)\/(\d+)$/);
    if (relativeMatch) {
        return {
            tmdbId: relativeMatch[2],
            mediaType: relativeMatch[1],
            mediaTypeExplicit: true,
            season: undefined,
            episode: undefined
        };
    }

    const typedEpisodeMatch = normalizedInput.match(/media:\/\/stream\/(movie|tv)\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
    if (typedEpisodeMatch) {
        return {
            tmdbId: typedEpisodeMatch[2],
            mediaType: typedEpisodeMatch[1],
            mediaTypeExplicit: true,
            season: Number(typedEpisodeMatch[3]),
            episode: Number(typedEpisodeMatch[4])
        };
    }

    const legacyEpisodeMatch = normalizedInput.match(/media:\/\/stream\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
    if (legacyEpisodeMatch) {
        return {
            tmdbId: legacyEpisodeMatch[1],
            mediaType: 'tv',
            mediaTypeExplicit: true,
            season: Number(legacyEpisodeMatch[2]),
            episode: Number(legacyEpisodeMatch[3])
        };
    }

    const typedMatch = normalizedInput.match(/media:\/\/stream\/(movie|tv)\/(\d+)/);
    const legacyMatch = normalizedInput.match(/media:\/\/stream\/(\d+)/);
    if (!typedMatch && !legacyMatch) {
        return null;
    }

    const tmdbId = typedMatch ? typedMatch[2] : legacyMatch[1];
    let mediaType = typedMatch ? typedMatch[1] : 'movie';
    let season;
    let episode;

    const queryIndex = normalizedInput.indexOf('?');
    if (queryIndex !== -1) {
        const queryString = normalizedInput.substring(queryIndex + 1);
        const params = new URLSearchParams(queryString);
        const typeParam = params.get('mediaType') || params.get('type');
        if (typeParam) {
            mediaType = normalizeMediaType(typeParam);
        }

        season = params.has('season') ? Number(params.get('season')) : undefined;
        episode = params.has('episode') ? Number(params.get('episode')) : undefined;
    }

    return {
        tmdbId,
        mediaType,
        mediaTypeExplicit: Boolean(typedMatch),
        season: Number.isFinite(season) ? season : undefined,
        episode: Number.isFinite(episode) ? episode : undefined
    };
}

function formatMediaHref(tmdbId, mediaType) {
    return `${normalizeMediaType(mediaType)}/${tmdbId}`;
}

function formatSearchHref(tmdbId, mediaType) {
    return `${PLAYER_BASE}/${normalizeMediaType(mediaType)}/${tmdbId}`;
}

function formatShowHref(tmdbId) {
    return `${PLAYER_BASE}/tv/${tmdbId}/1/1`;
}

function formatEpisodeHref(tmdbId, season, episode) {
    return `tv/${tmdbId}/${season}/${episode}`;
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
                    href: formatSearchHref(movie.id, 'movie')
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
                    href: formatShowHref(tvShow.id)
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

        const resolved = await resolveTmdbDetails(parsed.tmdbId, parsed.mediaType);
        if (!resolved || !resolved.details) {
            return JSON.stringify([]);
        }

        const details = resolved.details;
        const mediaType = resolved.mediaType;

        return JSON.stringify([{
            description: details.overview || details.description || 'No description available',
            aliases: details.original_title || details.original_name || details.name || details.title || 'Unknown',
            airdate: mediaType === 'tv'
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
        if (!parsed) {
            return JSON.stringify([]);
        }

        if (parsed.mediaTypeExplicit && parsed.mediaType === 'movie') {
            return JSON.stringify([{
                href: formatMediaHref(parsed.tmdbId, 'movie'),
                number: 1,
                title: 'Full Movie'
            }]);
        }

        const resolved = await resolveTmdbDetails(parsed.tmdbId, parsed.mediaType);
        if (!resolved) {
            return JSON.stringify([]);
        }

        if (resolved.mediaType !== 'tv') {
            return JSON.stringify([{
                href: formatMediaHref(parsed.tmdbId, 'movie'),
                number: 1,
                title: 'Full Movie'
            }]);
        }

        const tvDetails = resolved.details;
        if (!tvDetails || !Array.isArray(tvDetails.seasons)) {
            return JSON.stringify([]);
        }

        const episodeIndex = await getCanonicalEpisodeIndex(parsed.tmdbId, tvDetails);
        if (!episodeIndex || !Array.isArray(episodeIndex.episodes)) {
            return JSON.stringify([]);
        }

        const episodes = episodeIndex.episodes.map(episode => ({
            href: formatEpisodeHref(parsed.tmdbId, episode.seasonNumber, episode.tmdbEpisodeNumber),
            number: episode.tmdbEpisodeNumber,
            title: episode.title || ''
        }));

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

        const resolved = await resolveTmdbDetails(parsed.tmdbId, parsed.mediaType);
        if (!resolved || !resolved.details) {
            return null;
        }

        const mediaDetails = resolved.details;
        const mediaType = resolved.mediaType;

        if (mediaType === 'tv') {
            if (!parsed.season || !parsed.episode) {
                return null;
            }

            const episodeIndex = await getCanonicalEpisodeIndex(parsed.tmdbId, mediaDetails);
            const canonicalEpisode = findCanonicalEpisode(episodeIndex, parsed.season, parsed.episode);
            if (!canonicalEpisode) {
                logSeriesResolution('canonical_episode_not_found', {
                    tmdbId: parsed.tmdbId,
                    requestedSeason: parsed.season,
                    requestedEpisode: parsed.episode
                });
                return null;
            }

            const candidates = buildSeriesResolutionCandidates(canonicalEpisode);
            const sourceResult = await findSourceResult(mediaDetails, mediaType);

            logSeriesResolution('canonical_episode_resolved', {
                tmdbId: parsed.tmdbId,
                canonicalEpisode,
                candidates
            });

            const [exactCandidate, ...alternativeCandidates] = candidates;
            if (!exactCandidate) {
                return null;
            }

            const exactResolution = await resolveSeriesCandidate(sourceResult, parsed.tmdbId, exactCandidate);
            logSeriesResolution('candidate_tested', {
                tmdbId: parsed.tmdbId,
                candidate: exactResolution.candidate,
                resolved: Boolean(exactResolution.url),
                hasSeriesDownload: exactResolution.hasSeriesDownload,
                hasPurstream: exactResolution.hasPurstream
            });

            if (exactResolution.url) {
                logSeriesResolution('candidate_selected', {
                    tmdbId: parsed.tmdbId,
                    candidate: exactResolution.candidate,
                    reason: 'exact_tmdb_match'
                });
                return exactResolution.url;
            }

            const alternativeResolutions = [];
            for (const candidate of alternativeCandidates) {
                const candidateResolution = await resolveSeriesCandidate(sourceResult, parsed.tmdbId, candidate);
                logSeriesResolution('candidate_tested', {
                    tmdbId: parsed.tmdbId,
                    candidate: candidateResolution.candidate,
                    resolved: Boolean(candidateResolution.url),
                    hasSeriesDownload: candidateResolution.hasSeriesDownload,
                    hasPurstream: candidateResolution.hasPurstream
                });

                if (candidateResolution.url) {
                    alternativeResolutions.push(candidateResolution);
                }
            }

            if (alternativeResolutions.length === 1) {
                logSeriesResolution('candidate_selected', {
                    tmdbId: parsed.tmdbId,
                    candidate: alternativeResolutions[0].candidate,
                    reason: 'single_fallback_match'
                });
                return alternativeResolutions[0].url;
            }

            if (alternativeResolutions.length > 1) {
                logSeriesResolution('resolution_ambiguous', {
                    tmdbId: parsed.tmdbId,
                    canonicalEpisode,
                    matches: alternativeResolutions.map(resolution => resolution.candidate)
                });
                return null;
            }

            logSeriesResolution('no_candidate_resolved', {
                tmdbId: parsed.tmdbId,
                canonicalEpisode,
                candidates
            });
            return null;
        } else {
            const sourceResult = await findSourceResult(mediaDetails, mediaType);
            if (!sourceResult || !sourceResult.id) {
                return null;
            }
            const downloadData = await getDownloadLinks(sourceResult.id);
            if (!downloadData) {
                return null;
            }

            return await selectBestSourceUrl([downloadData]);
        }
    } catch (error) {
        console.log('Extract stream URL error:', error);
        return null;
    }
}
