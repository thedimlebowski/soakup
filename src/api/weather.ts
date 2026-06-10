import axios from 'axios';

const WEATHER_CACHE_KEY = 'soakin_weather_cache';

// Using Open-Meteo as it requires no API key for basic usage
export const fetchCloudCover = async (lat: number, lon: number): Promise<number> => {
  // Round coordinates to 0.05 degrees (~5km accuracy) to cache regionally
  const rLat = Math.round(lat * 20) / 20;
  const rLon = Math.round(lon * 20) / 20;
  const cacheKey = `${rLat},${rLon}`;

  try {
    const cacheStr = localStorage.getItem(WEATHER_CACHE_KEY);
    const cache = cacheStr ? JSON.parse(cacheStr) : {};
    const cachedItem = cache[cacheKey];

    // If cached and less than 1 hour old (3600000 ms), return cached value
    if (cachedItem && Date.now() - cachedItem.timestamp < 3600000) {
      return cachedItem.cloudCover;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=cloud_cover`;
    const response = await axios.get(url);
    const cloudCover = response.data.current.cloud_cover;

    // Save to cache
    cache[cacheKey] = {
      cloudCover,
      timestamp: Date.now()
    };

    // Clean up old cache entries older than 24 hours to prevent memory creep
    const now = Date.now();
    Object.keys(cache).forEach(k => {
      if (now - cache[k].timestamp > 86400000) {
        delete cache[k];
      }
    });

    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
    return cloudCover;
  } catch (error) {
    console.error("Error fetching weather:", error);
    return 0; // Default to sunny if weather fails
  }
};
