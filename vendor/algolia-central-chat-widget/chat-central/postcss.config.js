/** PostCSS config for chat-central's standalone build.
 *  Runs tailwindcss → autoprefixer so `?inline` CSS imports produce
 *  fully processed utility-class stylesheets. */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
