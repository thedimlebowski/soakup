import axios from 'axios';

const WEATHER_CACHE_KEY = 'soakin_weather_cache';
export const WEATHER_LOAD_ERROR_MESSAGE = "Sorry, we couldn't load live weather data right now. Please try again in a moment.";
export const WEATHER_BEER_BUTTON_ERROR_MESSAGE = "Sorry, we couldn't load live weather data right now. Close this popup and we'll take you to the nearest pub instead.";

const fetchWeatherFromProxy = async (lat: number, lon: number, kind: 'cloud' | 'detailed') => {
  const response = await axios.get('/api/weather', {
    params: { lat, lon, kind }
  });

  return response.data;
};

// Using Open-Meteo as it requires no API key for basic usage
export const fetchCloudCover = async (lat: number, lon: number): Promise<{times: number[], covers: number[]} | null> => {
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

    const weatherData = await fetchWeatherFromProxy(lat, lon, 'cloud');
    const hourly = weatherData.hourly;

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
    console.error("Error fetching live weather data:", error);
    return null;
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

    const data = await fetchWeatherFromProxy(lat, lon, 'detailed');

    const detailedWeather: DetailedWeather = {
      current: {
        temp: data.current.temperature_2m,
        apparentTemp: data.current.apparent_temperature,
        weatherCode: data.current.weather_code,
        windSpeed: data.current.wind_speed_10m,
        cloudCover: data.current.cloud_cover
      },
      hourly: (() => {
        const currentHourStr = data.current.time.substring(0, 13);
        const startIdx = data.hourly.time.findIndex((t: string) => t.substring(0, 13) === currentHourStr);
        const hourlyStartIdx = startIdx >= 0 ? startIdx : 0;
        return data.hourly.time.slice(hourlyStartIdx, hourlyStartIdx + 24).map((time: string, i: number) => ({
          time,
          temp: data.hourly.temperature_2m[hourlyStartIdx + i],
          weatherCode: data.hourly.weather_code[hourlyStartIdx + i]
        }));
      })(),
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
    console.error("Error fetching live detailed weather data:", error);
    return null;
  }
};

export const generateMockCloudCover = (lat: number, lon: number): { times: number[], covers: number[] } => {
  const times: number[] = [];
  const covers: number[] = [];
  const now = Date.now();
  const startTime = now - 24 * 60 * 60 * 1000;
  
  for (let i = 0; i < 15 * 24; i++) {
    const time = startTime + i * 60 * 60 * 1000;
    times.push(time);
    const base = Math.sin(time / (12 * 60 * 60 * 1000)) * 30 + 40;
    const noise = Math.sin(time / (2 * 60 * 60 * 1000) + lat + lon) * 15;
    const cover = Math.max(0, Math.min(100, Math.round(base + noise)));
    covers.push(cover);
  }
  
  return { times, covers };
};

export const generateMockDetailedWeather = (lat: number, lon: number): DetailedWeather => {
  const now = new Date();
  const hour = now.getHours();
  const tempBase = 18 + Math.sin((hour - 6) / 24 * 2 * Math.PI) * 5;
  const temp = Math.round(tempBase + (Math.sin(lat) * 2));
  const apparentTemp = Math.round(temp + 1);
  const cloudCover = Math.max(0, Math.min(100, Math.round(40 + Math.sin(lon) * 20)));
  
  let weatherCode = 0;
  if (cloudCover > 80) {
    weatherCode = 3;
  } else if (cloudCover > 50) {
    weatherCode = 2;
  } else if (cloudCover > 20) {
    weatherCode = 1;
  }

  const hourly: HourlyForecast[] = [];
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  for (let i = 0; i < 24; i++) {
    const hTime = new Date(currentHour.getTime() + i * 60 * 60 * 1000);
    const hHour = hTime.getHours();
    const hTempBase = 18 + Math.sin((hHour - 6) / 24 * 2 * Math.PI) * 5;
    const hTemp = Math.round(hTempBase + (Math.sin(lat) * 2));
    
    const hCloud = Math.max(0, Math.min(100, Math.round(cloudCover + Math.sin(i / 4) * 15)));
    let hCode = 0;
    if (hCloud > 80) hCode = 3;
    else if (hCloud > 50) hCode = 2;
    else if (hCloud > 20) hCode = 1;

    hourly.push({
      time: hTime.toISOString().substring(0, 16),
      temp: hTemp,
      weatherCode: hCode
    });
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const daily: DailyForecast[] = [];
  for (let i = 0; i < 7; i++) {
    const dTime = new Date(startOfToday.getTime() + i * 24 * 60 * 60 * 1000);
    const dDateStr = dTime.toISOString().substring(0, 10);
    const dayVar = Math.sin(i + lat) * 2;
    const maxTemp = Math.round(22 + dayVar);
    const minTemp = Math.round(12 + dayVar);
    
    const sunrise = `${dDateStr}T06:12`;
    const sunset = `${dDateStr}T20:45`;
    
    const dCloud = Math.max(0, Math.min(100, Math.round(cloudCover + Math.sin(i) * 20)));
    let dCode = 0;
    if (dCloud > 80) dCode = 3;
    else if (dCloud > 50) dCode = 2;
    else if (dCloud > 20) dCode = 1;

    daily.push({
      time: dDateStr,
      weatherCode: dCode,
      tempMax: maxTemp,
      tempMin: minTemp,
      sunrise,
      sunset
    });
  }

  return {
    current: {
      temp,
      apparentTemp,
      weatherCode,
      windSpeed: Math.round(12 + Math.sin(lat + lon) * 5),
      cloudCover
    },
    hourly,
    daily
  };
};
