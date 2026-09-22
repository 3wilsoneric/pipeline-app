import styles from "./OutlookHandoffControls.module.css";

export default function OutlookConnectionNotice() {
  return <div className={styles.connectionNotice}>
    <strong>You review and send</strong>
    <p>Pipeline saves your Meet the Client email and admission packet in Outlook Drafts. This connection never sends email or reads unrelated messages.</p>
    <p>Pipeline checks the handoff it created to confirm sending. Microsoft requires broader mailbox read/write permission for this.</p>
  </div>;
}
