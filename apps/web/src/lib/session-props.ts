export function sessionShellUser(session: {
  user: { name: string; email: string };
  workspace: { name: string };
  role: string;
}) {
  return {
    name: session.user.name,
    email: session.user.email,
    role: session.role,
    workspaceName: session.workspace.name
  };
}
