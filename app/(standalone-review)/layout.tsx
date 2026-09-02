export default function StandaloneReviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      data-testid="standalone-review-shell"
      className="h-screen overflow-hidden bg-white text-[#111111]"
    >
      {children}
    </div>
  );
}
