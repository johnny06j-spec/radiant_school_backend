// middleware/validateMiddleware.js
import { z } from 'zod';

export const campusQuerySchema = z.object({
  query: z.object({
    campus: z.string().min(1).max(50).optional()
  }).passthrough()
});

export const loginBodySchema = z.object({
  body: z.object({
    usernameOrEmail: z.string().trim().min(1, "Username or Email is required"),
    password: z.string().min(1, "Password is required")
  }).passthrough()
});

export const refreshBodySchema = z.object({
  body: z.object({
    refreshToken: z.string().optional()
  }).passthrough().optional()
});

export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params
  });

  if (!result.success) {
    const firstIssue = result.error?.issues?.[0]?.message;
    return res.status(400).json({
      success: false,
      message: firstIssue || 'Invalid payload or query parameter format detected.'
    });
  }

  next();
};