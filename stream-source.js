// Sora streaming module
// Converts TMDB IDs to HLS streams using a backend aggregator API

const TMDB_API_KEY = "f3d757824f08ea2cff45eb8f47ca3a1e";
const TMDB_BASE = "https://api.themoviedb.org/3";
const SOURCE_API_BASE = "https://api.movix.blog";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Referer": "https://movix.rodeo/",
    "Origin": "https://movix.rodeo",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Connection": "keep-alive",
    "TE": "trailers"
};

async function getTmdbMovieDetails(tmdbId) {
    const url = `${TMDB_BASE}/movie/${tmdbId}`;
    const params = {
        api_key: TMDB_API_KEY,
        language: "fr-FR"
    };

    const queryString = Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
    const fullUrl = `${url}?${queryString}`;

    try {
        const response = await fetchv2(fullUrl, HEADERS);
        return await response.json();
    } catch (error) {
        console.log(`Error fetching TMDB details for ${tmdbId}:`, error);
        return null;
    }
}

async function searchSourceMovie(title) {
    const url = `${SOURCE_API_BASE}/api/search?title=${encodeURIComponent(title)}`;

    try {
        const response = await fetchv2(url, HEADERS);
        return await response.json();
    } catch (error) {
        console.log(`Error searching for '${title}':`, error);
        return null;
    }
}

async function getDownloadLinks(internalId) {
    const url = `${SOURCE_API_BASE}/api/films/download/${internalId}`;

    try {
        const response = await fetchv2(url, HEADERS);
        return await response.json();
    } catch (error) {
        console.log(`Error fetching download links for ID ${internalId}:`, error);
        return null;
    }
}

function extractHlsSources(downloadData) {
    const sources = [];

    if (downloadData && downloadData.sources) {
        downloadData.sources.forEach(source => {
            if (source.m3u8) {
                sources.push({
                    url: source.m3u8,
                    quality: source.quality || "Unknown",
                    language: source.language || "Unknown",
                    name: source.src ? source.src.split('/').pop() : "Unknown"
                });
            }
        });
    }

    return sources;
}

async function searchResults(keyword) {
    try {
        const searchUrl = `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&language=fr-FR&page=1`;
        const tmdbResponse = await fetchv2(searchUrl, HEADERS);
        const tmdbData = await tmdbResponse.json();

        if (!tmdbData.results || tmdbData.results.length === 0) {
            return JSON.stringify([]);
        }

        const results = [];

        for (const movie of tmdbData.results.slice(0, 10)) {
            try {
                const sourceSearch = await searchSourceMovie(movie.title);
                if (sourceSearch && sourceSearch.results && sourceSearch.results.length > 0) {
                    results.push({
                        title: movie.title,
                        image: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : "",
                        href: `media://${movie.id}`
                    });
                }
            } catch (error) {
                continue;
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
        const tmdbIdMatch = url.match(/media:\/\/(\d+)/);
        if (!tmdbIdMatch) {
            return JSON.stringify([]);
        }

        const tmdbId = tmdbIdMatch[1];
        const movieDetails = await getTmdbMovieDetails(tmdbId);

        if (!movieDetails) {
            return JSON.stringify([]);
        }

        return JSON.stringify([{
            description: movieDetails.overview || "No description available",
            aliases: movieDetails.original_title || movieDetails.title,
            airdate: movieDetails.release_date ? new Date(movieDetails.release_date).getFullYear().toString() : "Unknown"
        }]);
    } catch (error) {
        console.log('Extract details error:', error);
        return JSON.stringify([]);
    }
}

async function extractEpisodes(url) {
    try {
        const tmdbIdMatch = url.match(/media:\/\/(\d+)/);
        if (!tmdbIdMatch) {
            return JSON.stringify([]);
        }

        const tmdbId = tmdbIdMatch[1];
        return JSON.stringify([{
            href: `media://stream/${tmdbId}`,
            number: "1"
        }]);
    } catch (error) {
        console.log('Extract episodes error:', error);
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const tmdbIdMatch = url.match(/media:\/\/stream\/(\d+)/);
        if (!tmdbIdMatch) {
            return null;
        }

        const tmdbId = tmdbIdMatch[1];
        const movieDetails = await getTmdbMovieDetails(tmdbId);
        if (!movieDetails) {
            return null;
        }

        const sourceSearch = await searchSourceMovie(movieDetails.title);
        if (!sourceSearch || !sourceSearch.results || sourceSearch.results.length === 0) {
            return null;
        }

        const internalId = sourceSearch.results[0].id;
        const downloadData = await getDownloadLinks(internalId);
        if (!downloadData) {
            return null;
        }

        const hlsSources = extractHlsSources(downloadData)
            .filter(source => source.url && source.url.trim().length > 0);
        if (hlsSources.length === 0) {
            return null;
        }

        const qualityOrder = { "1080p": 3, "720p": 2, "480p": 1, "360p": 0 };
        hlsSources.sort((a, b) => (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0));

        return hlsSources[0].url;
    } catch (error) {
        console.log('Extract stream URL error:', error);
        return null;
    }
}