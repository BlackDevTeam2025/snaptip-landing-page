/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./apps/admin/index.html",
    "./apps/admin/src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff8ed",
          100: "#ffefcf",
          500: "#f6a912",
          700: "#c67f05",
          900: "#5a3303",
        },
      },
    },
  },
  plugins: [],
};
