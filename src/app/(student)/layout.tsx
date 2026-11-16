// Student area: plain white "paper" without panels or dense chrome, so the exam is the only thing
// on screen. Pages add the quiet StudentHeader (the exam page has its own sticky bar).
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col bg-card">{children}</div>;
}
