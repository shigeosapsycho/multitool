/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a10',
        surface: '#13131c',
        'surface-2': '#1a1a26',
        'surface-3': '#22222e',
        border: '#252531',
        'border-strong': '#33333f',
        'text-primary': '#e8e8ee',
        'text-secondary': '#9c9caa',
        'text-muted': '#6b6b78',
        accent: '#7c5cff',
        'accent-hover': '#8d70ff',
        'accent-soft': 'rgba(124, 92, 255, 0.12)',
        success: '#34d399',
        warning: '#fbbf24',
        danger: '#f87171'
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif'
        ],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace']
      },
      boxShadow: {
        'card': '0 1px 0 rgba(255, 255, 255, 0.02), 0 1px 2px rgba(0, 0, 0, 0.4)',
        'glow-accent': '0 0 0 1px rgba(124, 92, 255, 0.4), 0 4px 16px rgba(124, 92, 255, 0.2)'
      }
    }
  },
  plugins: []
}
