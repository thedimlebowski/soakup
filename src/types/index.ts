export interface Pub {
  id: number;
  lat: number;
  lon: number;
  name: string;
  isSunny?: boolean;
  tags?: Record<string, string>;
}

export interface Building {
  id: number;
  lat?: number;
  lon?: number;
  polygon: any; // TurfJS polygon
  height: number;
  bbox?: any;
}
