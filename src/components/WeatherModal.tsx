import React, { useEffect, useState } from 'react';
import { X, Wind, Cloud as CloudIcon } from 'lucide-react';
import { fetchDetailedWeather } from '../api/weather';
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

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchDetailedWeather(lat, lon).then(data => {
        setWeather(data);
        setLoading(false);
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
                      <span className="temp-min">{Math.round(day.tempMin)}°</span>
                      <span className="temp-max">{Math.round(day.tempMax)}°</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px' }}>Failed to load weather data.</div>
        )}
      </div>
    </div>
  );
};
