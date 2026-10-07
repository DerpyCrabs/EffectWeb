// Public view and slot type contracts.
import { view, type CompiledContent, type Slot, type View } from './dom.js';
import type { JSX } from './jsx.js';
import type { Snapshot } from './snapshot.js';

// Slot carries no additional nominal capability: an equivalent callback works both ways.
type PlainSlot<A> = (value: A | Snapshot<A>) => JSX.Element;
const plain: PlainSlot<{ label: string }> = (value) => value.label;
const named: Slot<{ label: string }> = plain;
const back: PlainSlot<{ label: string }> = named;
void back;

// CompiledContent branding prevents arbitrary object publication into a DOM position.
// @ts-expect-error Data is not owned DOM content.
const forged: CompiledContent = { definition: {}, value: {} };
void forged;

// A plain function does not promise a separately owned/updateable view definition.
// @ts-expect-error Ordinary callback does not have the view build contract.
const ordinary: View<{ label: string }, never> = plain;
const definition: View<{ label: string }, never> = view(plain);
void ordinary;
void definition;
