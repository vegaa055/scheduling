import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/session.ts";
import { accessMap, hasRole } from "../lib/access.ts";
import { localBus, type ChangeMessage } from "../lib/pubsub.ts";

/** Server-Sent Events: pushes change notifications so open calendars refresh themselves. */
export async function streamRoutes(app: FastifyInstance) {
  app.get("/stream", async (req, reply) => {
    const user = requireUser(req);
    let visible = await accessMap(user);
    const refresh = setInterval(async () => {
      visible = await accessMap(user).catch(() => visible);
    }, 60_000);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`retry: 5000\n\n`);

    const send = (msg: ChangeMessage) => {
      if (msg.type === "calendar.changed") {
        const ids = msg.calendarIds.filter((id) => visible.has(id));
        if (ids.length === 0) return;
        msg = { ...msg, calendarIds: ids };
      }
      if ((msg.type === "solver.progress" || msg.type === "sections.changed") && !hasRole(user, "admin", "scheduler", "staff")) {
        return;
      }
      reply.raw.write(`event: change\ndata: ${JSON.stringify(msg)}\n\n`);
    };
    localBus.on("change", send);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      clearInterval(refresh);
      localBus.off("change", send);
    });
    return reply.hijack();
  });
}
