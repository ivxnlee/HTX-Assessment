import type { RequestHandler } from "express";
import type { z } from "zod";

/**
 * Validates req.body and/or req.params against Zod schemas before the route
 * runs, so handlers can assume their input is already the right shape.
 *
 * safeParse rather than parse: it returns a result object instead of throwing,
 * which keeps control of the response shape here.
 */
export const validate =
  (schemas: { body?: z.ZodType; params?: z.ZodType }): RequestHandler =>
  (req, res, next) => {
    const bodyResult = schemas.body?.safeParse(req.body);
    if (bodyResult && !bodyResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: bodyResult.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    // Reassigning req.body to the parsed output is what gives the route the
    // trimmed title and the defaulted [] for skillIds.
    if (bodyResult) req.body = bodyResult.data;

    const paramsResult = schemas.params?.safeParse(req.params);
    if (paramsResult && !paramsResult.success) {
      return res.status(400).json({ error: "Invalid route parameter" });
    }
    // Parsed params go on res.locals, not back onto req.params: Express types
    // req.params as Record<string, string>, so putting a number there fights
    // the type system.
    if (paramsResult) res.locals.params = paramsResult.data;

    next();
  };
