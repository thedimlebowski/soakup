import SunCalc from 'suncalc';
import * as turf from '@turf/turf';
import type { Pub, Building } from '../types';

const checkIsShadedAtTime = (
  pub: Pub,
  buildings: Building[],
  date: Date
): boolean => {
  const sunPos = SunCalc.getPosition(date, pub.lat, pub.lon);
  
  if (sunPos.altitude < 0) {
    return true; // Night time
  }

  const bearing = (sunPos.azimuth * 180 / Math.PI) + 180;
  const pubPoint = turf.point([pub.lon, pub.lat]);
  
  const rayLengthKm = 0.5; 
  const sunDest = turf.rhumbDestination(pubPoint, rayLengthKm, bearing);
  const sunRay = turf.lineString([pubPoint.geometry.coordinates, sunDest.geometry.coordinates]);

  const rayCoords = sunRay.geometry.coordinates;
  const rayMinX = Math.min(rayCoords[0][0], rayCoords[1][0]);
  const rayMaxX = Math.max(rayCoords[0][0], rayCoords[1][0]);
  const rayMinY = Math.min(rayCoords[0][1], rayCoords[1][1]);
  const rayMaxY = Math.max(rayCoords[0][1], rayCoords[1][1]);

  for (const bldg of buildings) {
    if (bldg.bbox) {
      const [bMinX, bMinY, bMaxX, bMaxY] = bldg.bbox;
      if (rayMaxX < bMinX || rayMinX > bMaxX || rayMaxY < bMinY || rayMinY > bMaxY) {
        continue; 
      }
    }

    if (turf.booleanPointInPolygon(pubPoint, bldg.polygon as any)) {
      continue;
    }

    const intersection = turf.lineIntersect(sunRay, bldg.polygon);
    
    if (intersection.features.length > 0) {
      let minDist = Infinity;
      for (const pt of intersection.features) {
        const dist = turf.distance(pubPoint, pt, { units: 'meters' });
        if (dist < minDist) minDist = dist;
      }

      const rayHeightAtBuilding = minDist * Math.tan(sunPos.altitude);

      if (bldg.height > rayHeightAtBuilding) {
        return true; 
      }
    }
  }

  return false;
};

export const calculatePubShadows = (
  pubs: Pub[], 
  buildings: Building[], 
  date: Date, 
  cloudCover: number
): Pub[] => {
  if (cloudCover > 70) {
    return pubs.map(p => ({ ...p, isSunny: false }));
  }

  const timesToCheck = [
    date,
    new Date(date.getTime() + 15 * 60000), // +15m
    new Date(date.getTime() + 30 * 60000), // +30m
    new Date(date.getTime() + 45 * 60000), // +45m
    new Date(date.getTime() + 60 * 60000)  // +60m
  ];

  return pubs.map(pub => {
    let isSunny = true;
    for (const t of timesToCheck) {
      if (checkIsShadedAtTime(pub, buildings, t)) {
        isSunny = false;
        break;
      }
    }
    return { ...pub, isSunny };
  });
};

export const calculateShadowPolygons = (
  buildings: Building[],
  date: Date,
  cloudCover: number
): any => {
  if (cloudCover > 70) {
    return turf.featureCollection([]);
  }

  if (isNaN(date.getTime())) {
    console.error('calculateShadowPolygons: Invalid Date received', date);
    return turf.featureCollection([]);
  }

  const features: any[] = [];

  for (const bldg of buildings) {
    if (!bldg.polygon || !bldg.polygon.geometry) continue;

    const lat = bldg.lat ?? (bldg.bbox ? (bldg.bbox[1] + bldg.bbox[3]) / 2 : 0);
    const lon = bldg.lon ?? (bldg.bbox ? (bldg.bbox[0] + bldg.bbox[2]) / 2 : 0);

    const sunPos = SunCalc.getPosition(date, lat, lon);

    if (isNaN(sunPos.altitude) || sunPos.altitude <= 0) {
      // console.log(`Bldg ${bldg.id} skipped due to altitude: ${sunPos.altitude}`);
      continue; // Night time or error
    }

    const shadowBearing = (sunPos.azimuth * 180 / Math.PI); // azimuth 0 is South, so shadow is North (0)
    
    // distance = height / tan(altitude). Max shadow length 2km
    let distance = (bldg.height / Math.tan(sunPos.altitude)) / 1000;
    if (isNaN(distance) || distance < 0) distance = 0;
    if (distance > 2.0) distance = 2.0;

    try {
      const orig = bldg.polygon;
      const translated = turf.transformTranslate(orig, distance, shadowBearing, { units: 'kilometers' });
      
      const coords: number[][] = [];
      turf.coordEach(orig, (coord) => coords.push(coord));
      turf.coordEach(translated, (coord) => coords.push(coord));

      const points = turf.featureCollection(coords.map(c => turf.point(c)));
      const hull = turf.convex(points);

      if (hull) {
        features.push(hull);
      }
    } catch (e) {
      console.error('Shadow gen error for bldg', bldg.id, e);
    }
  }

  if (buildings.length > 0) {
    const firstBldg = buildings[0];
    const lat = firstBldg.lat ?? (firstBldg.bbox ? (firstBldg.bbox[1] + firstBldg.bbox[3]) / 2 : 0);
    const lon = firstBldg.lon ?? (firstBldg.bbox ? (firstBldg.bbox[0] + firstBldg.bbox[2]) / 2 : 0);
    const testPos = SunCalc.getPosition(date, lat, lon);
    console.log(`calculateShadowPolygons debug: Date=${date.toISOString()} (${typeof date}), lat=${lat}, lon=${lon}. SunCalc pos:`, testPos);
    console.log(`calculateShadowPolygons: received ${buildings.length} buildings, generated ${features.length} shadows. Sun altitude at first bldg: ${testPos.altitude}`);
  } else {
    console.log(`calculateShadowPolygons: received 0 buildings, generated 0 shadows.`);
  }

  return turf.featureCollection(features);
};
