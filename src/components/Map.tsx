import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MapboxGL, { Marker, NavigationControl, Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import type { LngLatBounds } from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { Pub, Building } from '../types';
import { fetchPubsAndBuildingsForBbox } from '../api/osm';
import { fetchCloudCover } from '../api/weather';
import { calculatePubShadows } from '../utils/shadows';
import { PubMarker } from './PubMarker';
import SunCalc from 'suncalc';
import { loadCacheFromDB, saveCacheToDB } from '../utils/db';
import { Sun, Moon } from 'lucide-react';

// Open source styles from Carto
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const getLocalDateTimeString = (d: Date = new Date()) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
};

export const Map: React.FC = () => {
  // Bounding box grid caching refs to avoid redundant OSM API requests
  const allPubsRef = useRef<globalThis.Map<number, Pub>>(new globalThis.Map());
  const allBuildingsRef = useRef<globalThis.Map<number, Building>>(new globalThis.Map());
  const fetchedCellsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  const [viewState, setViewState] = useState({
    longitude: -0.1278, // London default
    latitude: 51.5074,
    zoom: 16,
    pitch: 60,
    bearing: -20
  });

  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);
  const [pubsCount, setPubsCount] = useState<number>(0);
  const [buildingsCount, setBuildingsCount] = useState<number>(0);
  const [cloudCover, setCloudCover] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [baseDateTime, setBaseDateTime] = useState<string>(() => getLocalDateTimeString());
  const [hourOffset, setHourOffset] = useState<number>(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('soakin_theme');
    return (saved as 'light' | 'dark') || 'dark';
  });
  const [selectedPub, setSelectedPub] = useState<Pub | null>(null);
  const [searchPin, setSearchPin] = useState<{ lat: number, lon: number, name: string } | null>(null);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('soakin_theme', theme);
  }, [theme]);

  const effectiveDate = useMemo(() => {
    const base = new Date(baseDateTime);
    return new Date(base.getTime() + hourOffset * 3600000);
  }, [baseDateTime, hourOffset]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const mapRef = useRef<any>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5&countrycodes=gb`,
        {
          headers: {
            'User-Agent': 'SoakinPubFinder/1.0'
          }
        }
      );
      const data = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setSearching(false);
    }
  };

  const selectResult = (result: any) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    if (!isNaN(lat) && !isNaN(lon)) {
      setViewState(prev => ({
        ...prev,
        latitude: lat,
        longitude: lon,
        zoom: 16
      }));
      setSearchPin({
        lat,
        lon,
        name: result.name || result.display_name.split(',')[0]
      });
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  // Fetch Weather on Mount
  useEffect(() => {
    const getWeather = async () => {
      const cover = await fetchCloudCover(viewState.latitude, viewState.longitude);
      setCloudCover(cover);
    };
    getWeather();
  }, []);

  const GRID_SIZE = 0.005; // ~500m grid tiles

  const fetchDataForBounds = useCallback(async (bounds: LngLatBounds) => {
    const s = bounds.getSouth();
    const w = bounds.getWest();
    const n = bounds.getNorth();
    const e = bounds.getEast();

    const startX = Math.floor(w / GRID_SIZE);
    const endX = Math.floor(e / GRID_SIZE);
    const startY = Math.floor(s / GRID_SIZE);
    const endY = Math.floor(n / GRID_SIZE);

    const cellsInViewport: string[] = [];
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        cellsInViewport.push(`${x},${y}`);
      }
    }

    const missingCells = cellsInViewport.filter(id => !fetchedCellsRef.current.has(id));
    if (missingCells.length === 0) return; // All cached!

    // Calculate bbox enclosing all missing cells
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const cellId of missingCells) {
      const [xStr, yStr] = cellId.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const cellS = y * GRID_SIZE;
      const cellN = (y + 1) * GRID_SIZE;
      const cellW = x * GRID_SIZE;
      const cellE = (x + 1) * GRID_SIZE;
      if (cellS < minLat) minLat = cellS;
      if (cellN > maxLat) maxLat = cellN;
      if (cellW < minLon) minLon = cellW;
      if (cellE > maxLon) maxLon = cellE;
    }

    // Cancel in-flight duplicate requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const pad = 0.002; // Pad slightly to retrieve nearby casting shadows
      const { pubs: newPubs, buildings: newBuildings } = await fetchPubsAndBuildingsForBbox(
        minLat - pad, minLon - pad, maxLat + pad, maxLon + pad,
        controller.signal
      );

      // Cache newly fetched elements
      newPubs.forEach(p => allPubsRef.current.set(p.id, p));
      newBuildings.forEach(b => allBuildingsRef.current.set(b.id, b));
      missingCells.forEach(id => fetchedCellsRef.current.add(id));

      setPubsCount(allPubsRef.current.size);
      setBuildingsCount(allBuildingsRef.current.size);

      // Persist newly fetched elements to IndexedDB
      saveCacheToDB(missingCells, newPubs, newBuildings);
    } catch (error: any) {
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        // Safe to ignore aborted requests
      } else {
        console.error(error);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  // Load IndexedDB cache on mount
  useEffect(() => {
    const loadCache = async () => {
      const cache = await loadCacheFromDB();
      allPubsRef.current = cache.pubs;
      allBuildingsRef.current = cache.buildings;
      fetchedCellsRef.current = cache.cells;
      
      setPubsCount(cache.pubs.size);
      setBuildingsCount(cache.buildings.size);

      // Re-trigger viewport calculations once loaded
      if (mapRef.current) {
        const map = mapRef.current.getMap();
        const bounds = map.getBounds();
        setCurrentBounds(bounds);
        fetchDataForBounds(bounds);
      }
    };
    loadCache();
  }, [fetchDataForBounds]);

  const onMapLoad = useCallback(() => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const bounds = map.getBounds();
      setCurrentBounds(bounds);
      fetchDataForBounds(bounds);
      
      const center = map.getCenter();
      fetchCloudCover(center.lat, center.lng).then(cover => {
        setCloudCover(cover);
      });
    }
  }, [fetchDataForBounds]);

  const onMoveEnd = useCallback(() => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      setCurrentBounds(bounds);
      
      if (zoom > 14) {
        fetchDataForBounds(bounds);
        
        const center = map.getCenter();
        fetchCloudCover(center.lat, center.lng).then(cover => {
          setCloudCover(cover);
        });
      }
    }
  }, [fetchDataForBounds]);

  // Filter raw cached items down to only what is within/near current viewport bounds
  const { visiblePubs, visibleBuildings } = useMemo(() => {
    if (!currentBounds) return { visiblePubs: [], visibleBuildings: [] };
    const pad = 0.002;
    const s = currentBounds.getSouth() - pad;
    const w = currentBounds.getWest() - pad;
    const n = currentBounds.getNorth() + pad;
    const e = currentBounds.getEast() + pad;

    const pubsArr = Array.from(allPubsRef.current.values());
    const bldgsArr = Array.from(allBuildingsRef.current.values());

    const filteredPubs = pubsArr.filter(p => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e);
    const filteredBuildings = bldgsArr.filter(b => {
      const bbox = b.bbox || (b.bbox = turf.bbox(b.polygon));
      const [bW, bS, bE, bN] = bbox;
      return bE >= w && bW <= e && bN >= s && bS <= n;
    });

    return { visiblePubs: filteredPubs, visibleBuildings: filteredBuildings };
  }, [currentBounds, pubsCount, buildingsCount]);

  // Run shadow rendering math only on the subset of visible pubs/buildings
  const processedPubs = useMemo(() => {
    return calculatePubShadows(visiblePubs, visibleBuildings, effectiveDate, cloudCover);
  }, [visiblePubs, visibleBuildings, effectiveDate, cloudCover]);

  const isNight = useMemo(() => {
    const sunPos = SunCalc.getPosition(effectiveDate, viewState.latitude, viewState.longitude);
    return sunPos.altitude < 0;
  }, [effectiveDate, viewState.latitude, viewState.longitude]);

  // Convert fetched buildings to GeoJSON for 3D extrusion rendering
  const buildingGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: visibleBuildings.map(b => ({
        type: 'Feature',
        geometry: b.polygon.geometry,
        properties: {
          height: b.height
        }
      }))
    };
  }, [visibleBuildings]);

  const building3DLayer: LayerProps = {
    id: '3d-buildings',
    type: 'fill-extrusion',
    paint: {
      'fill-extrusion-color': theme === 'light' ? '#cccccc' : '#2a2a2a',
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.8
    }
  };

  return (
    <div className="map-container">
      <div className={`status-overlay ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="drawer-header" onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className="drag-handle">
            <span className="drag-bar"></span>
          </div>
          <div className="header-title-row">
            <h2>SoakUp</h2>
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={(e) => {
                e.stopPropagation(); // Avoid expanding/collapsing the drawer
                setTheme(prev => prev === 'light' ? 'dark' : 'light');
              }}
              aria-label="Toggle theme"
              title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
          <p className="weather-status-text">
            {cloudCover > 70 
              ? '☁️ Cloudy' 
              : isNight 
                ? '🌙 Night' 
                : '☀️ Sunny'}
          </p>
        </div>

        {selectedPub && (
          <div className="selected-pub-card" onClick={e => e.stopPropagation()}>
            <div className="pub-card-header">
              <h3>{selectedPub.name}</h3>
              <button 
                type="button" 
                className="close-pub-card"
                onClick={(e) => {
                  e.stopPropagation(); // Avoid triggering drawer toggle
                  setSelectedPub(null);
                }}
                aria-label="Clear selection"
              >
                ✕
              </button>
            </div>
            <div className="pub-card-status">
              <span className={`status-badge ${selectedPub.isSunny ? 'sunny' : 'shaded'}`}>
                {selectedPub.isSunny ? '☀️ Sunny Now' : isNight ? '🌙 Night' : '☁️ Shaded / Loomy'}
              </span>
            </div>
            <div className="pub-card-details">
              {selectedPub.tags?.outdoor_seating && (
                <p><strong>Outdoor Seating:</strong> {selectedPub.tags.outdoor_seating === 'yes' ? '🍀 Yes' : selectedPub.tags.outdoor_seating}</p>
              )}
              {selectedPub.tags?.opening_hours && (
                <p><strong>Hours:</strong> {selectedPub.tags.opening_hours}</p>
              )}
              {selectedPub.tags?.phone && (
                <p><strong>Phone:</strong> {selectedPub.tags.phone}</p>
              )}
              {selectedPub.tags?.website && (
                <p>
                  <strong>Website:</strong>{' '}
                  <a href={selectedPub.tags.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    {selectedPub.tags.website.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                </p>
              )}
              {selectedPub.tags?.['addr:street'] && (
                <p>
                  <strong>Address:</strong>{' '}
                  {[
                    selectedPub.tags['addr:housenumber'],
                    selectedPub.tags['addr:street'],
                    selectedPub.tags['addr:postcode']
                  ].filter(Boolean).join(', ')}
                </p>
              )}
              {!selectedPub.tags?.outdoor_seating && 
               !selectedPub.tags?.opening_hours && 
               !selectedPub.tags?.website && 
               !selectedPub.tags?.phone && 
               !selectedPub.tags?.['addr:street'] && (
                <p className="no-details">No additional details available on OpenStreetMap.</p>
              )}
            </div>
          </div>
        )}
        
        <form onSubmit={handleSearch} className="search-control">
          <label htmlFor="search-input">Find a Pub:</label>
          <div className="search-input-wrapper">
            <input
              id="search-input"
              type="text"
              placeholder="e.g. Sherlock Holmes, London"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                if (e.target.value === '') setSearchResults([]);
              }}
            />
            <button type="submit" disabled={searching}>
              {searching ? '...' : '🔍'}
            </button>
          </div>
          {searchResults.length > 0 && (
            <ul className="search-results">
              {searchResults.map(res => (
                <li key={res.place_id} onClick={() => selectResult(res)}>
                  <div className="res-name">{res.name || 'Location'}</div>
                  <div className="res-details">{res.display_name}</div>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="datetime-control">
          <div className="datetime-header">
            <label htmlFor="datetime-input">Simulate Date & Time:</label>
            <button 
              type="button" 
              className="now-btn" 
              onClick={() => {
                setBaseDateTime(getLocalDateTimeString());
                setHourOffset(0);
              }}
            >
              Now
            </button>
          </div>
          <input
            id="datetime-input"
            type="datetime-local"
            value={baseDateTime}
            onChange={e => {
              setBaseDateTime(e.target.value);
              setHourOffset(0); // Reset offset when changing date directly
            }}
          />
        </div>

        <div className="slider-control">
          <div className="slider-header">
            <label htmlFor="offset-slider">Time Offset (Sweeper):</label>
            <span className="offset-display">+{hourOffset}h</span>
          </div>
          <input
            id="offset-slider"
            type="range"
            min="0"
            max="12"
            step="0.5"
            value={hourOffset}
            onChange={e => setHourOffset(parseFloat(e.target.value))}
          />
          <div className="effective-time-display">
            {effectiveDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })},{' '}
            {effectiveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <p>Pubs visible: {processedPubs.length}</p>
        <p>Buildings: {visibleBuildings.length}</p>
        {loading && <p className="loading">Updating data...</p>}
      </div>

      <MapboxGL
        {...viewState}
        ref={mapRef}
        onMove={evt => setViewState(evt.viewState)}
        onMoveEnd={onMoveEnd}
        onLoad={onMapLoad}
        mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
        style={{ width: '100vw', height: '100vh' }}
      >
        <NavigationControl position="bottom-right" />
        
        {/* Render 3D Buildings from our fetched OSM data */}
        <Source type="geojson" data={buildingGeoJson as any}>
          <Layer {...building3DLayer} />
        </Source>
        
        {processedPubs.map(pub => (
          <Marker
            key={pub.id}
            longitude={pub.lon}
            latitude={pub.lat}
            anchor="bottom"
          >
            <PubMarker 
              isSunny={pub.isSunny || false} 
              name={pub.name} 
              onClick={() => {
                setSelectedPub(pub);
                setIsCollapsed(false);
              }}
            />
          </Marker>
        ))}

        {searchPin && (
          <Marker
            longitude={searchPin.lon}
            latitude={searchPin.lat}
            anchor="bottom"
          >
            <div 
              className="search-pin-marker" 
              onClick={(e) => {
                e.stopPropagation();
                setSearchPin(null);
              }}
            >
              <svg 
                width="36" 
                height="36" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="#ff4757" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 4px 8px rgba(255, 71, 87, 0.5))' }}
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="rgba(255, 71, 87, 0.2)" />
                <circle cx="12" cy="10" r="3" fill="#ff4757" />
              </svg>
              <div className="search-pin-tooltip">{searchPin.name}</div>
            </div>
          </Marker>
        )}
      </MapboxGL>
    </div>
  );
};
