/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dorn: {
          bg: '#080B10',
          'panel': '#11161D',
          'panel-secondary': '#171E27',
          text: '#F4F7FA',
          'text-secondary': '#8E9AA8',
          accent: '#F3A93A',
          tech: '#78D9FF',
          safe: '#63D6A4',
          alert: '#FF767E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'gradient-to-b': 'linear-gradient(to bottom, var(--tw-gradient-stops))',
        'gradient-to-r': 'linear-gradient(to right, var(--tw-gradient-stops))',
      },
      scrollBehavior: ['smooth'],
      scrollSnapType: 'y mandatory',
      scrollSnapAlign: 'start',
    },
  },
  plugins: [],
};
