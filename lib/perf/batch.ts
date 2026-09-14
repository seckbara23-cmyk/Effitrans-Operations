/**
 * PERF-UX-01 Phase 1 — independent loaders, run together, a few at a time.
 * SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The dossier page awaited ~30 loaders one after another. Most of them depend
 * only on the dossier being readable and on the viewer's permissions, not on
 * each other, so waiting for each before starting the next bought nothing and
 * cost a round trip per loader.
 *
 * `loadBatch` starts them together and returns every result under its own name.
 *
 * WHAT IT PRESERVES.
 *   * Each loader is the same call, with the same gate, as before: a loader
 *     whose permission is absent still issues no query at all.
 *   * Failure behaves like the sequential code it replaces: the first loader
 *     that throws rejects the batch (the page's error boundary renders), and no
 *     loader that has not already started is started after it.
 *   * Loaders never see each other's results. Anything that needs another
 *     loader's output belongs to a LATER batch — the dependency is expressed by
 *     the order of batches, never by a race.
 *
 * WHY BOUNDED. A render must not open thirty requests against a PostgREST pool
 * shared with every other operator. At most `limit` loaders run at once; a
 * loader's own internal parallelism is unchanged.
 */
import "server-only";
import { perfStage } from "./trace";

type Loaders = Record<string, () => Promise<unknown>>;
type Loaded<M extends Loaders> = { [K in keyof M]: Awaited<ReturnType<M[K]>> };

export async function loadBatch<M extends Loaders>(stage: string, limit: number, loaders: M): Promise<Loaded<M>> {
  const names = Object.keys(loaders) as (keyof M & string)[];
  const results = {} as Loaded<M>;
  let next = 0;
  let failed = false;

  const worker = async (): Promise<void> => {
    while (!failed && next < names.length) {
      const name = names[next++];
      try {
        results[name] = (await perfStage(`${stage}.${name}`, loaders[name])) as Loaded<M>[typeof name];
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const width = Math.max(1, Math.min(Math.trunc(limit), names.length));
  await perfStage(stage, async () => {
    await Promise.all(Array.from({ length: width }, worker));
  });
  return results;
}
