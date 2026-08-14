/** Kiosk appliance build: standalone server output, fully self-contained.
 * No external requests at runtime - fonts, models and the inference
 * runtime ship inside the release (see DESIGN.md). */
module.exports = {
  output: 'standalone',
  reactStrictMode: true,
  // The kiosk is the only page; keep the build deterministic.
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['better-sqlite3'],
}
