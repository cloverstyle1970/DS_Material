"use client";

import { useState } from "react";
import { UserRecord } from "@/lib/mock-users";
import { PERMISSION_MENUS } from "@/lib/permissions";

export { PERMISSION_MENUS };

interface Props {
  user: UserRecord;
  onClose: () => void;
  onSave: (newPermissions: string[]) => Promise<void>;
}

export default function PermissionsModal({ user, onClose, onSave }: Props) {
  const [permissions, setPermissions] = useState<Set<string>>(new Set(user.permissions));
  // permissions state 기반으로 계산 — toggleAdmin 후 즉시 반영
  const isAdminUser = permissions.has("admin");
  const [saving, setSaving] = useState(false);

  function togglePermission(href: string, type: "read" | "create" | "update", checked: boolean) {
    if (isAdminUser) return;
    setPermissions(prev => {
      const next = new Set(prev);
      const key = `menu:${href}:${type}`;
      if (checked) {
        next.add(key);
        // 등록이나 수정을 체크하면 읽기 권한은 자동으로 부여
        if (type === "create" || type === "update") {
          next.add(`menu:${href}:read`);
        }
      } else {
        next.delete(key);
        // 읽기 권한을 해제하면 등록/수정 권한도 해제
        if (type === "read") {
          next.delete(`menu:${href}:create`);
          next.delete(`menu:${href}:update`);
        }
      }
      return next;
    });
  }

  function toggleGroup(groupItems: { href: string }[], checked: boolean) {
    if (isAdminUser) return;
    setPermissions(prev => {
      const next = new Set(prev);
      groupItems.forEach(item => {
        ["read", "create", "update"].forEach(type => {
          const key = `menu:${item.href}:${type}`;
          if (checked) next.add(key);
          else next.delete(key);
        });
      });
      return next;
    });
  }

  function hasPerm(href: string, type: "read" | "create" | "update") {
    if (isAdminUser) return true;
    return permissions.has(`menu:${href}:${type}`);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const permsArray = Array.from(permissions);
      await onSave(permsArray);
    } finally {
      setSaving(false);
    }
  }

  function toggleAdmin(checked: boolean) {
    setPermissions(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add("admin");
      } else {
        next.delete("admin");
      }
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">권한 설정</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <strong className="text-blue-600 dark:text-blue-400">{user.name}</strong> 님의 메뉴 접근 및 기능 권한을 설정합니다.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 p-5">
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={permissions.has("admin")} 
                onChange={e => toggleAdmin(e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <span className="font-bold text-gray-800 dark:text-white text-base">전체 관리자 권한 (모든 메뉴 접근, 등록, 수정 허용)</span>
            </label>
          </div>

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto flex-1 bg-white dark:bg-gray-800">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold border-b border-gray-200 dark:border-gray-700 shadow-sm">
                <tr>
                  <th className="px-4 py-3 w-1/4">그룹</th>
                  <th className="px-4 py-3 w-1/4">메뉴</th>
                  <th className="px-4 py-3 text-center">읽기(조회)</th>
                  <th className="px-4 py-3 text-center">등록</th>
                  <th className="px-4 py-3 text-center">수정/삭제</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                {PERMISSION_MENUS.map((group, gi) => (
                  group.items.map((item, ii) => (
                    <tr key={item.href} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      {ii === 0 && (
                        <td rowSpan={group.items.length} className="px-4 py-3 align-top border-r border-gray-100 dark:border-gray-700 bg-slate-50 dark:bg-slate-800/30">
                          <div className="font-bold text-gray-800 dark:text-gray-200">{group.group}</div>
                          {!permissions.has("admin") && (
                            <button 
                              onClick={() => toggleGroup(group.items, true)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 block"
                            >
                              그룹 전체 허용
                            </button>
                          )}
                          {!permissions.has("admin") && (
                            <button 
                              onClick={() => toggleGroup(group.items, false)}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline mt-1 block"
                            >
                              그룹 전체 해제
                            </button>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                        {item.label}
                        <div className="text-xs text-gray-400 font-normal">{item.href}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={hasPerm(item.href, "read")} 
                          onChange={e => togglePermission(item.href, "read", e.target.checked)}
                          disabled={permissions.has("admin")}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={hasPerm(item.href, "create")} 
                          onChange={e => togglePermission(item.href, "create", e.target.checked)}
                          disabled={permissions.has("admin")}
                          className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 disabled:opacity-50 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={hasPerm(item.href, "update")} 
                          onChange={e => togglePermission(item.href, "update", e.target.checked)}
                          disabled={permissions.has("admin")}
                          className="w-4 h-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500 disabled:opacity-50 cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800 rounded-b-xl">
          <button 
            onClick={onClose} 
            className="px-5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 shadow-sm"
          >
            취소
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> : null}
            권한 저장
          </button>
        </div>
      </div>
    </div>
  );
}
