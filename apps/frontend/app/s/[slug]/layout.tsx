import type { Metadata } from "next";

export function generateMetadata(): Metadata {
  return {
    robots: { index: false, follow: false },
  };
}

export default function SlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
