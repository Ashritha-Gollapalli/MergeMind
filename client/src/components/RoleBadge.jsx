export default function RoleBadge({ role }) {
  if (!role) return null;

  const normalizedRole = role.toUpperCase();

  return (
    <span className={`role-badge role-${normalizedRole.toLowerCase()}`}>
      {normalizedRole}
    </span>
  );
}