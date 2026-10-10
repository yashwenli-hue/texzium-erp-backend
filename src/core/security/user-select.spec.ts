import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { USER_DIRECTORY_SELECT, USER_REFERENCE_SELECT } from './user-select';

// A whole User row carries passwordHash, so no query may include a relation to User
// as `relation: true`; it must select safe fields (see user-select.ts). This scans the
// source for that pattern, for every relation that points to User.

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

const userRelations = [
  ...new Set(
    Prisma.dmmf.datamodel.models.flatMap((model) =>
      model.fields
        .filter((field) => field.kind === 'object' && field.type === 'User')
        .map((field) => field.name),
    ),
  ),
].sort();

describe('safe user selects', () => {
  it('knows the relations that point to User', () => {
    expect(userRelations).toEqual(
      expect.arrayContaining([
        'assignedTo',
        'user',
        'salesPerson',
        'actor',
        'users',
      ]),
    );
  });

  it('never includes a whole User row through a relation', () => {
    const pattern = new RegExp(
      `\\b(${userRelations.join('|')})\\s*:\\s*true\\b`,
    );
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line)) {
            offenders.push(
              `${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`,
            );
          }
        });
    }

    expect(offenders).toEqual([]);
  });

  it('the shared selects carry no credential', () => {
    expect(USER_REFERENCE_SELECT).toEqual({ id: true, fullName: true });
    expect(Object.keys(USER_DIRECTORY_SELECT)).not.toContain('passwordHash');
    expect(Object.keys(USER_DIRECTORY_SELECT)).toEqual([
      'id',
      'employeeCode',
      'fullName',
      'email',
      'phone',
      'status',
      'roleId',
      'role',
      'createdAt',
      'updatedAt',
    ]);
  });
});
