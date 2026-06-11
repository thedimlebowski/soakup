import React, { useEffect, useState } from 'react';
import { X, Wind, Cloud as CloudIcon, MapPin } from 'lucide-react';
import { fetchDetailedWeather, WEATHER_LOAD_ERROR_MESSAGE } from '../api/weather';
import type { DetailedWeather } from '../api/weather';
import { getWeatherDescription, getWeatherIcon } from '../utils/weatherCodes';

interface WeatherModalProps {
  isOpen: boolean;
  onClose: () => void;
  lat: number;
  lon: number;
}

export const WeatherModal: React.FC<WeatherModalProps> = ({ isOpen, onClose, lat, lon }) => {
  const [weather, setWeather] = useState<DetailedWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationName, setLocationName] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setWeather(null);
      setErrorMessage(null);
      setLocationName('');

      fetchDetailedWeather(lat, lon).then(data => {
        setWeather(data);
        setErrorMessage(data ? null : WEATHER_LOAD_ERROR_MESSAGE);
        setLoading(false);
      });

      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
        headers: { 'User-Agent': 'SoakinPubFinder/1.0' }
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.address) {
             const city = data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.county || 'Unknown Location';
             setLocationName(city);
          } else {
             if (Math.abs(lat - 51.5074) < 0.1 && Math.abs(lon - (-0.1278)) < 0.1) {
                setLocationName('London');
             } else {
                setLocationName('Unknown Location');
             }
          }
        })
        .catch(err => {
          console.error("Reverse geocoding failed", err);
          if (Math.abs(lat - 51.5074) < 0.1 && Math.abs(lon - (-0.1278)) < 0.1) {
             setLocationName('London');
          } else {
             setLocationName('Unknown Location');
          }
        });
    }
  }, [isOpen, lat, lon]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getDayName = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Today';
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  };

  return (
    <div className="weather-modal-overlay" onClick={handleBackdropClick}>
      <div className="weather-modal-content">
        <button className="weather-modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>Loading forecast...</div>
        ) : weather ? (
          <>
            <div className="weather-hero">
              <div className="weather-location" style={{ fontSize: '1.1rem', marginBottom: '8px', opacity: 0.9, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                {locationName ? (
                  <>
                    <MapPin size={16} />
                    {locationName}
                  </>
                ) : 'Loading location...'}
              </div>
              <h2>{Math.round(weather.current.temp)}°</h2>
              <div className="weather-hero-desc">
                {React.createElement(getWeatherIcon(weather.current.weatherCode), { size: 24, className: "weather-desc-icon" })}
                <span>{getWeatherDescription(weather.current.weatherCode)}</span>
              </div>
            </div>

            <div className="weather-stats">
              <div className="weather-stat-item">
                <Wind size={20} className="weather-stat-icon" />
                <span className="weather-stat-value">{weather.current.windSpeed} km/h</span>
                <span className="weather-stat-label">Wind</span>
              </div>
              <div className="weather-stat-item">
                <CloudIcon size={20} className="weather-stat-icon" />
                <span className="weather-stat-value">{weather.current.cloudCover}%</span>
                <span className="weather-stat-label">Clouds</span>
              </div>
              <div className="weather-stat-item">
                <span className="weather-stat-value">{Math.round(weather.current.apparentTemp)}°</span>
                <span className="weather-stat-label">Feels like</span>
              </div>
            </div>

            <div className="weather-section-title">Hourly Forecast</div>
            <div className="hourly-forecast">
              {weather.hourly.map((hour, idx) => {
                const Icon = getWeatherIcon(hour.weatherCode);
                return (
                  <div key={idx} className="hourly-item">
                    <span className="hourly-time">{idx === 0 ? 'Now' : formatTime(hour.time)}</span>
                    <Icon size={24} />
                    <span className="hourly-temp">{Math.round(hour.temp)}°</span>
                  </div>
                );
              })}
            </div>

            <div className="weather-section-title">7-Day Forecast</div>
            <div className="daily-forecast">
              {weather.daily.map((day, idx) => {
                const Icon = getWeatherIcon(day.weatherCode);
                return (
                  <div key={idx} className="daily-item">
                    <span className="daily-day">{getDayName(day.time)}</span>
                    <div className="daily-icon">
                      <Icon size={20} />
                    </div>
                    <div className="daily-temps">
                      <span className="temp-max">{Math.round(day.tempMax)}°</span>
                      <span className="temp-min">{Math.round(day.tempMin)}°</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            {errorMessage ?? WEATHER_LOAD_ERROR_MESSAGE}
          </div>
        )}
      </div>
    </div>
  );
};
