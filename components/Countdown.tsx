import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

interface CountdownProps {
  target: Date;
  style?: StyleProp<TextStyle>;
  /** 'auto': con días si faltan; 'mmss': solo mm:ss; 'ss': dos dígitos (cuenta final) */
  format?: 'auto' | 'mmss' | 'ss';
}

function fmt(ms: number, format: 'auto' | 'mmss' | 'ss'): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (format === 'ss') return p2(s);
  if (format === 'mmss') return `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${p2(h)}:${p2(m)}:${p2(s % 60)}`;
  return `${p2(h)}:${p2(m)}:${p2(s % 60)}`;
}

/** Cuenta atrás con tick propio de 1 s — el resto del árbol no re-renderiza. */
export function Countdown({ target, style, format = 'auto' }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return <Text style={style}>{fmt(target.getTime() - now, format)}</Text>;
}
