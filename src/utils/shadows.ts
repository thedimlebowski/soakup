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
    new Date(date.getTime() - 3600000), // -1h
    new Date(date.getTime() - 1800000), // -30m
    date,                               // 0
    new Date(date.getTime() + 1800000), // +30m
    new Date(date.getTime() + 3600000)  // +1h
  ];

  return pubs.map(pub => {
    let isSunny = false;
    for (const t of timesToCheck) {
      if (!checkIsShadedAtTime(pub, buildings, t)) {
        isSunny = true;
        break;
      }
    }
    return { ...pub, isSunny };
  });
};
