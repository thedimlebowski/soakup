import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import MapboxGL, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import type { LayerProps } from 'react-map-gl/maplibre';
import type { LngLatBounds } from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { Pub, Building } from '../types';
import { fetchPubsAndBuildingsForBbox } from '../api/osm';
import { fetchCloudCover, WEATHER_BEER_BUTTON_ERROR_MESSAGE } from '../api/weather';
import { calculatePubShadows, calculateShadowPolygons } from '../utils/shadows';
import { PubMarker } from './PubMarker';
import SunCalc from 'suncalc';
import { loadCacheFromDB, saveCacheToDB } from '../utils/db';
import { Sun, Moon, Cloud, MapPin, Search, SunMoon, Eye, EyeOff, Clock } from 'lucide-react';
import { WeatherModal } from './WeatherModal';

// Open source styles from Carto
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DEFAULT_VIEW_STATE: {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
} = {
  longitude: -0.1278,
  latitude: 51.5074,
  zoom: 16,
  pitch: 0,
  bearing: 0
};

const HUMOROUS_FALLBACK_MESSAGES = [
  "No sunny pubs found! The sun is in the pint anyway. We're heading to the nearest pub instead.",
  "No sun? Time to consider moving to Spain. We're heading to the nearest pub...",
  "No sunny pubs found! Sun is overrated, UV rays age your skin. We're heading to the nearest pub instead.",
  "No sun found! It's the UK, what did you expect? We're heading to the nearest pub...",
  "Sun's hiding today! Keep calm and carry on drinking in the shadows. We're heading to the nearest pub...",
  "No sunny spot found. The only light today is the neon sign inside. We're heading to the nearest pub...",
  "No sun found. Perfect excuse to avoid human contact in a dark corner. We're heading to the nearest pub...",
  "No sunny tables! The clouds won this round. We're heading to the nearest pub (with beer)...",
  "No sun found! Time to embrace your inner goth. We're heading to the nearest pub...",
  "Zero sunny pubs! The sun has officially retired. We're heading to the nearest pub...",
  "No sunny seats available. Vitamin D is highly overrated anyway. Centering on the nearest pint...",
  "No sun! Let's pretend it's a cozy evening already. Directing you to the nearest available pub..."
];

const getLocalDateTimeString = (d: Date = new Date()) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
};

const getMapAppLink = (pub: Pub) => {
  const ua = navigator.userAgent.toLowerCase();
  const isApple = ua.includes('mac') || ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod');
  if (isApple) {
    return `https://maps.apple.com/?q=${encodeURIComponent(pub.name)}&ll=${pub.lat},${pub.lon}`;
  }
  const isAndroid = ua.includes('android');
  if (isAndroid) {
    return `geo:${pub.lat},${pub.lon}?q=${encodeURIComponent(pub.name)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${pub.lat},${pub.lon}`;
};

export const Map: React.FC = () => {
  // Bounding box grid caching refs to avoid redundant OSM API requests
  const allPubsRef = useRef<globalThis.Map<number, Pub>>(new globalThis.Map());
  const allBuildingsRef = useRef<globalThis.Map<number, Building>>(new globalThis.Map());
  const fetchedCellsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasCenteredOnLoadRef = useRef<boolean>(false);

  const [viewState, setViewState] = useState({
    ...DEFAULT_VIEW_STATE // London default
  });

  const [mapReady, setMapReady] = useState(false);

  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Watch user location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          console.warn("Geolocation watch error:", error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setMapReady(true);
    }
  }, []);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => setMapReady(true), 4000);
    return () => clearTimeout(fallbackTimer);
  }, []);

  // Center on user's location on load
  useEffect(() => {
    if (userLocation && !hasCenteredOnLoadRef.current) {
      hasCenteredOnLoadRef.current = true;
      setViewState(prev => ({
        ...prev,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        zoom: 16
      }));
      setMapReady(true);
    }
  }, [userLocation]);

  const [currentBounds, setCurrentBounds] = useState<LngLatBounds | null>(null);
  const [pubsCount, setPubsCount] = useState<number>(0);
  const [buildingsCount, setBuildingsCount] = useState<number>(0);
  const [cloudCoverData, setCloudCoverData] = useState<{times: number[], covers: number[]} | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
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

  const loadCloudCover = useCallback(async (lat: number, lon: number) => {
    const coverData = await fetchCloudCover(lat, lon);
    if (coverData) {
      setCloudCoverData(coverData);
      setWeatherError(null);
      return;
    }

    setCloudCoverData(null);
    setWeatherError(WEATHER_BEER_BUTTON_ERROR_MESSAGE);
  }, []);

  const cloudCover = useMemo(() => {
    if (!cloudCoverData || cloudCoverData.times.length === 0) return null;
    
    const targetTime = effectiveDate.getTime();
    
    let closestIdx = -1;
    let minDiff = Infinity;
    
    for (let i = 0; i < cloudCoverData.times.length; i++) {
      const diff = Math.abs(cloudCoverData.times[i] - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    
    if (minDiff > 2 * 3600000) {
      return null;
    }
    
    return cloudCoverData.covers[closestIdx] || 0;
  }, [cloudCoverData, effectiveDate]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isWeatherModalOpen, setIsWeatherModalOpen] = useState(false);
  const [isSundialModalOpen, setIsSundialModalOpen] = useState(false);
  const [showShadows, setShowShadows] = useState(true);
  const [messageSeed, setMessageSeed] = useState(0);
  const [isTimeSliderOpen, setIsTimeSliderOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const mapRef = useRef<any>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5`,
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
      if (mapRef.current) {
        mapRef.current.getMap().flyTo({ center: [lon, lat], zoom: 16, duration: 1500 });
      } else {
        setViewState(prev => ({
          ...prev,
          latitude: lat,
          longitude: lon,
          zoom: 16
        }));
      }
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
      await loadCloudCover(DEFAULT_VIEW_STATE.latitude, DEFAULT_VIEW_STATE.longitude);
    };
    getWeather();
  }, [loadCloudCover]);

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
      void loadCloudCover(center.lat, center.lng);
    }
  }, [fetchDataForBounds, loadCloudCover]);

  const onMoveEnd = useCallback(() => {
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      setCurrentBounds(bounds);
      
      const center = map.getCenter();
      void loadCloudCover(center.lat, center.lng);

      if (zoom >= 11.0) {
        fetchDataForBounds(bounds);
      }
    }
  }, [fetchDataForBounds, loadCloudCover]);

  // Filter raw cached items down to only what is within/near current viewport bounds
  const isNight = useMemo(() => {
    if (!currentBounds) return false;
    const centerLat = (currentBounds.getNorth() + currentBounds.getSouth()) / 2;
    const centerLon = (currentBounds.getEast() + currentBounds.getWest()) / 2;
    const pos = SunCalc.getPosition(effectiveDate, centerLat, centerLon);
    return pos.altitude <= 0;
  }, [currentBounds, effectiveDate]);

  const drawerMessage = useMemo(() => {
    const hour = new Date().getHours();
    const isBadWeather = cloudCover !== null && cloudCover > 70;
    
    const dayMessages = [
      "Sun's out, pints out. It's a glorious day for a beer.",
      "The sun is shining, the beer is calling.",
      "Don't waste this sunshine. Get yourself to a beer garden.",
      "Vitamin D is important. So is beer. Get both.",
      "It's daytime! Find a sunny spot and claim it.",
      "A sunny pub is waiting for you somewhere.",
      "Perfect weather for a cold one in the sun.",
      "Day drinking is an art form. You are the artist.",
      "The sun is basically asking you to have a pint.",
      "Follow the light... to the nearest pub.",
      "Sunlight makes the beer taste better. It's science."
    ];

    const badWeatherDayMessages = [
      "Clouds are doing their best. You should too — find a cozy pint.",
      "Not exactly beer-garden weather. Time for a proper pub interior.",
      "Grey skies, great excuse for another round indoors.",
      "It's a bit grim out there. Luckily, pubs have roofs.",
      "Rain vibes only. Chase warmth, not sunshine."
    ];

    const eveningMessages = [
      "The sun has set. Time to switch from day drinking to regular drinking.",
      "Sun's down, pints up. You survived another day.",
      "The only rays you'll catch now are from the pub's neon signs.",
      "If you're still looking for the sun, you might have had one too many.",
      "No more UV rays, just IPAs.",
      "The sun left the chat. Time to hit the stout.",
      "Daylight is overrated anyway. Let the evening session begin.",
      "No sunglasses needed from here on out. Just a strong liver.",
      "The sun went to bed, but clearly you haven't.",
      "Shadows? Everywhere. Beer? Hopefully somewhere near you.",
      "It's dark. You're looking for a sunny pub. Have you considered a flight to Australia?"
    ];

    const lateNightMessages = [
      "It's pitch black out there. The only sun you'll find is on a beer label.",
      "Nothing good happens after 2 AM, except maybe finding an open pub.",
      "Vampire hours are in full effect. Stick to the dimly lit corners.",
      "Searching for sunshine at this hour? Your optimism is terrifying.",
      "The sun is literally on the other side of the planet right now.",
      "Are you lost? It's the middle of the night. Go home and drink water.",
      "Even the moon is judging your pub crawl right now.",
      "You're either having the best night of your life or making a terrible mistake.",
      "Sir, this is a night map. There is no sun.",
      "The only thing shining at this hour is the grease on your late-night kebab.",
      "Stop looking for the sun. Start looking for a taxi."
    ];

    const earlyMorningMessages = [
      "Are you still drinking, or starting really early? Either way, no sun for you yet.",
      "The birds are waking up. The sun isn't. And you are at a pub?",
      "It's the crack of dawn. Go to bed, you absolute legend.",
      "Too late for a nightcap, too early for a brunch mimosa.",
      "The sun is hitting the snooze button. You should too.",
      "You've entered the twilight zone of drinking.",
      "If you find an open pub right now, you might need an intervention.",
      "The only bright light right now is your phone screen staring back at your life choices.",
      "Even the hardcore alcoholics are asleep right now.",
      "Sunrise is coming, but your hangover will arrive much faster.",
      "Please tell me you are just testing this app and not actually pub hunting at 5 AM."
    ];

    if (hour >= 23 || hour <= 3) {
      return lateNightMessages[messageSeed % lateNightMessages.length];
    } else if (hour > 3 && hour <= 5) {
      return earlyMorningMessages[messageSeed % earlyMorningMessages.length];
    } else if (hour > 17) {
      return eveningMessages[messageSeed % eveningMessages.length];
    } else if (isBadWeather) {
      return badWeatherDayMessages[messageSeed % badWeatherDayMessages.length];
    } else {
      return dayMessages[messageSeed % dayMessages.length];
    }
  }, [cloudCover, messageSeed]);

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
    if (cloudCover === null) {
      return visiblePubs;
    }
    return calculatePubShadows(visiblePubs, visibleBuildings, effectiveDate, cloudCover);
  }, [visiblePubs, visibleBuildings, effectiveDate, cloudCover]);

  const sunAzimuthDegrees = useMemo(() => {
    const sunPos = SunCalc.getPosition(effectiveDate, viewState.latitude, viewState.longitude);
    return (sunPos.azimuth * 180) / Math.PI;
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

  const shadowGeoJson = useMemo(() => {
    if (cloudCover === null) {
      return turf.featureCollection([]);
    }
    const geo = calculateShadowPolygons(visibleBuildings, effectiveDate, showShadows ? 0 : 100);
    console.log(`Generated ${geo.features.length} shadow polygons`);
    return geo;
  }, [visibleBuildings, effectiveDate, showShadows, cloudCover]);

  const nightShadeGeoJson = useMemo(() => turf.featureCollection([
    turf.polygon([[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]])
  ]), []);

  const building3DLayer: LayerProps = {
    id: '3d-buildings',
    type: 'fill-extrusion',
    minzoom: 14.5,
    paint: {
      'fill-extrusion-color': theme === 'light' ? '#cccccc' : '#2a2a2a',
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.8
    }
  };

  const locateUser = useCallback(() => {
    if (userLocation) {
      if (mapRef.current) {
        mapRef.current.getMap().flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 17, duration: 1500 });
      } else {
        setViewState(prev => ({
          ...prev,
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          zoom: 17
        }));
      }
    } else {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          setUserLocation(loc);
          if (mapRef.current) {
            mapRef.current.getMap().flyTo({ center: [loc.longitude, loc.latitude], zoom: 17, duration: 1500 });
          } else {
            setViewState(prev => ({
              ...prev,
              latitude: loc.latitude,
              longitude: loc.longitude,
              zoom: 17
            }));
          }
        },
        (error) => {
          alert("Could not access your location. Please check your browser permissions.");
          console.error(error);
        }
      );
    }
  }, [userLocation]);

  const findNearestSunnyPub = useCallback(() => {
    const shouldFallbackToNearestPub = cloudCover === null;

    if (shouldFallbackToNearestPub) {
      alert(weatherError ?? WEATHER_BEER_BUTTON_ERROR_MESSAGE);
    }

    let targetPubs = shouldFallbackToNearestPub
      ? processedPubs
      : processedPubs.filter(p => p.isSunny);
    let isFallback = false;

    if (!shouldFallbackToNearestPub && isNight) {
      const realHour = new Date().getHours();
      if (realHour >= 18 || realHour <= 5) {
        alert(drawerMessage);
        setMessageSeed(prev => prev + 1);
      } else {
        alert("Nice try, Dracula. You simulated night time on the map. You'll have to settle for the moon.");
      }
      return;
    }
    
    const originLat = userLocation?.latitude ?? viewState.latitude;
    const originLon = userLocation?.longitude ?? viewState.longitude;

    if (!shouldFallbackToNearestPub && targetPubs.length === 0) {
      targetPubs = processedPubs;
      isFallback = true;
    }
    
    if (targetPubs.length === 0) {
      alert("No pubs found in the current area! Try panning or search central areas.");
      return;
    }
    
    let nearestPub: Pub | null = null;
    let minDistance = Infinity;
    
    const fromPoint = turf.point([originLon, originLat]);
    
    targetPubs.forEach(pub => {
      const toPoint = turf.point([pub.lon, pub.lat]);
      const dist = turf.distance(fromPoint, toPoint);
      if (dist < minDistance) {
        minDistance = dist;
        nearestPub = pub;
      }
    });
    
    if (nearestPub) {
      if (mapRef.current) {
        mapRef.current.getMap().flyTo({ center: [(nearestPub as Pub).lon, (nearestPub as Pub).lat], zoom: 17, duration: 1500 });
      } else {
        setViewState(prev => ({
          ...prev,
          latitude: (nearestPub as Pub).lat,
          longitude: (nearestPub as Pub).lon,
          zoom: 17
        }));
      }
      setSelectedPub(nearestPub);
      setIsCollapsed(false);
      
      if (isFallback) {
        const randomMsg = HUMOROUS_FALLBACK_MESSAGES[Math.floor(Math.random() * HUMOROUS_FALLBACK_MESSAGES.length)];
        alert(randomMsg);
      }
    }
  }, [cloudCover, processedPubs, userLocation, viewState, isNight, drawerMessage, weatherError]);

  const resetNorth = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.getMap().easeTo({ bearing: 0, pitch: 0 });
    }
  }, []);

  const handlePubClick = useCallback((pub: Pub) => {
    setSelectedPub(pub);
    setIsCollapsed(false);
  }, []);

  const handleMapClick = useCallback(() => {
    if (!isCollapsed) {
      setIsCollapsed(true);
      setMessageSeed(prev => prev + 1);
    }
  }, [isCollapsed]);

  // Removed London distance check to support global usage

  return (
    <div className="map-container">
      {loading && (
        <div className="beer-loading-overlay">
          <div className="beer-spinner">
            <svg 
              width="48" 
              height="48" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.0" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path 
                className="beer-fill-anim"
                d="M5 10v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10Z" 
                fill="var(--beer-gold)" 
                stroke="none"
              />
              <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
              <path d="M9 12v6" />
              <path d="M13 12v6" />
              <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5 1 0 1.44.5 3 .5s2-.5 3-.5" />
              <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
            </svg>
            <p>Pouring pubs...</p>
          </div>
        </div>
      )}
      <div className={`status-overlay ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="drawer-header">
          <div className="header-title-row">
            <h2>SoakUp</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                className="close-drawer-btn" 
                onClick={handleMapClick}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        {selectedPub && (
          <div className="selected-pub-card" onClick={e => e.stopPropagation()}>
            <div className="pub-card-header">
              <h3>{selectedPub.name}</h3>
              <div className="pub-card-actions">
                <a
                  href={getMapAppLink(selectedPub)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="map-app-link"
                  title="Open in Maps App"
                  aria-label="Open in Maps App"
                  onClick={e => e.stopPropagation()}
                >
                  <MapPin size={15} />
                </a>
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
            </div>
            <div className="pub-card-status">
              <span className={`status-badge ${cloudCover === null ? 'unavailable' : selectedPub.isSunny ? 'sunny' : 'shaded'}`}>
                {cloudCover === null ? '⚠️ Weather unavailable' : selectedPub.isSunny ? '☀️ Sunny Now' : isNight ? '🌙 Night' : '☁️ Shaded / Loomy'}
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

        {drawerMessage && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            background: theme === 'light' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(20, 20, 40, 0.4)',
            border: `1px solid ${theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(100, 100, 200, 0.3)'}`,
            borderRadius: '8px',
            color: theme === 'light' ? '#333' : '#a0a0ff',
            fontSize: '13px',
            fontStyle: 'italic',
            textAlign: 'center',
            boxShadow: theme === 'light' ? 'inset 0 0 10px rgba(0,0,0,0.05)' : 'inset 0 0 10px rgba(0,0,0,0.5)'
          }}>
            <p style={{ margin: 0 }}>{drawerMessage}</p>
          </div>
        )}

        {weatherError && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            background: 'rgba(255, 107, 107, 0.12)',
            border: '1px solid rgba(255, 107, 107, 0.35)',
            borderRadius: '8px',
            color: 'var(--text-color)',
            fontSize: '13px',
            lineHeight: 1.4
          }}>
            {weatherError}
          </div>
        )}
        
        {processedPubs.length === 0 && !loading && (
          <div className="no-pubs-tip">
            <p>No pubs found here. Try panning or zoom in.</p>
          </div>
        )}
        {loading && <p className="loading">Updating data...</p>}
      </div>

      <button 
        className="locate-me-btn"
        onClick={(e) => { locateUser(); e.currentTarget.blur(); }}
        title="Show My Location"
        aria-label="Show My Location"
      >
        <svg 
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="1" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="23" y2="12" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>

      <button 
        className="shadows-toggle-btn"
        onClick={() => setShowShadows(!showShadows)}
        title={showShadows ? 'Hide Shadows' : 'Show Shadows'}
        aria-label="Toggle live shadows"
      >
        {showShadows ? <Eye size={24} /> : <EyeOff size={24} opacity={0.6} />}
      </button>

      <div className="search-wrapper">
        <button
          className={`search-btn-floating ${isSearchOpen ? 'active' : ''}`}
          onClick={() => setIsSearchOpen(!isSearchOpen)}
          title="Search"
          aria-label="Search"
        >
          <Search size={24} />
        </button>
      </div>

      {isSearchOpen && (
        <div className="sundial-modal-overlay" onClick={() => setIsSearchOpen(false)}>
          <div className="sundial-modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Find a Location</h3>
              <button 
                className="close-drawer-btn" 
                onClick={() => setIsSearchOpen(false)}
                style={{ padding: '4px', height: 'auto', width: 'auto' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSearch} className="search-control">
              <div className="search-input-wrapper">
                <input
                  id="search-input"
                  type="text"
                  placeholder="e.g. London"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    if (e.target.value === '') setSearchResults([]);
                  }}
                  autoFocus
                />
                <button type="submit" disabled={searching}>
                  {searching ? '...' : <Search size={18} />}
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="search-results" style={{ textAlign: 'left', maxHeight: '300px', overflowY: 'auto' }}>
                  {searchResults.map(res => (
                    <li key={res.place_id} onClick={() => { selectResult(res); setIsSearchOpen(false); }}>
                      <div className="res-name">{res.name || 'Location'}</div>
                      <div className="res-details">{res.display_name}</div>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </div>
        </div>
      )}

      <div className="time-slider-wrapper">
        <button
          className={`time-slider-btn ${isTimeSliderOpen ? 'active' : ''}`}
          onClick={() => setIsTimeSliderOpen(!isTimeSliderOpen)}
          title="Simulate Time"
          aria-label="Simulate Time"
        >
          <Clock size={24} />
        </button>
        {isTimeSliderOpen && (
          <div className="time-slider-popout">
            <div className="datetime-control">
              <div className="datetime-header">
                <label htmlFor="datetime-input">Simulate Date & Time:</label>
                <button 
                  className="now-btn" 
                  onClick={() => {
                    setBaseDateTime(new Date().toISOString().slice(0, 16));
                    setHourOffset(0);
                  }}
                  title="Reset to Now"
                >
                  Reset
                </button>
              </div>
              <input
                id="datetime-input"
                type="datetime-local"
                value={baseDateTime}
                onChange={e => {
                  setBaseDateTime(e.target.value);
                  setHourOffset(0);
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
                max="24"
                step="0.5"
                value={hourOffset}
                onChange={e => setHourOffset(parseFloat(e.target.value))}
              />
              <div className="effective-time-display">
                {effectiveDate.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="theme-toggle-btn-right"
        onClick={(e) => {
          setTheme(prev => prev === 'light' ? 'dark' : 'light');
          e.currentTarget.blur();
        }}
        aria-label="Toggle theme"
        title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
      >
        <SunMoon size={24} />
      </button>

      <button 
        className="reset-north-btn"
        onClick={(e) => { resetNorth(); e.currentTarget.blur(); }}
        title="Reset to North"
        aria-label="Reset to North"
      >
        <svg 
          width="22" 
          height="22" 
          viewBox="0 0 24 24" 
          style={{ transform: `rotate(${-viewState.bearing}deg)`, transition: 'transform 0.3s ease' }}
        >
          <path d="M12 9 L12 22 M9 12 L12 9 L15 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <text x="12" y="6.5" fill="currentColor" fontSize="10" fontWeight="900" textAnchor="middle">N</text>
        </svg>
      </button>

      <button 
        className="nearest-sunny-pub-btn"
        onClick={(e) => { findNearestSunnyPub(); e.currentTarget.blur(); }}
        title="Find Nearest Sunny Pub"
        aria-label="Find Nearest Sunny Pub"
      >
        <svg 
          width="32" 
          height="32" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="var(--beer-gold)" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M5 10v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10Z" fill="var(--beer-gold)" stroke="none" />
          <path d="M17 11h1a3 3 0 0 1 0 6h-1" stroke="currentColor" />
          <path d="M9 12v6" stroke="currentColor" />
          <path d="M13 12v6" stroke="currentColor" />
          <path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5a2.5 2.5 0 0 1 5 0c.81 0 1.5-.5 2.5-.5 1 0 1.44.5 3 .5s2-.5 3-.5" stroke="currentColor" />
          <path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" stroke="currentColor" />
        </svg>
      </button>

      <button 
        className="sun-direction-indicator" 
        title="Weather & Sun Direction" 
        aria-label="Weather & Sun Direction"
        onClick={() => setIsWeatherModalOpen(true)}
      >
        {cloudCover !== null && cloudCover > 70 ? (
          <Cloud size={32} className="weather-icon-cloud" />
        ) : isNight ? (
          <Moon size={32} className="weather-icon-moon" />
        ) : (
          <svg 
            width="40" 
            height="40" 
            viewBox="0 0 100 100" 
            style={{ transform: `rotate(${sunAzimuthDegrees - 45 - viewState.bearing}deg)`, transition: 'transform 0.15s ease-out' }}
          >
            <circle cx="50" cy="50" r="16" fill="none" stroke="currentColor" strokeWidth="6" />

            <g stroke="currentColor" strokeWidth="6" strokeLinecap="round">
              <line x1="50" y1="10" x2="50" y2="24" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(45 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(90 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(135 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(180 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(225 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(270 50 50)" /> 
              <line x1="50" y1="10" x2="50" y2="24" transform="rotate(315 50 50)" /> 
            </g>

            <g transform="rotate(45 50 50)">
              <line x1="50" y1="2" x2="50" y2="18" stroke="var(--beer-gold)" strokeWidth="10" strokeLinecap="round" />
              <polygon points="50,-14 62,4 38,4" fill="var(--beer-gold)" stroke="var(--beer-gold)" strokeWidth="2" strokeLinejoin="round" />
            </g>
          </svg>
        )}
      </button>

      {isSundialModalOpen && (
        <div className="sundial-modal-overlay" onClick={() => setIsSundialModalOpen(false)}>
          <div className="sundial-modal-content" onClick={e => e.stopPropagation()}>
            <h3>The Sundial ☀️</h3>
            <p>This indicator shows the direction the sun's rays are travelling. By following the arrow, you can see exactly where the light will hit and predict where shadows will fall—helping you secure the perfect sun-drenched spot in the pub garden!</p>
            <button className="sundial-modal-close" onClick={() => setIsSundialModalOpen(false)}>Got it</button>
          </div>
        </div>
      )}

      {mapReady && (
      <MapboxGL
        {...viewState}
        ref={mapRef}
        onClick={handleMapClick}
        onMove={evt => setViewState(evt.viewState)}
        onMoveEnd={onMoveEnd}
        onLoad={onMapLoad}
        mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
        style={{ width: '100vw', height: '100vh' }}
        attributionControl={false}
      >
        {/* Render 2D Sun Shadows */}
        {showShadows && (
          <Source id="sun-shadows-source" type="geojson" data={shadowGeoJson as any}>
            <Layer 
              id="sun-shadows-layer" 
              type="fill-extrusion" 
              paint={{
                'fill-extrusion-color': theme === 'light' ? '#000000' : '#000005',
                'fill-extrusion-height': 0,
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': theme === 'light' ? 0.25 : 0.8
              }} 
            />
          </Source>
        )}

        {showShadows && isNight && (
          <Source id="night-shade-source" type="geojson" data={nightShadeGeoJson as any}>
            <Layer
              id="night-shade-layer"
              type="fill"
              paint={{
                'fill-color': '#000000',
                'fill-opacity': theme === 'light' ? 0.25 : 0.45
              }}
            />
          </Source>
        )}

        {/* Render 3D Buildings from our fetched OSM data */}
        <Source id="osm-buildings-source" type="geojson" data={buildingGeoJson as any}>
          <Layer {...building3DLayer} />
        </Source>
        
        {processedPubs.map(pub => {
          const isMini = viewState.zoom < 14.5;
          return (
            <Marker
              key={pub.id}
              longitude={pub.lon}
              latitude={pub.lat}
              anchor={isMini ? "center" : "bottom"}
            >
              <PubMarker 
                pub={pub}
                onClick={handlePubClick}
                isMini={isMini}
              />
            </Marker>
          );
        })}

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

        {userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
            anchor="center"
          >
            <div className="user-location-marker" />
          </Marker>
        )}
      </MapboxGL>
      )}

      <WeatherModal 
        isOpen={isWeatherModalOpen} 
        onClose={() => setIsWeatherModalOpen(false)} 
        lat={viewState.latitude} 
        lon={viewState.longitude} 
      />
    </div>
  );
};
