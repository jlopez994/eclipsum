/**
 * Proyección del cielo sobre la pantalla: dado dónde está el sol (azimut/altura) y
 * hacia dónde apunta el móvil, ¿en qué punto del encuadre cae? Base del visor de cámara.
 *
 * Marco del mundo (ENU): x = este, y = norte, z = arriba.
 * Marco del móvil: x = derecha de la pantalla, y = arriba de la pantalla,
 * z = sale de la pantalla hacia el usuario. La cámara trasera mira hacia −z.
 *
 * Sin imports de react-native: selfcheck lo ejecuta en Node.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Base ortonormal de la cámara en coordenadas del mundo. */
export interface CameraBasis {
  /** Hacia dónde mira la cámara */
  forward: Vec3;
  /** Derecha de la pantalla */
  right: Vec3;
  /** Arriba de la pantalla */
  up: Vec3;
}

export interface Fov {
  horizontalDeg: number;
  verticalDeg: number;
}

export interface Projection {
  /** El objetivo cae dentro del encuadre */
  inFrame: boolean;
  /** Posición normalizada: −1..1, x hacia la derecha, y hacia arriba. Solo útil con inFrame */
  x: number;
  y: number;
  /** Separación angular entre el centro del encuadre y el objetivo, en grados */
  offAxisDeg: number;
  /** Hacia dónde girar para encontrarlo: 0 = arriba, 90 = derecha, 180 = abajo, 270 = izquierda */
  turnDeg: number;
}

type Mat3 = [Vec3, Vec3, Vec3];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z);
  return n < 1e-9 ? v : { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** Interpolación lineal componente a componente; `f` = peso de la muestra nueva. */
function mix(a: Vec3, b: Vec3, f: number): Vec3 {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}

/** Componente de `v` perpendicular a `axis` (Gram-Schmidt). */
function perpendicularTo(v: Vec3, axis: Vec3): Vec3 {
  const k = dot(v, axis);
  return { x: v.x - axis.x * k, y: v.y - axis.y * k, z: v.z - axis.z * k };
}

/** Grados normalizados a [0, 360). */
export function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Delta con signo por el camino corto del círculo, en [−180, 180). */
export const shortDelta = (fromDeg: number, toDeg: number) => ((toDeg - fromDeg + 540) % 360) - 180;

/**
 * Media exponencial de un RUMBO, por el camino corto del círculo: interpolando los grados
 * a pelo, pasar de 359° a 1° daría un barrido de 358° en sentido contrario.
 * `f` = peso de la muestra nueva (0 = congelado, 1 = sin filtrar).
 */
export function smoothBearing(prev: number | null, next: number, f: number): number {
  if (prev === null) return norm360(next);
  return norm360(prev + shortDelta(prev, next) * f);
}

/**
 * Media exponencial de la orientación de la cámara, reortonormalizada para que siga siendo
 * una base válida (interpolar los tres vectores por separado los saca de ángulo recto).
 *
 * Es lo que quita el temblor: los sensores llegan a 20 Hz y el magnetómetro ronda ±10-20°
 * de ruido, así que sin filtro la escena nada aunque el móvil esté quieto. El retardo que
 * introduce no se nota — el sol no se mueve.
 */
export function smoothBasis(prev: CameraBasis | null, next: CameraBasis, f: number): CameraBasis {
  // Salto de más de 90° en una muestra: no es movimiento real (reanclado de brújula, giro
  // de pantalla). Interpolar vectores casi opuestos colapsa la base, así que se salta el filtro.
  if (!prev || dot(prev.forward, next.forward) <= 0) return next;
  const forward = normalize(mix(prev.forward, next.forward, f));
  const up = normalize(perpendicularTo(mix(prev.up, next.up, f), forward));
  return { forward, up, right: cross(forward, up) };
}

/** Matriz por columnas: apply(m, v) = m·v */
function apply(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0].x * v.x + m[1].x * v.y + m[2].x * v.z,
    y: m[0].y * v.x + m[1].y * v.y + m[2].y * v.z,
    z: m[0].z * v.x + m[1].z * v.y + m[2].z * v.z,
  };
}

function mul(a: Mat3, b: Mat3): Mat3 {
  return [apply(a, b[0]), apply(a, b[1]), apply(a, b[2])];
}

function rotX(d: number): Mat3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: c, z: s },
    { x: 0, y: -s, z: c },
  ];
}

function rotY(d: number): Mat3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    { x: c, y: 0, z: -s },
    { x: 0, y: 1, z: 0 },
    { x: s, y: 0, z: c },
  ];
}

function rotZ(d: number): Mat3 {
  const c = Math.cos(rad(d));
  const s = Math.sin(rad(d));
  return [
    { x: c, y: s, z: 0 },
    { x: -s, y: c, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
}

/** Vector unitario hacia un punto del cielo. Azimut horario desde el norte (0 = N, 90 = E). */
export function skyVector(azimuthDeg: number, altitudeDeg: number): Vec3 {
  const a = rad(azimuthDeg);
  const h = rad(altitudeDeg);
  return { x: Math.sin(a) * Math.cos(h), y: Math.cos(a) * Math.cos(h), z: Math.sin(h) };
}

/** Rumbo horario desde el norte de la proyección horizontal de un vector. */
export function bearingOf(v: Vec3): number {
  return (deg(Math.atan2(v.x, v.y)) + 360) % 360;
}

/** Gira un vector alrededor de la vertical sumando `deltaDeg` a su rumbo. */
function turnBearing(v: Vec3, deltaDeg: number): Vec3 {
  const c = Math.cos(rad(deltaDeg));
  const s = Math.sin(rad(deltaDeg));
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c, z: v.z };
}

/**
 * Base de la cámara a partir de la rotación de DeviceMotion (convención W3C:
 * R = Rz(alpha)·Rx(beta)·Ry(gamma), ángulos en GRADOS).
 *
 * OJO: en Android `alpha` suele venir de un vector de rotación RELATIVO, no del norte
 * magnético — el guiñado deriva. Por eso existe `withCompassBearing`, que lo reancla
 * con la brújula de expo-location (la misma que ya usa CompassChip).
 */
export function cameraBasis(alphaDeg: number, betaDeg: number, gammaDeg: number): CameraBasis {
  const r = mul(mul(rotZ(alphaDeg), rotX(betaDeg)), rotY(gammaDeg));
  const outOfScreen = apply(r, { x: 0, y: 0, z: 1 });
  return {
    right: apply(r, { x: 1, y: 0, z: 0 }),
    up: apply(r, { x: 0, y: 1, z: 0 }),
    forward: { x: -outOfScreen.x, y: -outOfScreen.y, z: -outOfScreen.z },
  };
}

/**
 * Reancla el guiñado para que la cámara mire al rumbo que dice la brújula,
 * conservando cabeceo y alabeo (esos sí son absolutos: los fija la gravedad).
 */
export function withCompassBearing(basis: CameraBasis, cameraBearingDeg: number): CameraBasis {
  const delta = cameraBearingDeg - bearingOf(basis.forward);
  return {
    forward: turnBearing(basis.forward, delta),
    right: turnBearing(basis.right, delta),
    up: turnBearing(basis.up, delta),
  };
}

/**
 * Campo de visión vertical derivado del horizontal y la relación de aspecto.
 * expo-camera NO expone el FOV real del objetivo, así que el horizontal es una
 * estimación (~66° en la cámara principal de un móvil típico): la marca cae en la
 * zona correcta, no clavada al grado.
 */
export function fovFor(widthPx: number, heightPx: number, horizontalDeg = 66): Fov {
  const vertical = 2 * deg(Math.atan((Math.tan(rad(horizontalDeg) / 2) * heightPx) / widthPx));
  return { horizontalDeg, verticalDeg: vertical };
}

/** Proyecta una dirección del cielo al encuadre de la cámara. */
export function project(target: Vec3, cam: CameraBasis, fov: Fov): Projection {
  const z = dot(target, cam.forward);
  const x = dot(target, cam.right);
  const y = dot(target, cam.up);
  const offAxisDeg = deg(Math.acos(clamp(z, -1, 1)));
  // atan2(x, y): 0 = arriba de la pantalla, crece hacia la derecha
  const turnDeg = (deg(Math.atan2(x, y)) + 360) % 360;
  // Detrás de la cámara: la división proyectiva daría una posición espejada
  if (z <= 1e-6) return { inFrame: false, x: 0, y: 0, offAxisDeg, turnDeg };
  const nx = x / z / Math.tan(rad(fov.horizontalDeg) / 2);
  const ny = y / z / Math.tan(rad(fov.verticalDeg) / 2);
  return { inFrame: Math.abs(nx) <= 1 && Math.abs(ny) <= 1, x: nx, y: ny, offAxisDeg, turnDeg };
}
