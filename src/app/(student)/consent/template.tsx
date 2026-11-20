import { PageFade } from "@/components/app/page-fade";

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageFade>{children}</PageFade>;
}
