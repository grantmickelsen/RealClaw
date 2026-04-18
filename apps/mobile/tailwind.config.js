/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand
        primary: '#0066FF',
        success: '#34c759',
        warning: '#ff9500',
        danger: '#ff3b30',
        // Category accents
        email: '#0066FF',
        sms: '#34c759',
        linkedin: '#0A66C2',
        calendar: '#FF6B00',
        social: '#8B5CF6',
        document: '#6B7280',
        financial: '#EF4444',
        // Neutrals
        surface: '#ffffff',
        muted: '#6B7280',
        subtle: '#F3F4F6',
        border: '#E5E7EB',
      },
      fontFamily: {
        sans: ['system-ui'],
        rounded: ['ui-rounded'],
        serif: ['ui-serif'],
        mono: ['ui-monospace'],
      },
      borderRadius: {
        card: '24px',
        chip: '999px',
      },
    },
  },
  plugins: [],
};
