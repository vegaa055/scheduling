/**
 * Standalone worker process. By default the API runs the worker in-process (RUN_WORKER=1);
 * in production run this separately so long solves never compete with request handling.
 */
import { startSolveWorker } from "./queue.ts";

startSolveWorker();
console.log("Solver worker listening for jobs");
