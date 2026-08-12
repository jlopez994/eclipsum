import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, {
  Defs,
  Image as SvgImage,
  Mask,
  Rect,
  RadialGradient,
  Stop,
  LinearGradient,
} from 'react-native-svg';

/**
 * La corona a 2048×2048, reescalada con IA desde el original de 1024 (el mismo dibujo que
 * el icono de la app y que el lienzo de diseño).
 *
 * Hace falta ese tamaño porque aquí la imagen se ESTIRA: en un móvil de 420 dpi la corona
 * cubre ~1460 px físicos, mientras que el lienzo de diseño REDUCE esos 1024 a 580 CSS px —y
 * reducir siempre se ve nítido—. De ahí que el mismo archivo luciera mejor allí que en el
 * móvil. Medido en el emulador sobre la misma zona: el original a 1024 sube un 0,8 % sobre
 * el JPEG de 720 px y este reescalado un 3,9 %, con los filamentos ya separados a la vista.
 * Reescalar con Lanczos en vez de IA no daba nada: ampliar por interpolación no inventa
 * detalle, y hace falta un modelo que lo redibuje.
 *
 * ponytail: JPEG q92 y no PNG — 439 KB frente a los 819 KB del original de 1024, o sea más
 * nítido y a la vez más ligero; a este tamaño los artefactos no llegan a verse.
 */
const HERO = require('../../assets/eclipse-hero.jpg');

export interface HeroLook {
  /** Fondo del cielo: centro, medio y borde del degradado radial */
  sky: [string, string, string];
  /** Cuánto se deja ver la corona (0..1) */
  opacity: number;
  /** Ancho de la corona en múltiplos del ancho de pantalla */
  scale: number;
  /** 'breathe' = late despacio (totalidad); 'drift' = flota (resto) */
  motion: 'breathe' | 'drift';
}

/**
 * Corona a sangre por el borde superior: la imagen ES el ambiente de la pantalla.
 * La imagen viene sobre negro, así que en vez del `mix-blend-mode:screen` del diseño
 * —que RN no tiene— se recorta con una máscara radial dentro del propio SVG: el borde
 * cuadrado de la foto desaparece y funde con el cielo sin depender de MaskedView.
 */
export function CoronaHero({ look }: { look: HeroLook }) {
  const { width, height } = useWindowDimensions();
  const size = Math.round(width * look.scale);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = look.motion === 'breathe' ? 3000 : 6000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: half, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, look.motion]);

  const breathing = look.motion === 'breathe';
  const transform = breathing
    ? [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }]
    : [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }];
  // Siempre por el valor animado, incluso cuando no late: con el driver nativo enganchado
  // a esta vista, una opacidad estática en el mismo estilo se queda en 1 y los seis
  // estados salían con la corona igual de encendida.
  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [look.opacity * (breathing ? 0.82 : 1), look.opacity],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="sky" cx="50%" cy="6%" rx="120%" ry="70%">
            <Stop offset="0%" stopColor={look.sky[0]} />
            <Stop offset="52%" stopColor={look.sky[1]} />
            <Stop offset="100%" stopColor={look.sky[2]} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#sky)" />
      </Svg>

      <Animated.View
        style={{
          position: 'absolute',
          top: -Math.round(size * 0.3),
          left: (width - size) / 2,
          width: size,
          height: size,
          opacity,
          transform,
        }}
      >
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="fade" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#fff" stopOpacity="1" />
              <Stop offset="52%" stopColor="#fff" stopOpacity="1" />
              <Stop offset="78%" stopColor="#fff" stopOpacity="0" />
            </RadialGradient>
            <Mask id="halo">
              <Rect width={size} height={size} fill="url(#fade)" />
            </Mask>
          </Defs>
          <SvgImage
            href={HERO}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid slice"
            mask="url(#halo)"
          />
        </Svg>
      </Animated.View>

      {/* Funde la corona en negro antes de que empiece el texto: el crono nunca compite
          con los penachos, que es lo que pasaba al dejar la imagen a pelo. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height={height}>
        <Defs>
          <LinearGradient id="sink" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.26" stopColor="#000" stopOpacity="0" />
            <Stop offset="0.46" stopColor="#000" stopOpacity="0.85" />
            <Stop offset="0.56" stopColor="#000" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#sink)" />
      </Svg>
    </View>
  );
}
