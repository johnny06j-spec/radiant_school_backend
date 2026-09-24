// middleware/validateMiddleware.js
import { z } from 'zod';

export const campusQuerySchema = z.object({
  query: z.object({
    campus: z.string().min(1).max(50).optional()
  })
});

export const loginBodySchema = z.object({
  body: z.object({
    usernameOrEmail: z.string().min(1, "Username or Email is required"),
    password: z.string().min(1, "Password is required")
  })
});

export const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params
    });
    next();
  } catch (err) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid payload or query parameter format detected.' 
    });
  }
};