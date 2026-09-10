// Shared only by compiler runtime helpers; user functions cannot acquire this proof.
export const compiledSlots = new WeakSet<object>();
