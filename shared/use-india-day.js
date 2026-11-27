import { useEffect, useState } from 'react';
import { indiaDay } from './menu-availability.mjs';

export function useIndiaDay() {
  const [day, setDay] = useState(indiaDay);
  useEffect(() => {
    const midnight = Date.parse(day + 'T00:00:00+05:30') + 86400000;
    const timer = setTimeout(() => setDay(indiaDay()), Math.max(0, midnight - Date.now()));
    return () => clearTimeout(timer);
  }, [day]);
  return day;
}
