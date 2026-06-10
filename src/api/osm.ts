import axios from 'axios';
import type { Pub, Building } from '../types';
import type { LngLatBounds } from 'maplibre-gl';

export const fetchPubsAndBuildings = async (
  bounds: LngLatBounds
): Promise<{ pubs: Pub[], buildings: Building[] }> => {
  // Pad bounds slightly to get buildings just outside view that might cast shadows
  const pad = 0.005;
  const s = bounds.getSouth() - pad;
  const w = bounds.getWest() - pad;
  const n = bounds.getNorth() + pad;
  const e = bounds.getEast() + pad;
  return fetchPubsAndBuildingsForBbox(s, w, n, e);
};

export const fetchPubsAndBuildingsForBbox = async (
  s: number, w: number, n: number, e: number,
  signal?: AbortSignal
): Promise<{ pubs: Pub[], buildings: Building[] }> => {
  try {
    const response = await axios.get('/api/osm', {
      params: { s, w, n, e },
      signal
    });
    return response.data;
  } catch (error: any) {
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      throw error;
    } else {
      console.error("Error fetching OSM data from caching proxy:", error);
    }
    return { pubs: [], buildings: [] };
  }
};
