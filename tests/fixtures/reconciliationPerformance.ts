import { attribute } from '../../packages/runtime/src/dom';

export function styleWork() {
  const node = document.createElement('div');
  const writes: string[] = [];
  let reads = 0;
  const set = node.style.setProperty.bind(node.style);
  const get = node.style.getPropertyValue.bind(node.style);
  node.style.setProperty = (name, value, priority) => {
    writes.push(name);
    set(name, value, priority);
  };
  node.style.getPropertyValue = (name) => {
    reads++;
    return get(name);
  };
  const style = { position: 'absolute', left: 10, top: 20, width: 300, height: 200, zIndex: 1 };
  attribute(node, 'style', style);
  writes.length = 0;
  reads = 0;
  for (let i = 0; i < 100; i++) attribute(node, 'style', { ...style });
  const unchanged = { writes: writes.length, reads };
  attribute(node, 'style', { ...style, left: 11 });
  const changed = [...writes];
  node.style.top = '99px';
  attribute(node, 'style', { ...style, left: 11 });
  const repaired = node.style.top;
  attribute(node, 'style', { margin: '10px', marginLeft: '20px' });
  attribute(node, 'style', { marginLeft: '20px', margin: '10px' });
  const reordered = node.style.marginLeft;
  attribute(node, 'style', 'color: red; padding: 9px');
  attribute(node, 'style', { color: 'blue', '--custom': 2, lineHeight: 2 });
  const transitioned = [
    node.style.color,
    node.style.padding,
    node.style.getPropertyValue('--custom'),
    node.style.lineHeight,
  ];
  attribute(node, 'style', null);
  const cleared = node.getAttribute('style');
  return { unchanged, changed, repaired, reordered, transitioned, cleared };
}

export const measured = (counter: { renders: number }, value: number) => {
  counter.renders++;
  return value;
};

export function styleSemantics() {
  const actual = document.createElement('div');
  const expected = document.createElement('div');
  const cloned = document.createElement('div');
  cloned.setAttribute('style', 'color: red; padding: 10px');
  attribute(cloned, 'style', { color: 'blue' }, true);
  const clone = cloned.style.cssText;
  const cases: Record<string, string>[] = [
    { margin: '10px', marginLeft: '20px' },
    { margin: '10px', marginLeft: '10px' },
    { marginLeft: '10px', margin: '20px' },
    { margin: '20px' },
    { marginLeft: '20px', margin: '' },
    { borderLeftWidth: '5px', border: '' },
    { border: '1px solid red' },
    { borderImage: 'linear-gradient(red, blue) 1', border: '1px solid red' },
    { border: '1px solid red', borderLeftWidth: '5px' },
    { borderLeftWidth: '5px', border: '1px solid red' },
    { background: 'red', backgroundColor: 'blue', '--tone': '1' },
    { backgroundColor: 'blue', background: 'red', '--tone': '2' },
    { color: 'rgb(255, 0, 0)', padding: '0px' },
    { color: 'red', padding: '0' },
    { color: '', padding: 'invalid' },
    {},
  ];
  const failures: string[] = [];
  let previous = new Set<string>();
  for (let round = 0; round < 3; round++)
    for (const value of cases) {
      const entries = Object.entries(value).map(
        ([key, value]) => [key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`), value] as const,
      );
      const next = new Set(entries.map(([key]) => key));
      for (const key of previous) if (!next.has(key)) expected.style.removeProperty(key);
      for (const [key, value] of entries) expected.style.setProperty(key, value);
      attribute(actual, 'style', value);
      if (actual.style.cssText !== expected.style.cssText)
        failures.push(
          `${JSON.stringify(value)}: ${actual.style.cssText} != ${expected.style.cssText}`,
        );
      previous = next;
    }
  attribute(actual, 'style', { color: 'red' });
  actual.style.setProperty('color', 'red', 'important');
  attribute(actual, 'style', { color: 'red' });
  const priority = actual.style.getPropertyPriority('color');
  attribute(actual, 'style', { margin: '10px' });
  actual.style.setProperty('margin-left', '10px', 'important');
  attribute(actual, 'style', { margin: '10px' });
  const shorthandPriority = actual.style.getPropertyPriority('margin-left');
  attribute(actual, 'class', 'base');
  attribute(actual, 'classList', { 'active selected': true });
  let additions = 0;
  const add = actual.classList.add.bind(actual.classList);
  actual.classList.add = (...tokens) => {
    additions++;
    add(...tokens);
  };
  for (let i = 0; i < 100; i++) attribute(actual, 'classList', { 'active selected': true });
  const unchangedAdditions = additions;
  attribute(actual, 'class', 'replacement');
  attribute(actual, 'classList', { selected: true });
  return {
    failures,
    clone,
    priority,
    shorthandPriority,
    unchangedAdditions,
    classes: actual.className,
  };
}
