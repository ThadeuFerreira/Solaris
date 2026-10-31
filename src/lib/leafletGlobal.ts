// Leaflet-Geoman attaches itself to the global `L`, which ES module builds of
// Leaflet do not define. Import this module before the plugin.
import L from 'leaflet';

declare global {
  interface Window {
    L: typeof L;
  }
}

window.L = L;
