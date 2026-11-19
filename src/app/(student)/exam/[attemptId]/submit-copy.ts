/** The submit dialog's description (tested in submit-copy.test.ts). */
export function submitDialogText(answered: number, total: number, unsaved: boolean): string {
  return [
    `You answered ${answered} of ${total} questions.`,
    "You cannot change your answers after submitting.",
    "Your result is shown right after you submit.",
    unsaved ? "Some answers are still being saved; they will be sent first." : "",
  ]
    .filter(Boolean)
    .join(" ");
}
