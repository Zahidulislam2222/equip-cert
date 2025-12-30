'use client';

import { useState, useEffect } from 'react';

// This hook returns 'true' if the screen width is less than 768px (a common mobile breakpoint)
export const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    // Check on initial load
    checkScreenSize();

    // Check whenever the window is resized
    window.addEventListener('resize', checkScreenSize);

    // Clean up the event listener when the component is removed
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [breakpoint]);

  return isMobile;
};