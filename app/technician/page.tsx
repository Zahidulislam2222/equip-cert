'use client';

import { TechnicianFlow } from "@/components/technician/TechnicianFlow";

export default function TechnicianPage() {
  return (
    // We force a max-width to simulate a phone screen on desktop, 
    // but on a real phone, it takes up 100% width.
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-md bg-white min-h-screen shadow-2xl overflow-hidden">
        <TechnicianFlow />
      </div>
    </div>
  );
}