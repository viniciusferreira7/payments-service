import type { UserRole } from './enums/user-role.enum';

/** What `req.user` holds on a protected route. */
export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};
