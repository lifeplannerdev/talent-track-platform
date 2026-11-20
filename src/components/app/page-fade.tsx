/** Short route fade (opacity only, so it never moves layout). Used by template.tsx files; the exam page has none. */
export function PageFade({ children }: { children: React.ReactNode }) {
  return <div className="page-in flex flex-1 flex-col">{children}</div>;
}
