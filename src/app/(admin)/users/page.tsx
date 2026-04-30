import { getUsers } from "@/lib/mock-users";
import UsersClient from "@/components/users/UsersClient";

export default function UsersPage() {
  const users = getUsers();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">사용자 관리</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">사원 명부 및 시스템 접근 계정 관리</p>
      </div>
      <UsersClient initial={users} />
    </div>
  );
}
