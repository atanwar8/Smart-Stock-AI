import { Cloud, CloudFog, CloudRain, Snowflake, Sun } from 'lucide-react';

export const weatherIcon = (condition = '') => {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('storm') || c.includes('drizzle')) return CloudRain;
  if (c.includes('snow')) return Snowflake;
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return CloudFog;
  if (c.includes('cloud')) return Cloud;
  return Sun;
};

export const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

/** Parses "40.0 lbs" / "3.3 days" style strings from the inventory API */
export const num = (s: string) => parseFloat(s) || 0;
