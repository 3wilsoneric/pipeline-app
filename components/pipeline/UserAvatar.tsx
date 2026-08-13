interface UserAvatarProps {
  size?: "sm" | "md" | "lg";
  border?: boolean;
  initials?: string;
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

export default function UserAvatar({ size = "md", border = true, initials = "" }: UserAvatarProps) {
  return (
    <div
      className={`flex ${sizeClasses[size]} shrink-0 items-center justify-center rounded-full bg-[#e7f3ee] text-[11px] font-black uppercase tracking-[0.04em] text-[#0f8b73] ${border ? "border border-[#b8dacf]" : ""}`}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}
