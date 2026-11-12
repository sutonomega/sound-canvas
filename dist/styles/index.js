import { organicStyle } from './organic.js';
import { geometricStyle } from './geometric.js';

// New styles register a definition here; the renderer has no style-name branches.
export const styleRegistry = Object.freeze({ organic: organicStyle, geometric: geometricStyle });
