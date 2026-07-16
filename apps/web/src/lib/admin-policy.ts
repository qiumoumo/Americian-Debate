export function hasSystemAdminAccess(user: { isSystemAdmin: boolean }) {
  return user.isSystemAdmin;
}
