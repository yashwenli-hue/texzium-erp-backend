import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const CODE = /^[a-z]+(\.[a-z]+)+$/;

// PATCH /roles/:id/permissions — one reviewed change to a role: the codes to add and the
// codes to remove, applied together (all or nothing). Codes that are already in (or
// already out of) the role are ignored, so a request can be repeated safely.
export class UpdateRolePermissionsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(CODE, { each: true })
  grant?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Matches(CODE, { each: true })
  revoke?: string[];

  // Required (true) when anything granted is sensitive (identity-admin.ts).
  @IsOptional()
  @IsBoolean()
  acknowledgeSensitive?: boolean;
}
