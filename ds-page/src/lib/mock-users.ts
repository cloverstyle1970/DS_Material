import usersJson from "@/data/users.json";

export type Permission = "admin" | "site_manage" | "view_only";

export interface UserRecord {
  id: number;
  name: string;
  dept: string | null;
  rank: string | null;
  ssn: string | null;
  cert: string | null;
  hireDate: string | null;
  resignDate: string | null;
  phone: string | null;
  status: string | null;
  address: string | null;
  permissions: Permission[];
}

let users: UserRecord[] = usersJson as UserRecord[];

export function getUsers(query?: string): UserRecord[] {
  if (!query) return users;
  const q = query.toLowerCase();
  return users.filter(u =>
    u.name.toLowerCase().includes(q) ||
    (u.dept?.toLowerCase().includes(q) ?? false) ||
    (u.rank?.toLowerCase().includes(q) ?? false) ||
    (u.phone?.includes(q) ?? false) ||
    String(u.id).includes(q)
  );
}

export function addUser(user: UserRecord): UserRecord {
  users = [user, ...users];
  return user;
}

export function updateUser(id: number, patch: Partial<UserRecord>): UserRecord | null {
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch };
  return users[idx];
}

export function deleteUser(id: number): boolean {
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users.splice(idx, 1);
  return true;
}
