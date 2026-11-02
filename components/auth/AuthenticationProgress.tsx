import { LockKeyhole } from "lucide-react";
import { MicrosoftMark } from "@/components/auth/AuthenticationBrand";
import AuthenticationShell from "@/components/auth/AuthenticationShell";

export default function AuthenticationProgress({
  label = "Signing you in",
  detail = "Connecting securely to Microsoft Entra ID.",
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <AuthenticationShell>
      <section role="status" aria-live="polite" className="pipeline-auth-form">
        <p className="pipeline-auth-eyebrow"><LockKeyhole size={16} aria-hidden="true" />Secure workspace</p>
        <h1 className="pipeline-auth-heading">{label}</h1>
        <p className="pipeline-auth-description">{detail}</p>
        <div className="pipeline-auth-verification">
          <span className="pipeline-auth-spinner" aria-hidden="true" />
          <div>
            <div className="pipeline-auth-verificationName">
              <MicrosoftMark size={14} />
              Microsoft Entra ID
            </div>
            <p className="pipeline-auth-verificationDetail">Verifying your Alamo Health access</p>
          </div>
        </div>
        <p className="pipeline-auth-access">This window will continue automatically.</p>
      </section>
    </AuthenticationShell>
  );
}
