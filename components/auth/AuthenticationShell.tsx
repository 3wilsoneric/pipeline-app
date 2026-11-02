import type { ReactNode } from "react";

import AuthenticationBrand from "@/components/auth/AuthenticationBrand";

export default function AuthenticationShell({ children }: { children: ReactNode }) {
  return (
    <main className="pipeline-auth-page">
      <div className="pipeline-auth-workspace">
        <div className="pipeline-auth-content">
          <AuthenticationBrand />
          {children}
        </div>
      </div>
    </main>
  );
}
