import { view } from 'effectweb';
import type { Native } from './types.js';
/** A native input element with EffectWeb attribute and event conventions; no handle. */
export const Input = view<Native<'input'>>((props) => <input {...props} />);
