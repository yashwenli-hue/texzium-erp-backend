import { IsNotEmpty, IsString } from 'class-validator';

// PATCH /users/:id/role
export class ChangeUserRoleDto {
  @IsString()
  @IsNotEmpty()
  roleId: string;
}
