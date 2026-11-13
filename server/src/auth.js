import jwt from 'jsonwebtoken';
import { config } from './config.js';

const ALGORITHM = 'HS256';

export function signToken(user) {
  return jwt.sign({ name: user.name }, config.jwtSecret, {
    algorithm: ALGORITHM,
    subject: user.id,
    expiresIn: config.jwtExpiresIn,
  });
}

/** Returns the decoded claims, or null when the token is invalid or expired. */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM] });
  } catch {
    return null;
  }
}

/** Express middleware: requires `Authorization: Bearer <jwt>` for an existing user. */
export function requireAuth(store) {
  return (req, res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const claims = scheme === 'Bearer' ? verifyToken(token) : null;
    const user = claims && store.findUserById(claims.sub);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    next();
  };
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}
