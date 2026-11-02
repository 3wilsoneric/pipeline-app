import Image from "next/image";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./Authentication.module.css";

export default function AuthenticationBrand() {
  return (
    <Image
      src={toPipelinePath("/brand/alamo-health-management.png")}
      alt="Alamo Health Management"
      width={774}
      height={206}
      unoptimized
      className={styles.companyLogo}
    />
  );
}

export function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 grid-cols-2 gap-[2px]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}
