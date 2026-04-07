'use client';

import { useState, useCallback } from 'react';
import { MapPin, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LocationData {
  lat: number;
  lng: number;
  address: string | null;
  accuracy: number;
}

interface GPSCaptureProps {
  onCapture: (location: LocationData) => void;
  location: LocationData | null;
}

export function GPSCapture({ onCapture, location }: GPSCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureLocation = useCallback(async () => {
    setIsCapturing(true);
    setError(null);

    try {
      // Try Capacitor Geolocation first, fall back to browser API
      let coords: { latitude: number; longitude: number; accuracy: number };

      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
        coords = position.coords;
      } catch {
        // Fallback to browser API
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        coords = position.coords;
      }

      // Reverse geocode with free Nominatim API
      let address: string | null = null;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}&zoom=16`
        );
        const data = await res.json();
        address = data.display_name || null;
      } catch {
        // Geocoding failed — not critical
      }

      const locationData: LocationData = {
        lat: coords.latitude,
        lng: coords.longitude,
        address,
        accuracy: coords.accuracy,
      };

      onCapture(locationData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Location access denied');
    } finally {
      setIsCapturing(false);
    }
  }, [onCapture]);

  if (location) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-success-bg border border-success/20 px-4 py-3">
        <MapPin className="h-5 w-5 text-success shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-success">Location Captured</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {location.address || `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={captureLocation}
        disabled={isCapturing}
        className="w-full gap-2 rounded-xl"
      >
        {isCapturing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
        {isCapturing ? 'Getting location...' : 'Capture GPS Location'}
      </Button>
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" /> {error}
        </div>
      )}
    </div>
  );
}
