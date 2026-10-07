// Public view type contracts.
import { view, type View } from './dom.js';
import type { JSX } from './jsx.js';
import type { Snapshot } from './snapshot.js';

type RenderCallback<A> = (value: A | Snapshot<A>) => JSX.Element;
const plain: RenderCallback<{ label: string }> = (value) => value.label;

// A plain function does not promise a separately owned/updateable view definition.
// @ts-expect-error Ordinary callback does not have the view build contract.
const ordinary: View<{ label: string }, never> = plain;
const definition: View<{ label: string }, never> = view(plain);
void ordinary;
void definition;
