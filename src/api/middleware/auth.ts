import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) {
    return next();
  }
  // API vs page request
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else {
    res.redirect('/login');
  }
}

export function requireGuest(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) {
    return res.redirect('/dashboard');
  }
  next();
}
