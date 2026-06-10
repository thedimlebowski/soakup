import { 
  Sun, 
  Cloud, 
  CloudRain, 
  CloudSnow, 
  CloudLightning, 
  CloudDrizzle,
  CloudFog
} from 'lucide-react';

export const getWeatherDescription = (code: number): string => {
  switch (code) {
    case 0: return "Clear sky";
    case 1: return "Mainly clear";
    case 2: return "Partly cloudy";
    case 3: return "Overcast";
    case 45: 
    case 48: return "Fog";
    case 51:
    case 53:
    case 55: return "Drizzle";
    case 56:
    case 57: return "Freezing Drizzle";
    case 61:
    case 63:
    case 65: return "Rain";
    case 66:
    case 67: return "Freezing Rain";
    case 71:
    case 73:
    case 75: return "Snow fall";
    case 77: return "Snow grains";
    case 80:
    case 81:
    case 82: return "Rain showers";
    case 85:
    case 86: return "Snow showers";
    case 95: return "Thunderstorm";
    case 96:
    case 99: return "Thunderstorm with hail";
    default: return "Unknown";
  }
};

export const getWeatherIcon = (code: number) => {
  switch (code) {
    case 0: 
    case 1: return Sun;
    case 2:
    case 3: return Cloud;
    case 45:
    case 48: return CloudFog;
    case 51:
    case 53:
    case 55:
    case 56:
    case 57: return CloudDrizzle;
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82: return CloudRain;
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86: return CloudSnow;
    case 95:
    case 96:
    case 99: return CloudLightning;
    default: return Sun;
  }
};
