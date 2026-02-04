/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
      },
      spacing: {
        grid: 'var(--grid-size)',
        18: '4.5rem',
        22: '5.5rem',
        30: '7.5rem',
      },
      maxWidth: {
        'content': '72rem',
      },
      borderWidth: {
        'thin': '1px',
      },
      borderRadius: {
        'none': '0',
        'sm': '2px',
      },
      letterSpacing: {
        'tight': '-0.02em',
        'wide': '0.08em',
      },
      fontSize: {
        'data': ['3rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        'data-lg': ['4rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        'data-xl': ['5rem', { lineHeight: '1', letterSpacing: '-0.04em' }],
        'data-2xl': ['6.5rem', { lineHeight: '1', letterSpacing: '-0.04em' }],
      },
    },
  },
  plugins: [],
}
