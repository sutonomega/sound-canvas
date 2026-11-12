import { organicStyle } from './organic.js';
import { geometricStyle } from './geometric.js';
import { particleStyle } from './particles.js';
import { watercolorStyle } from './watercolor.js';

// New styles register a definition here; the renderer has no style-name branches.
export const styleRegistry = Object.freeze({ organic: organicStyle, geometric: geometricStyle, particles: particleStyle, watercolor: watercolorStyle });
