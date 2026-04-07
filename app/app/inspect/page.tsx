'use client';

import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { useEffect } from 'react';
import { TechnicianFlow } from '@/components/technician/TechnicianFlow';

export default function InspectPage() {
  useEffect(() => {
    defineCustomElements(window);
  }, []);

  return <TechnicianFlow />;
}
