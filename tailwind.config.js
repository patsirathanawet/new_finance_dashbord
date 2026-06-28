/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // BMS Cloud — purple gradient palette (เปลี่ยนจากฟ้า → ม่วง)
        primary: {
          50:  '#faf5ff',  // very light lavender
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',  // mid purple
          600: '#9333ea',  // brand purple
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
        // sidebar tint (purple-very-light)
        sidebar: {
          DEFAULT: '#fbf7ff',
          accent: '#f3e8ff',
        },
      },
      fontFamily: {
        sans: ['Sarabun', 'sans-serif'],
      },
      borderRadius: {
        'xl': '14px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        'soft': '0 2px 12px rgba(147, 51, 234, 0.10)',  // ม่วง shadow
        'card': '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}
