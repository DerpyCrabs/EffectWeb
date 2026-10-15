import { styleWork, styleSemantics } from '../fixtures/reconciliationPerformance';
import { windowWork } from '../fixtures/reconciliationPerformanceFixture';
import { callbackWork } from '../fixtures/callbackInvalidationFixture';
const fixture = { styleWork, styleSemantics, windowWork, callbackWork };
declare global {
  interface Window {
    performanceFixture: typeof fixture;
  }
}
window.performanceFixture = fixture;
