import SunCalc from 'suncalc';
import * as turf from '@turf/turf';
import type { Pub, Building } from '../types';

export const calculatePubShadows = (
  pubs: Pub[], 
  buildings: Building[], 
  date: Date, 
  cloudCover: number
): Pub[] => {
  // If it's very cloudy, everything is loomy
  if (cloudCover > 70) {
    return pubs.map(p => ({ ...p, isSunny: false }));
  }

  return pubs.map(pub => {
    // Get sun position for the pub
    const sunPos = SunCalc.getPosition(date, pub.lat, pub.lon);
    
    // Altitude is angle above horizon. If < 0, sun is down.
    if (sunPos.altitude < 0) {
      return { ...pub, isSunny: false }; // Night time
    }

    // Azimuth is measured from South to West. 
    // We want the direction *towards* the sun from the pub.
    // Turf's rhumbDestination expects bearing from North, clockwise (-180 to 180).
    // Suncalc azimuth: 0 is South, positive is West.
    // So azimuth = 0 means sun is South. Bearing from North would be 180.
    const bearing = (sunPos.azimuth * 180 / Math.PI) + 180;
    
    const pubPoint = turf.point([pub.lon, pub.lat]);
    
    // Create a ray towards the sun, e.g., 500 meters long
    const rayLengthKm = 0.5; 
    const sunDest = turf.rhumbDestination(pubPoint, rayLengthKm, bearing);
    const sunRay = turf.lineString([pubPoint.geometry.coordinates, sunDest.geometry.coordinates]);

    const rayCoords = sunRay.geometry.coordinates;
    const rayMinX = Math.min(rayCoords[0][0], rayCoords[1][0]);
    const rayMaxX = Math.max(rayCoords[0][0], rayCoords[1][0]);
    const rayMinY = Math.min(rayCoords[0][1], rayCoords[1][1]);
    const rayMaxY = Math.max(rayCoords[0][1], rayCoords[1][1]);

    let isShaded = false;

    // Check intersection with all buildings
    for (const bldg of buildings) {
      // Fast AABB intersection check
      if (bldg.bbox) {
        const [bMinX, bMinY, bMaxX, bMaxY] = bldg.bbox;
        if (rayMaxX < bMinX || rayMinX > bMaxX || rayMaxY < bMinY || rayMinY > bMaxY) {
          continue; // No overlap, skip expensive intersection test
        }
      }

      // Ignore the building if the pub is inside it (pubs shouldn't be shaded by their own roof)
      if (turf.booleanPointInPolygon(pubPoint, bldg.polygon as any)) {
        continue;
      }

      const intersection = turf.lineIntersect(sunRay, bldg.polygon);
      
      if (intersection.features.length > 0) {
        // Find distance to the closest intersection
        let minDist = Infinity;
        for (const pt of intersection.features) {
          const dist = turf.distance(pubPoint, pt, { units: 'meters' });
          if (dist < minDist) minDist = dist;
        }

        // Calculate how high the sun ray is at that distance
        const rayHeightAtBuilding = minDist * Math.tan(sunPos.altitude);

        // If the building is taller than the ray height, it blocks the sun!
        if (bldg.height > rayHeightAtBuilding) {
          isShaded = true;
          break; // Already shaded, no need to check other buildings
        }
      }
    }

    return { ...pub, isSunny: !isShaded };
  });
};
