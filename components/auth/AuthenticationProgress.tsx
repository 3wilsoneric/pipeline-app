import { LockKeyhole } from "lucide-react";
import { MicrosoftMark } from "@/components/auth/AuthenticationBrand";
import AuthenticationShell from "@/components/auth/AuthenticationShell";
import styles from "./Authentication.module.css";

export default function AuthenticationProgress({
  label = "Signing you in",
  detail = "Connecting securely to Microsoft Entra ID.",
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <AuthenticationShell>
      <section role="status" aria-live="polite" className={styles.form}>
        <p className={styles.eyebrow}><LockKeyhole size={16} aria-hidden="true" />Secure workspace</p>
        <h1 className={styles.heading}>{label}</h1>
        <p className={styles.description}>{detail}</p>
        <div className={styles.verification}>
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <div className={styles.verificationName}>
              <MicrosoftMark size={14} />
              Microsoft Entra ID
            </div>
            <p className={styles.verificationDetail}>Verifying your Alamo Health access</p>
          </div>
        </div>
        <p className={styles.access}>This window will continue automatically.</p>
      </section>
    </AuthenticationShell>
  );
}
