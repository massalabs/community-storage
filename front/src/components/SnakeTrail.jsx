/**
 * Traînées de points façon Snake en arrière-plan : lignes de points ronds
 * qui se déplacent lentement pour un effet vivant.
 */

const DOT_SIZE = 5
const DOT_GAP = 10

const TRAILS = [
  { length: 14, startX: '-20%', startY: '22%', direction: 'right', duration: 28, delay: 0 },
  { length: 12, startX: '110%', startY: '68%', direction: 'left', duration: 35, delay: 4 },
  { length: 10, startX: '15%', startY: '-15%', direction: 'down', duration: 32, delay: 2 },
  { length: 8, startX: '85%', startY: '115%', direction: 'up', duration: 25, delay: 6 },
  { length: 11, startX: '-25%', startY: '48%', direction: 'right', duration: 40, delay: 1 },
]

function SnakeTrail({ length, startX, startY, direction, duration, delay }) {
  const dots = Array.from({ length }, (_, i) => i)
  const isVertical = direction === 'down' || direction === 'up'

  return (
    <div
      className={`absolute opacity-[0.07] animate-snake-trail ${
        direction === 'right' ? 'snake-right' : direction === 'left' ? 'snake-left' : direction === 'down' ? 'snake-down' : 'snake-up'
      }`}
      style={{
        left: startX,
        top: startY,
        width: isVertical ? DOT_SIZE : length * (DOT_SIZE + DOT_GAP) - DOT_GAP,
        height: isVertical ? length * (DOT_SIZE + DOT_GAP) - DOT_GAP : DOT_SIZE,
        flexDirection: isVertical ? 'column' : 'row',
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }}
    >
      {dots.map((_, i) => (
        <div
          key={i}
          className="rounded-full bg-white shrink-0"
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            marginRight: isVertical ? 0 : i < length - 1 ? DOT_GAP : 0,
            marginBottom: isVertical && i < length - 1 ? DOT_GAP : 0,
          }}
        />
      ))}
    </div>
  )
}

export function SnakeTrails() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {TRAILS.map((t, i) => (
        <SnakeTrail key={i} {...t} />
      ))}
    </div>
  )
}
