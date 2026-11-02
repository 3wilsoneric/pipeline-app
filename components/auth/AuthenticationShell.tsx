import type { ReactNode } from "react";

import AuthenticationBrand from "@/components/auth/AuthenticationBrand";
import styles from "./Authentication.module.css";

export default function AuthenticationShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <div className={styles.content}>
          <AuthenticationBrand />
          {children}
        </div>
      </div>
    </main>
  );
}
