import { Queue, Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { publish } from "../lib/pubsub.ts";
import { bullConnection, redis } from "../lib/redis.ts";
import { buildProblem, solver, type SolutionJson } from "../solver/client.ts";

export interface SolveJob {
  runId: string;
}

export const SOLVE_QUEUE = "solve-timetable";
export const solveQueue = new Queue<SolveJob>(SOLVE_QUEUE, { connection: bullConnection() });

const cancelKey = (runId: string) => `solver:cancel:${runId}`;
export const requestCancel = (runId: string) => redis.set(cancelKey(runId), "1", "EX", 3600);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function update(runId: string, values: Partial<typeof schema.solverRuns.$inferInsert>) {
  await db.update(schema.solverRuns).set(values).where(eq(schema.solverRuns.id, runId));
}

function summarize(sol: SolutionJson) {
  const assigned = sol.assignments.filter((a) => a.timeslotId && a.roomId).length;
  return {
    sections: sol.assignments.length,
    assigned,
    unassigned: sol.assignments.length - assigned,
    hardViolations: Math.abs(sol.hard ?? 0),
  };
}

/**
 * Builds the problem from Postgres, submits it to the Timefold service, relays progress over
 * pub/sub while it solves, then stores the best solution and its score analysis.
 */
async function processSolve(job: Job<SolveJob>) {
  const { runId } = job.data;
  const [run] = await db.select().from(schema.solverRuns).where(eq(schema.solverRuns.id, runId));
  if (!run) return;
  try {
    const problem = await buildProblem(run.termId);
    const { jobId } = await solver.submit(problem, run.secondsLimit);
    await update(runId, { status: "solving", summary: { solverJobId: jobId } });
    await publish({ type: "solver.progress", runId, status: "solving" });

    let lastScore: string | null = null;
    let sol: SolutionJson;
    for (;;) {
      await sleep(1000);
      if (await redis.get(cancelKey(runId))) {
        sol = await solver.stop(jobId);
        await finish(runId, jobId, sol, "cancelled");
        return;
      }
      sol = await solver.get(jobId);
      if (sol.score !== lastScore) {
        lastScore = sol.score;
        await update(runId, { score: sol.score, hardScore: sol.hard, softScore: sol.soft, summary: { solverJobId: jobId, ...summarize(sol) } });
        await publish({ type: "solver.progress", runId, status: "solving", score: sol.score });
        await job.updateProgress({ score: sol.score });
      }
      if (sol.status === "NOT_SOLVING") break;
    }
    await finish(runId, jobId, sol, "completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await update(runId, { status: "failed", error: message, finishedAt: new Date() });
    await publish({ type: "solver.progress", runId, status: "failed" });
    throw err;
  }
}

async function finish(runId: string, jobId: string, sol: SolutionJson, status: "completed" | "cancelled") {
  const analysis = await solver.analyze(jobId).catch(() => null);
  await update(runId, {
    status,
    score: sol.score,
    hardScore: sol.hard,
    softScore: sol.soft,
    summary: { solverJobId: jobId, ...summarize(sol) },
    solution: sol.assignments,
    analysis: analysis?.constraints ?? null,
    finishedAt: new Date(),
  });
  await publish({ type: "solver.progress", runId, status, score: sol.score });
}

export function startSolveWorker() {
  const worker = new Worker<SolveJob>(SOLVE_QUEUE, processSolve, {
    connection: bullConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => console.error(`[solver] job ${job?.id} failed: ${err.message}`));
  return worker;
}
