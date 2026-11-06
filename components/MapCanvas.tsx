"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  kind: "house" | "call" | "patrol";
  status?: string;
  color: string;
  label: string;
};

export type MapShape =
  | { id: number; confirmed: boolean; type: "circle"; lat: number; lng: number; radius: number }
  | { id: number; confirmed: boolean; type: "polygon"; points: { lat: number; lng: number }[] };

type Props = {
  markers: MapMarker[];
  shapes: MapShape[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onShape?: (id: number) => void;
  layoutKey?: string;
};

export function MapCanvas({ markers, shapes, selectedId, onSelect, onShape, layoutKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const fitted = useRef(false);
  const dataRef = useRef({ markers, shapes, selectedId });
  const selectRef = useRef(onSelect);
  const shapeRef = useRef(onShape);
  const drawRef = useRef<() => void>(() => undefined);
  dataRef.current = { markers, shapes, selectedId };
  selectRef.current = onSelect;
  shapeRef.current = onShape;

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (!alive || !el.current || mapRef.current) return;
      const map = L.map(el.current, { zoomControl: false, attributionControl: true });
      L.control.zoom({ position: "bottomleft" }).addTo(map);
      const attribution = "© Esri, OSM";
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { attribution, maxZoom: 16 },
      ).addTo(map);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 16 },
      ).addTo(map);
      map.setView([32.08, 34.78], 13);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      drawRef.current();
      requestAnimationFrame(() => map.invalidateSize());
    })();
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    drawRef.current = () => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      const snapshot = dataRef.current;
      void import("leaflet").then((L) => {
        if (cancelled || mapRef.current !== map) return;
        layer.clearLayers();
        for (const shape of snapshot.shapes) {
          const style = {
            color: shape.confirmed ? "#3dcaa0" : "#e8a838",
            weight: 2,
            fillColor: shape.confirmed ? "#3dcaa0" : "#e8a838",
            fillOpacity: 0.14,
            dashArray: shape.confirmed ? undefined : "7 7",
          };
          const drawn =
            shape.type === "circle"
              ? L.circle([shape.lat, shape.lng], { ...style, radius: shape.radius })
              : L.polygon(
                  shape.points.map((point) => [point.lat, point.lng] as [number, number]),
                  style,
                );
          drawn.on("click", () => shapeRef.current?.(shape.id));
          drawn.addTo(layer);
        }
        for (const marker of snapshot.markers) {
          const selected = marker.id === snapshot.selectedId;
          const size = marker.kind === "call" ? 22 : marker.kind === "patrol" ? 16 : 12;
          const icon = L.divIcon({
            className: "pin-wrap",
            html: `<span class="pin pin-${marker.kind} pin-${marker.status ?? "none"} ${selected ? "is-selected" : ""}" style="--pin:${escapeHtml(marker.color)}"></span>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
          L.marker([marker.lat, marker.lng], { icon, zIndexOffset: marker.kind === "call" ? 500 : 100 })
            .bindTooltip(marker.label, { direction: "top", offset: [0, -8], opacity: 0.95 })
            .on("click", () => selectRef.current?.(marker.id))
            .addTo(layer);
        }
        if (!fitted.current && snapshot.markers.length) {
          if (snapshot.markers.length === 1) {
            map.setView([snapshot.markers[0].lat, snapshot.markers[0].lng], 15);
          } else {
            map.fitBounds(
              L.latLngBounds(snapshot.markers.map((marker) => [marker.lat, marker.lng] as [number, number])),
              { padding: [40, 40] },
            );
          }
          fitted.current = true;
        }
      });
    };
    drawRef.current();
    return () => {
      cancelled = true;
    };
  }, [markers, shapes, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markers.find((item) => item.id === selectedId);
    if (map && marker) map.panTo([marker.lat, marker.lng], { animate: true });
    // Pan only when the selection changes, not when a patrol's GPS ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    mapRef.current?.invalidateSize();
  }, [layoutKey]);

  return <div ref={el} className="ops-map" />;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
