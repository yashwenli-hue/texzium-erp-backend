import { Prisma } from '@prisma/client';

// What an API response may show about a user. Never select a whole User row into a
// response: it carries passwordHash. (CredentialRedactionInterceptor strips that field
// from every response as a last line of defence, but the selects below are the rule.)

// A user referred to from another record (an assignee, an actor, a recipient).
export const USER_REFERENCE_SELECT = {
  id: true,
  fullName: true,
} satisfies Prisma.UserSelect;

// The user directory (GET /users, and the user returned by POST /users).
export const USER_DIRECTORY_SELECT = {
  id: true,
  employeeCode: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  roleId: true,
  role: { select: { id: true, name: true, description: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
