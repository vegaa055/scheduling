import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 15 });
export const db = drizzle(pool, { schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };
