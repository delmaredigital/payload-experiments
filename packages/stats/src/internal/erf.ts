// W. J. Cody, Rational Chebyshev approximations for the error function,
// Mathematics of Computation 23 (1969), CALERF's three double-precision ranges.
const A = [3.1611237438705656, 113.86415415105016, 377.485237685302, 3209.3775891384694, 0.18577770618460315]
const B = [23.60129095234412, 244.02463793444417, 1282.6165260773723, 2844.2368334391706]
const C = [0.5641884969886701, 8.883149794388376, 66.11919063714163, 298.6351381974001, 881.9522212417691, 1712.0476126340706, 2051.0783778260715, 1230.3393547979972, 2.1531153547440385e-8]
const D = [15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666902, 3290.7992357334596, 4362.619090143247, 3439.3676741437216, 1230.3393548037495]
const P = [0.30532663496123234, 0.36034489994980444, 0.12578172611122925, 0.016083785148742277, 0.0006587491615298378, 0.016315387137302097]
const Q = [2.568520192289822, 1.87295284992346, 0.5279051029514284, 0.06051834131244132, 0.002335204976268692]
const INV_SQRT_PI = 0.56418958354775628695

function smallErf(x: number): number {
  const y = x * x
  let num = A[4]! * y
  let den = y
  for (let i = 0; i < 3; i++) {
    num = (num + A[i]!) * y
    den = (den + B[i]!) * y
  }
  return x * (num + A[3]!) / (den + B[3]!)
}

// erfcx(y) = exp(y*y) erfc(y), y >= 0. Keeping the scale separate
// preserves subnormal normal tails beyond 26 without intermediate underflow.
function positiveErfcx(y: number): number {
  if (y <= 0.46875) return Math.exp(y * y) * (1 - smallErf(y))
  if (y <= 4) {
    let num = C[8]! * y
    let den = y
    for (let i = 0; i < 7; i++) {
      num = (num + C[i]!) * y
      den = (den + D[i]!) * y
    }
    return (num + C[7]!) / (den + D[7]!)
  }
  const z = 1 / y / y
  let num = P[5]! * z
  let den = z
  for (let i = 0; i < 4; i++) {
    num = (num + P[i]!) * z
    den = (den + Q[i]!) * z
  }
  return (INV_SQRT_PI - z * (num + P[4]!) / (den + Q[4]!)) / y
}

/** Source: Cody (1969), CALERF erf/erfc; used by scipy.stats.norm fixtures. */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  const y = Math.abs(x)
  if (y <= 0.46875) return 1 - smallErf(x)
  if (y > 28) return x < 0 ? 2 : 0
  // Split the exponent as in CALERF, avoiding rounding y*y in the tail.
  const hi = Math.trunc(y * 16) / 16
  const tail = positiveErfcx(y) * Math.exp(-hi * hi) * Math.exp(-(y - hi) * (y + hi))
  return x < 0 ? 2 - tail : tail
}
