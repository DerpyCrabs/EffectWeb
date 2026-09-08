// oxlint-disable-next-line no-restricted-imports -- Regression fixture supplies a foreign scalar view without compiler lowering.
import { view as scalarView } from 'effectweb/dom';
export const ScalarContract = scalarView<{ label: string }>((model) => model.label);
