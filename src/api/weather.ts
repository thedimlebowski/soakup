import axios from 'axios';

const WEATHER_CACHE_KEY = 'soakin_weather_cache';

// Using Open-Meteo as it requires no API key for basic usage
export const fetchCloudCover = async (lat: number, lon: number): Promise<{times: number[], covers: number[]}> => {
  // Round coordinates to 0.05 degrees (~5km accuracy) to cache regionally
  const rLat = Math.round(lat * 20) / 20;
  const rLon = Math.round(lon * 20) / 20;
  const cacheKey = `cloudcover_${rLat}_${rLon}`;

  try {
    const cacheStr = localStorage.getItem(WEATHER_CACHE_KEY);
    const cache = cacheStr ? JSON.parse(cacheStr) : {};
    const cachedItem = cache[cacheKey];

    // If cached and less than 1 hour old (3600000 ms), return cached value
    if (cachedItem && Date.now() - cachedItem.timestamp < 3600000) {
      return cachedItem.data;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover&forecast_days=14&past_days=1&timezone=UTC`;
    const response = await axios.get(url);
    const hourly = response.data.hourly;

    const times = hourly.time.map((t: string) => new Date(t + 'Z').getTime());
    const covers = hourly.cloud_cover;
    const data = { times, covers };

    // Save to cache
    cache[cacheKey] = {
      data,
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
    return data;
  } catch (error) {
    console.error("Error fetching weather:", error);
    return { times: [], covers: [] }; // Default to sunny if weather fails
  }
};

export interface DailyForecast {
  time: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  sunrise: string;
  sunset: string;
}

export interface HourlyForecast {
  time: string;
  temp: number;
  weatherCode: number;
}

export interface DetailedWeather {
  current: {
    temp: number;
    apparentTemp: number;
    weatherCode: number;
    windSpeed: number;
    cloudCover: number;
  };
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

export const fetchDetailedWeather = async (lat: number, lon: number): Promise<DetailedWeather | null> => {
  // Round to 0.05 degrees for caching (~5km)
  const rLat = Math.round(lat * 20) / 20;
  const rLon = Math.round(lon * 20) / 20;
  const cacheKey = `detailed_${rLat}_${rLon}`;

  try {
    const cacheStr = localStorage.getItem(WEATHER_CACHE_KEY);
    const cache = cacheStr ? JSON.parse(cacheStr) : {};
    const cachedItem = cache[cacheKey];

    // If cached and less than 30 mins old, return it
    if (cachedItem && Date.now() - cachedItem.timestamp < 1800000) {
      return cachedItem.data;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,cloud_cover&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto`;
    const response = await axios.get(url);
    const data = response.data;

    const detailedWeather: DetailedWeather = {
      current: {
        temp: data.current.temperature_2m,
        apparentTemp: data.current.apparent_temperature,
        weatherCode: data.current.weather_code,
        windSpeed: data.current.wind_speed_10m,
        cloudCover: data.current.cloud_cover
      },
      hourly: data.hourly.time.slice(0, 24).map((time: string, i: number) => ({
        time,
        temp: data.hourly.temperature_2m[i],
        weatherCode: data.hourly.weather_code[i]
      })),
      daily: data.daily.time.slice(0, 7).map((time: string, i: number) => ({
        time,
        weatherCode: data.daily.weather_code[i],
        tempMax: data.daily.temperature_2m_max[i],
        tempMin: data.daily.temperature_2m_min[i],
        sunrise: data.daily.sunrise[i],
        sunset: data.daily.sunset[i]
      }))
    };

    cache[cacheKey] = {
      data: detailedWeather,
      timestamp: Date.now()
    };

    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
    return detailedWeather;
  } catch (error) {
    console.error("Error fetching detailed weather:", error);
    return null;
  }
};
