'use client';

// `@ionic/pwa-elements` used to be loaded here to give `@capacitor/camera` a web UI.
// Both are gone: capture now goes through `src/lib/capture.ts`, which uses the browser's
// own file/camera input and needs no custom elements registered.

import { TechnicianFlow } from '@/components/technician/TechnicianFlow';

export default function InspectPage() {
  return <TechnicianFlow />;
}
