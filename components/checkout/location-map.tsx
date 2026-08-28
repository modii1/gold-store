"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, LocateFixed, Navigation } from "lucide-react";

type LocationMapProps = {
  lat: number;
  lng: number;
  onPick: (point: { lat: number; lng: number }) => void;
};

/**
 * Clickable + draggable Leaflet map picker for the checkout address.
 * The customer can tap a spot or drag the pin; the parent reverse-geocodes it
 * to a Saudi National Address (سُبل) and fills the fields. Also provides a
 * "my location" button using the browser geolocation API.
 */
export function LocationMap({ lat, lng, onPick }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const initialLat = useRef(lat);
  const initialLng = useRef(lng);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!containerRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const mapInstance = L.map(containerRef.current, { attributionControl: false, zoomControl: false }).setView([initialLat.current, initialLng.current], 15);
      mapRef.current = mapInstance;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(mapInstance);

      const icon = L.icon({
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      markerRef.current = L.marker([initialLat.current, initialLng.current], { icon, draggable: true }).addTo(mapInstance);

      const trigger = (elat: number, elng: number) => {
        setBusy(true);
        onPickRef.current({ lat: elat, lng: elng });
        setTimeout(() => setBusy(false), 800);
      };

      // tap to move pin
      mapInstance.on("click", (e: L.LeafletMouseEvent) => {
        const { lat: elat, lng: elng } = e.latlng;
        markerRef.current?.setLatLng([elat, elng]);
        trigger(elat, elng);
      });

      // drag the pin
      markerRef.current.on("dragend", (e: L.DragEndEvent) => {
        const pos = (e.target as L.Marker).getLatLng();
        trigger(pos.lat, pos.lng);
      });

      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (mapRef.current) mapRef.current.setView([latitude, longitude], 16);
        markerRef.current?.setLatLng([latitude, longitude]);
        setLocating(false);
        setBusy(true);
        onPickRef.current({ lat: latitude, lng: longitude });
        setTimeout(() => setBusy(false), 800);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sand">
      <div ref={containerRef} className="h-64 w-full md:h-72" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-100 text-stone-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-stone-600 shadow">
        <Navigation className="h-3.5 w-3.5 text-gold" /> اسحبي الدبوس أو اضغطي على الخريطة
      </div>
      <button
        type="button"
        onClick={goToCurrentLocation}
        title="تحديد موقعي الحالي"
        aria-label="تحديد موقعي الحالي"
        className="absolute bottom-3 left-3 z-[1000] flex h-10 w-10 items-center justify-center rounded-full bg-ink text-ivory shadow-lg transition hover:bg-gold hover:scale-105"
      >
        {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
      </button>
      {busy && (
        <div className="pointer-events-none absolute top-2 left-2 z-[1000] flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-stone-600 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ تحديد العنوان...
        </div>
      )}
    </div>
  );
}
