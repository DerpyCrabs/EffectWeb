import { profiling, profileCall } from './profile.js';
import { reportSafely, type ReportError } from './errors.js';

/** A coalesced measurement owned by its DOM binding. */
export interface DomMeasurement {
  readonly schedule: () => void;
  readonly cancel: () => void;
}
/** Resources created here are released automatically when the binding ends. */
export interface DomLifetime {
  readonly measure: <A>(work: {
    readonly read: () => A & (A extends PromiseLike<unknown> ? never : unknown);
    readonly write: (value: A) => void | undefined;
  }) => DomMeasurement;
}
interface Job {
  revision: number;
  pending: boolean;
  inFlight: boolean;
  disposed: boolean;
  read: () => () => void;
  report: ReportError;
}
interface Queue {
  pending: Set<Job>;
  frame: number | undefined;
}
const queues = new WeakMap<Window, Queue>();
function queueFor(window: Window): Queue {
  let queue = queues.get(window);
  if (!queue) {
    queue = { pending: new Set(), frame: undefined };
    queues.set(window, queue);
  }
  return queue;
}
function flush(queue: Queue) {
  queue.frame = undefined;
  const batch = [...queue.pending].map((job) => ({ job, revision: job.revision }));
  queue.pending.clear();
  const writes: Array<{ job: Job; revision: number; write: () => void }> = [];
  const errors: Array<{ job: Job; error: unknown }> = [];
  for (const { job, revision } of batch) {
    if (job.disposed || !job.pending || job.revision !== revision) continue;
    job.pending = false;
    job.inFlight = true;
    try {
      writes.push({ job, revision, write: job.read() });
    } catch (error) {
      job.inFlight = false;
      errors.push({ job, error });
    }
  }
  for (const { job, revision, write } of writes) {
    try {
      if (!job.disposed && job.revision === revision) write();
    } catch (error) {
      errors.push({ job, error });
    } finally {
      job.inFlight = false;
    }
  }
  // Reporting may mutate the DOM too, so report only after the read/write phases finish.
  for (const { job, error } of errors) reportSafely(job.report, error);
}

export function measurementLifetime(element: Element, report: ReportError) {
  let disposed = false;
  const tasks = new Set<{ job: Job; schedule: () => void; cancel: () => void }>();
  const lifetime: DomLifetime = {
    measure(work) {
      if (disposed) return { schedule: () => {}, cancel: () => {} };
      const window = element.ownerDocument?.defaultView;
      if (!window) throw new Error('DOM measurements require an element with an owning Window');
      const queue = queueFor(window);
      const job: Job = {
        revision: 0,
        pending: false,
        inFlight: false,
        disposed,
        read: () => {
          const value = profiling
            ? profileCall(work.read, 'measurement', 'read', work.read)
            : work.read();
          return () => {
            if (profiling) profileCall(work.read, 'measurement', 'write', () => work.write(value));
            else work.write(value);
          };
        },
        report,
      };
      const schedule = () => {
        if (job.disposed) return;
        job.revision++;
        job.pending = true;
        queue.pending.add(job);
        if (queue.frame === undefined)
          queue.frame = window.requestAnimationFrame(() => flush(queue));
      };
      const cancel = () => {
        job.revision++;
        job.pending = false;
        queue.pending.delete(job);
        if (queue.frame !== undefined && queue.pending.size === 0) {
          window.cancelAnimationFrame(queue.frame);
          queue.frame = undefined;
        }
      };
      if (!disposed) tasks.add({ job, schedule, cancel });
      return { schedule, cancel };
    },
  };
  return {
    lifetime,
    update() {
      for (const { job, schedule } of tasks) {
        if (job.pending || job.inFlight) schedule();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { job, cancel } of tasks) {
        job.disposed = true;
        cancel();
      }
      tasks.clear();
    },
  };
}
