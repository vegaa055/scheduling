import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "./env.ts";
import { registerSessionHooks } from "./auth/session.ts";
import { HttpError } from "./lib/errors.ts";
import { startSubscriber } from "./lib/pubsub.ts";
import { redis } from "./lib/redis.ts";
import { startSolveWorker } from "./jobs/queue.ts";
import { authRoutes } from "./routes/auth.ts";
import { bookingRoutes } from "./routes/bookings.ts";
import { directoryRoutes } from "./routes/directory.ts";
import { eventRoutes } from "./routes/events.ts";
import { schedulingRoutes } from "./routes/scheduling.ts";
import { streamRoutes } from "./routes/stream.ts";

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }
        : { level: "info" },
    trustProxy: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(formbody);
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute", redis });
  registerSessionHooks(app);

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation",
        message: err.issues[0]?.message ?? "Invalid request",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: "error", message: status >= 500 ? "Something went wrong on our side" : err.message });
  });

  await app.register(authRoutes);
  await app.register(directoryRoutes);
  await app.register(eventRoutes);
  await app.register(bookingRoutes);
  await app.register(schedulingRoutes);
  await app.register(streamRoutes);
  return app;
}

const app = await buildApp();
await startSubscriber();
if (process.env.RUN_WORKER !== "0") startSolveWorker();
await app.listen({ port: env.PORT, host: env.HOST });
app.log.info(`API ready (auth mode: ${env.AUTH_MODE})`);
