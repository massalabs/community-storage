/**
 * Pictos type fichier en "pixel art" à pixels ronds, animés en arrière-plan
 * au-dessus de la grille pour rendre l'interface vivante.
 */

const PIXEL_SIZE = 4
const GAP = 2

/** Grilles 8×8 (1 = pixel allumé). Pixels rendus en cercles. */
const ICONS = {
  file: [
    [0, 0, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ],
  folder: [
    [0, 0, 0, 1, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ],
  image: [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 1, 0, 0, 1],
    [1, 0, 1, 1, 1, 1, 0, 1],
    [1, 0, 0, 1, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ],
  doc: [
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 1, 0, 0, 0, 0, 1, 1],
    [1, 1, 0, 0, 0, 0, 1, 1],
    [1, 1, 0, 0, 0, 0, 1, 1],
    [1, 1, 0, 0, 0, 0, 1, 1],
    [1, 1, 0, 0, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 0],
  ],
}

function PixelArtIcon({ grid, className = '' }) {
  const size = grid.length
  return (
    <div
      className={`flex flex-wrap items-center justify-center ${className}`}
      style={{
        width: size * (PIXEL_SIZE + GAP) - GAP,
        height: size * (PIXEL_SIZE + GAP) - GAP,
        gap: GAP,
      }}
    >
      {grid.flatMap((row, i) =>
        row.map((on, j) => (
          <div
            key={`${i}-${j}`}
            className="rounded-full bg-current"
            style={{
              width: PIXEL_SIZE,
              height: PIXEL_SIZE,
              opacity: on ? 1 : 0,
            }}
          />
        ))
      )}
    </div>
  )
}

const POSITIONS = [
  { left: '8%', top: '12%' },
  { left: '78%', top: '18%' },
  { left: '15%', top: '72%' },
  { left: '82%', top: '65%' },
  { left: '45%', top: '8%' },
  { left: '52%', top: '78%' },
  { left: '6%', top: '45%' },
  { left: '88%', top: '42%' },
  { left: '28%', top: '35%' },
  { left: '70%', top: '55%' },
]

const iconKeys = Object.keys(ICONS)

export function FloatingFileIcons() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {POSITIONS.map((pos, i) => {
        const key = iconKeys[i % iconKeys.length]
        const grid = ICONS[key]
        const delay = (i * 0.8) % 6
        const duration = 5 + (i % 3)
        return (
          <div
            key={i}
            className="absolute text-white opacity-[0.06] animate-float-file"
            style={{
              left: pos.left,
              top: pos.top,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          >
            <PixelArtIcon grid={grid} />
          </div>
        )
      })}
    </div>
  )
}
