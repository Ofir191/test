declare module "*.css";

declare module "@/lib/geo.mjs" {
  export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number;
  export function coveringShape(coords: { lat: number; lng: number }[]):
    | { type: "circle"; lat: number; lng: number; radius: number }
    | { type: "polygon"; points: { lat: number; lng: number }[] }
    | null;
}

declare module "@/lib/time.mjs" {
  export function jerusalemDayStart(day: string): string;
  export function jerusalemDayEnd(day: string): string;
}
