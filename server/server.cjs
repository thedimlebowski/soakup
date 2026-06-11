const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const GRID_SIZE = 0.005; // 0.005 degrees ~500m grid
const OVERPASS_URL = 'https://overpass.openstreetmap.fr/api/interpreter';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

// Helper to get cache file path for a grid cell
function getCellPath(x, y) {
  return path.join(CACHE_DIR, `cell_${x}_${y}.json`);
}

// Merge separate cell data arrays into deduplicated lists
function mergeCells(cells) {
  const pubsMap = new Map();
  const buildingsMap = new Map();

  for (const cell of cells) {
    if (cell.pubs) {
      for (const pub of cell.pubs) {
        pubsMap.set(pub.id, pub);
      }
    }
    if (cell.buildings) {
      for (const bldg of cell.buildings) {
        buildingsMap.set(bldg.id, bldg);
      }
    }
  }

  return {
    pubs: Array.from(pubsMap.values()),
    buildings: Array.from(buildingsMap.values())
  };
}

app.get('/api/osm', async (req, res) => {
  const s = parseFloat(req.query.s);
  const w = parseFloat(req.query.w);
  const n = parseFloat(req.query.n);
  const e = parseFloat(req.query.e);

  if (isNaN(s) || isNaN(w) || isNaN(n) || isNaN(e)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const startX = Math.floor(w / GRID_SIZE);
  const endX = Math.floor(e / GRID_SIZE);
  const startY = Math.floor(s / GRID_SIZE);
  const endY = Math.floor(n / GRID_SIZE);

  const cells = [];
  const missingCells = [];

  // 1. Identify which cells in the requested bounding box are already cached
  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      const cellPath = getCellPath(x, y);
      if (fs.existsSync(cellPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(cellPath, 'utf8'));
          cells.push(data);
        } catch (err) {
          missingCells.push({ x, y });
        }
      } else {
        missingCells.push({ x, y });
      }
    }
  }

  // If all requested grid cells are cached, respond immediately
  if (missingCells.length === 0) {
    const merged = mergeCells(cells);
    return res.json(merged);
  }

  // 2. Calculate a single bounding box enclosing all missing cells
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const cell of missingCells) {
    const cellS = cell.y * GRID_SIZE;
    const cellN = (cell.y + 1) * GRID_SIZE;
    const cellW = cell.x * GRID_SIZE;
    const cellE = (cell.x + 1) * GRID_SIZE;
    if (cellS < minLat) minLat = cellS;
    if (cellN > maxLat) maxLat = cellN;
    if (cellW < minLon) minLon = cellW;
    if (cellE > maxLon) maxLon = cellE;
  }

  // 3. Query OSM Overpass for the missing cells bbox (with padding for shadow casting)
  try {
    const pad = 0.002;
    const queryBbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;
    const query = `
      [out:json][timeout:25];
      (
        nwr["amenity"="pub"](${queryBbox});
        way["building"](${queryBbox});
        relation["building"](${queryBbox});
      );
      out body;
      >;
      out skel qt;
    `;

    console.log(`[Cache Miss] Querying Overpass API for bbox: ${queryBbox}`);
    const response = await axios.post(
      OVERPASS_URL,
      `data=${encodeURIComponent(query)}`,
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SoakUpPubFinder/1.0'
        },
        timeout: 30000
      }
    );

    const elements = response.data.elements || [];
    const nodesMap = new Map();
    for (const el of elements) {
      if (el.type === 'node') {
        nodesMap.set(el.id, { lat: el.lat, lon: el.lon });
      }
    }

    const fetchedPubs = [];
    const fetchedBuildings = [];

    // Parse elements
    for (const el of elements) {
      if (el.tags && el.tags.amenity === 'pub') {
        let lat = el.lat;
        let lon = el.lon;

        if (el.type === 'way' && el.nodes && el.nodes.length > 0) {
          let sumLat = 0, sumLon = 0, count = 0;
          for (const nodeId of el.nodes) {
            const node = nodesMap.get(nodeId);
            if (node) {
              sumLat += node.lat;
              sumLon += node.lon;
              count++;
            }
          }
          if (count > 0) {
            lat = sumLat / count;
            lon = sumLon / count;
          }
        }

        if (lat !== undefined && lon !== undefined) {
          fetchedPubs.push({
            id: el.id,
            lat,
            lon,
            name: el.tags.name || 'Unknown Pub',
            tags: el.tags
          });
        }
      }

      if (el.tags && el.tags.building && el.type === 'way' && el.nodes) {
        const coordinates = [];
        for (const nodeId of el.nodes) {
          const node = nodesMap.get(nodeId);
          if (node) {
            coordinates.push([node.lon, node.lat]);
          }
        }

        if (coordinates.length > 2) {
          if (coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
              coordinates[0][1] !== coordinates[coordinates.length - 1][1]) {
            coordinates.push([...coordinates[0]]);
          }

          let height = 8;
          if (el.tags.height) {
            const h = parseFloat(el.tags.height);
            if (!isNaN(h)) height = h;
          } else if (el.tags['building:levels']) {
            const levels = parseFloat(el.tags['building:levels']);
            if (!isNaN(levels)) height = levels * 3.5;
          }

          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const coord of coordinates) {
            if (coord[0] < minX) minX = coord[0];
            if (coord[0] > maxX) maxX = coord[0];
            if (coord[1] < minY) minY = coord[1];
            if (coord[1] > maxY) maxY = coord[1];
          }

          fetchedBuildings.push({
            id: el.id,
            lat: (minY + maxY) / 2,
            lon: (minX + maxX) / 2,
            polygon: {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [coordinates]
              },
              properties: {}
            },
            height,
            bbox: [minX, minY, maxX, maxY]
          });
        }
      }
    }

    // Initialize map for distributing results to missing cells
    const cellDataMap = {};
    for (const cell of missingCells) {
      cellDataMap[`${cell.x},${cell.y}`] = { pubs: [], buildings: [] };
    }

    // Distribute fetched pubs to their respective cells
    for (const pub of fetchedPubs) {
      const px = Math.floor(pub.lon / GRID_SIZE);
      const py = Math.floor(pub.lat / GRID_SIZE);
      const key = `${px},${py}`;
      if (cellDataMap[key]) {
        cellDataMap[key].pubs.push(pub);
      }
    }

    // Distribute fetched buildings to their respective cells
    for (const bldg of fetchedBuildings) {
      const bx = Math.floor(((bldg.bbox[0] + bldg.bbox[2]) / 2) / GRID_SIZE);
      const by = Math.floor(((bldg.bbox[1] + bldg.bbox[3]) / 2) / GRID_SIZE);
      const key = `${bx},${by}`;
      if (cellDataMap[key]) {
        cellDataMap[key].buildings.push(bldg);
      }
    }

    // Write newly fetched data to flat JSON cache files and append to cells array
    for (const cell of missingCells) {
      const key = `${cell.x},${cell.y}`;
      const data = cellDataMap[key];
      const cellPath = getCellPath(cell.x, cell.y);
      fs.writeFileSync(cellPath, JSON.stringify(data, null, 2), 'utf8');
      cells.push(data);
    }

    // Merge and return the complete response
    const merged = mergeCells(cells);
    res.json(merged);
  } catch (error) {
    console.error('Overpass proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch OSM data from Overpass', details: error.message });
  }
});

app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const kind = req.query.kind;

  if (isNaN(lat) || isNaN(lon) || (kind !== 'cloud' && kind !== 'detailed')) {
    return res.status(400).json({ error: 'Invalid weather request' });
  }

  const params = kind === 'cloud'
    ? {
        latitude: lat,
        longitude: lon,
        hourly: 'cloud_cover',
        forecast_days: 14,
        past_days: 1,
        timezone: 'UTC'
      }
    : {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,cloud_cover',
        hourly: 'temperature_2m,weather_code',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset',
        timezone: 'auto'
      };

  try {
    const response = await axios.get(WEATHER_URL, {
      params,
      timeout: 15000,
      headers: {
        'User-Agent': 'SoakUpPubFinder/1.0'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Weather proxy error:', error.message);
    res.status(502).json({ error: 'Failed to fetch weather data', details: error.message });
  }
});

// Serve static assets in production
const DIST_DIR = path.join(__dirname, '../dist');
app.use(express.static(DIST_DIR));
app.get('*splat', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Caching proxy server running on http://localhost:${PORT}`);
});
