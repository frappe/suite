export function freezesEdits(previousRole: number, nextRole: number): boolean {
  return previousRole >= 40 && nextRole < 40;
}
