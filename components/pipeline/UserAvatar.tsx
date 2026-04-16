interface UserAvatarProps {
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

export default function UserAvatar({ size = "md" }: UserAvatarProps) {
  return (
    <div
      className={`relative ${sizeClasses[size]} overflow-hidden rounded-full border border-slate-300 bg-slate-100`}
      aria-hidden="true"
    >
      <div className="absolute left-1/2 top-[22%] h-[30%] w-[30%] -translate-x-1/2 rounded-full bg-slate-400" />
      <div className="absolute bottom-[-8%] left-1/2 h-[52%] w-[70%] -translate-x-1/2 rounded-t-[999px] bg-slate-400" />
    </div>
  );
}
