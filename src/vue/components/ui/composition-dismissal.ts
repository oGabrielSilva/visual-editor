export const preserveComposingEscape = (event: KeyboardEvent): void => {
  if (event.isComposing) event.preventDefault();
};
