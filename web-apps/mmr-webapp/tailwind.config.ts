import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // ── MMR Flag Palette ──────────────────────────────────────────
          crimson:         '#C8102E',   // flag red — primary
          'crimson-dark':  '#8C0E20',   // deep crimson — hover / dark bg
          'crimson-light': '#E53050',   // bright crimson — hover states
          gold:            '#D4A843',   // flag calligraphy gold
          'gold-light':    '#F2D57E',   // pale gold — accents / glow
          'gold-dark':     '#A07820',   // deep gold — text on light bg
          cream:           '#FFF8F2',   // warm off-white background
          charcoal:        '#2C1810',   // warm dark text
          // Legacy aliases so portal pages still compile
          navy:            '#8C0E20',
          orange:          '#D4A843',
          'navy-dark':     '#2C1810',
          'navy-light':    '#C8102E',
          'orange-light':  '#F2D57E',
        },
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'Noto Sans SC', 'Georgia', 'serif'],
        sans:    ['Inter', 'Noto Sans SC', 'sans-serif'],
      },
      animation: {
        'fade-in':  'fadeIn 0.4s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
