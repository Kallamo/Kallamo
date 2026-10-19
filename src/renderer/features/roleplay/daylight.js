import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';

// Class strings stay whole so Tailwind can see them.
export const DAYLIGHT = {
  dawn: { label: 'Dawn', icon: Sunrise, band: 'from-daylight-dawn/16 via-daylight-dawn/5', tile: 'bg-daylight-dawn/14 border-daylight-dawn/30 text-daylight-dawn', text: 'text-daylight-dawn' },
  day: { label: 'Day', icon: Sun, band: 'from-daylight-day/16 via-daylight-day/5', tile: 'bg-daylight-day/14 border-daylight-day/30 text-daylight-day', text: 'text-daylight-day' },
  dusk: { label: 'Dusk', icon: Sunset, band: 'from-daylight-dusk/16 via-daylight-dusk/5', tile: 'bg-daylight-dusk/14 border-daylight-dusk/30 text-daylight-dusk', text: 'text-daylight-dusk' },
  night: { label: 'Night', icon: Moon, band: 'from-daylight-night/16 via-daylight-night/5', tile: 'bg-daylight-night/14 border-daylight-night/30 text-daylight-night', text: 'text-daylight-night' }
};

export function daylightPhase(hour = 12) {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

export const daylightFor = hour => DAYLIGHT[daylightPhase(hour)];
