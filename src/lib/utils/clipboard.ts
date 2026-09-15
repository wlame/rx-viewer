/**
 * Put text on the clipboard, and say whether it got there.
 *
 * The Clipboard API exists only in a secure context (https or
 * localhost), and `rx serve` is often reached over plain http on a
 * trusted network. There the text is copied the older way: from a text
 * field that is selected for the moment of the copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, the page not focused): try the older way.
    }
  }
  return copyThroughTextField(text);
}

function copyThroughTextField(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}
