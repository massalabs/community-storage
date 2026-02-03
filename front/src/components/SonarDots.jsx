/**
 * Points en arrière-plan : apparaissent et disparaissent à différents endroits.
 */

const NODE_SIZE = 5
const POSITIONS = [
  { left: '12%', top: '25%' },
  { left: '88%', top: '30%' },
  { left: '50%', top: '15%' },
  { left: '22%', top: '70%' },
  { left: '75%', top: '78%' },
  { left: '35%', top: '48%' },
  { left: '65%', top: '55%' },
  { left: '8%', top: '52%' },
  { left: '92%', top: '62%' },
  { left: '42%', top: '82%' },
]

function Dot({ left, top, delay = 0 }) {
  return (
    <div
      className="absolute pointer-events-none rounded-sm bg-white animate-bg-dot"
      style={{
        left,
        top,
        width: NODE_SIZE,
        height: NODE_SIZE,
        marginLeft: -NODE_SIZE / 2,
        marginTop: -NODE_SIZE / 2,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

export function SonarDots() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {POSITIONS.map((pos, i) => (
        <Dot
          key={i}
          left={pos.left}
          top={pos.top}
          delay={i * 0.5}
        />
      ))}
    </div>
  )
}
